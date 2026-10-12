// gh network: find the forks that carry on a repo's work.
// It walks the whole fork network (forks of forks too), compares every fork with the
// repo it was forked from on every recent branch, then ranks forks by adoption and
// recent work of their own.
import { $ } from "bun";
import { z } from "zod";

const MAX_COMPARED_FORKS = 300;
const MAX_BRANCHES_PER_FORK = 10;
const BRANCHES_FETCHED = 30;
const CONCURRENCY = 8;
const GRAPHQL_BATCH = 20;
const TABLE_ROWS = 15;
const BOT_BRANCH = /^(dependabot|renovate)\//;
const DAY = 86_400_000;

const USAGE = `usage: gh network <owner/repo> [--json]

Ranks the forks in a repo's fork network by who is still doing the work.
Any repo in the network works as input; the walk starts from the original.`;

// Only the fields we read from GitHub's responses.
const RestRepo = z.object({
  full_name: z.string(),
  name: z.string(),
  owner: z.object({ login: z.string() }),
  stargazers_count: z.number(),
  forks_count: z.number(),
  created_at: z.string(),
  pushed_at: z.string(),
  archived: z.boolean(),
  default_branch: z.string(),
  has_issues: z.boolean(),
  description: z.string().nullable(),
});
const RepoWithSource = RestRepo.extend({ source: RestRepo.optional() });
const Compare = z.object({ ahead_by: z.number(), behind_by: z.number() });
// Branch heads that point at something other than a commit come back without oid/committedDate.
const Ref = z
  .object({ name: z.string(), target: z.object({ oid: z.string(), committedDate: z.string() }).partial().nullable() })
  .nullable();
const GraphRepo = z.object({
  hasIssuesEnabled: z.boolean(),
  issues: z.object({ totalCount: z.number() }),
  pullRequests: z.object({ totalCount: z.number() }),
  releases: z.object({ nodes: z.array(z.object({ tagName: z.string(), createdAt: z.string() })) }),
  defaultBranchRef: Ref,
  refs: z.object({ nodes: z.array(Ref) }),
});
const GraphResponse = z.object({ data: z.record(z.string(), z.unknown()).nullish() });

type Head = { oid: string; date: string };
type Repo = {
  name: string;
  owner: string;
  repo: string;
  parent?: string;
  depth: number;
  stars: number;
  directForks: number;
  createdAt: string;
  pushedAt: string;
  archived: boolean;
  defaultBranch: string;
  descendants: number;
  heads: Map<string, Head>;
  release?: { tag: string; date: string };
  issuesEnabled: boolean;
  openIssues: number;
  openPRs: number;
  ahead?: number;
  behind?: number;
  ownBranches: string[];
  branchesCapped: boolean;
  lastOwnCommit?: string;
  score: number;
};

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
  console.log(USAGE);
  process.exit(0);
}
const asJson = args.includes("--json");
const target = args.find((a) => !a.startsWith("-"));
if (!target || !/^[\w.-]+\/[\w.-]+$/.test(target)) {
  console.error(USAGE);
  process.exit(1);
}

let token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
if (!token) {
  try {
    token = (await $`gh auth token`.quiet().text()).trim();
  } catch {
    console.error("gh network needs a GitHub token. Run `gh auth login` or set GH_TOKEN.");
    process.exit(1);
  }
}

const progress = (msg: string) => process.stderr.isTTY && process.stderr.write(`\r\x1b[K${msg}`);
let restCalls = 0;
let graphqlCalls = 0;

// Returns the parsed JSON body, or null for any non-rate-limit failure (404s, blocked repos, etc).
async function github(path: string, query?: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.github.com/${path}`, {
      method: query ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      body: query ? JSON.stringify({ query }) : undefined,
    });
    if (query) graphqlCalls++;
    else restCalls++;
    if (res.ok) return res.json();
    const retryAfter = Number(res.headers.get("retry-after"));
    const outOfQuota = res.headers.get("x-ratelimit-remaining") === "0";
    if (attempt === 3 || !(res.status === 429 || (res.status === 403 && (retryAfter || outOfQuota)))) return null;
    const resetAt = Number(res.headers.get("x-ratelimit-reset")) * 1000;
    const waitMs = retryAfter ? retryAfter * 1000 : outOfQuota ? resetAt - Date.now() + 1000 : 60_000;
    if (waitMs > 15 * 60_000) {
      throw new Error(`GitHub rate limit used up; it resets at ${new Date(resetAt).toLocaleTimeString()}.`);
    }
    progress(`rate limited, waiting ${Math.ceil(waitMs / 1000)}s`);
    await Bun.sleep(waitMs);
  }
}

async function mapLimit<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return out;
}

const daysSince = (iso: string) => (Date.now() - Date.parse(iso)) / DAY;
function age(iso?: string): string {
  if (!iso) return "-";
  const d = Math.floor(daysSince(iso));
  if (d < 1) return "today";
  if (d < 60) return `${d}d ago`;
  if (d < 730) return `${Math.round(d / 30)}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}

function fromRest(r: z.infer<typeof RestRepo>, parent: string | undefined, depth: number): Repo {
  return {
    name: r.full_name,
    owner: r.owner.login,
    repo: r.name,
    parent,
    depth,
    stars: r.stargazers_count,
    directForks: r.forks_count,
    createdAt: r.created_at,
    pushedAt: r.pushed_at,
    archived: r.archived,
    defaultBranch: r.default_branch,
    descendants: 0,
    heads: new Map(),
    issuesEnabled: r.has_issues,
    openIssues: 0,
    openPRs: 0,
    ownBranches: [],
    branchesCapped: false,
    score: 0,
  };
}

// 1. Find the original repo and walk every fork under it, level by level.
const start = RepoWithSource.safeParse(await github(`repos/${target}`));
if (!start.success) {
  console.error(`Can't find ${target} (or it's private and your token can't see it).`);
  process.exit(1);
}
const root = fromRest(start.data.source ?? start.data, undefined, 0);
const forks: Repo[] = [];
let level = [root];
while (level.length) {
  const next: Repo[] = [];
  // forks_count counts the whole subtree, so it's an upper bound on pages of direct forks.
  const pages = level.flatMap((p) => Array.from({ length: Math.ceil(p.directForks / 100) }, (_, i) => [p, i + 1] as const));
  await mapLimit(pages, async ([parent, page]) => {
    const batch = z.array(RestRepo).safeParse(await github(`repos/${parent.name}/forks?per_page=100&page=${page}&sort=newest`));
    for (const f of batch.data ?? []) {
      const fork = fromRest(f, parent.name, parent.depth + 1);
      forks.push(fork);
      if (fork.directForks > 0) next.push(fork);
    }
    progress(`walking forks: ${forks.length} found`);
  });
  level = next;
}
const byName = new Map([root, ...forks].map((r) => [r.name, r]));
for (const f of forks) {
  for (let p = byName.get(f.parent!); p; p = p.parent ? byName.get(p.parent) : undefined) p.descendants++;
}

// 2. Only forks pushed to after they were created can hold work of their own.
//    Big networks get capped: starred forks first, then the most recently pushed.
const touched = forks
  .filter((f) => Date.parse(f.pushedAt) - Date.parse(f.createdAt) > 60_000)
  .sort((a, b) => b.stars - a.stars || Date.parse(b.pushedAt) - Date.parse(a.pushedAt));
const candidates = touched.slice(0, MAX_COMPARED_FORKS);

// 3. Fetch branch heads, latest release and open issue counts in GraphQL batches.
const detailed = [...new Set([root, ...candidates, ...candidates.map((c) => byName.get(c.parent!)!)])];
const DETAILS = `
  hasIssuesEnabled
  issues(states: OPEN) { totalCount }
  pullRequests(states: OPEN) { totalCount }
  releases(first: 1, orderBy: {field: CREATED_AT, direction: DESC}) { nodes { tagName createdAt } }
  defaultBranchRef { name target { ... on Commit { oid committedDate } } }
  refs(refPrefix: "refs/heads/", first: ${BRANCHES_FETCHED}, orderBy: {field: TAG_COMMIT_DATE, direction: DESC}) {
    nodes { name target { ... on Commit { oid committedDate } } }
  }`;
const batches = Array.from({ length: Math.ceil(detailed.length / GRAPHQL_BATCH) }, (_, i) =>
  detailed.slice(i * GRAPHQL_BATCH, (i + 1) * GRAPHQL_BATCH),
);
let detailsDone = 0;
await mapLimit(batches, async (batch) => {
  const fields = batch.map(
    (r, i) => `r${i}: repository(owner: ${JSON.stringify(r.owner)}, name: ${JSON.stringify(r.repo)}) {${DETAILS}}`,
  );
  const res = GraphResponse.safeParse(await github("graphql", `{${fields.join("\n")}}`));
  batch.forEach((r, i) => {
    const parsed = GraphRepo.safeParse(res.data?.data?.[`r${i}`]);
    if (!parsed.success) return;
    const d = parsed.data;
    r.issuesEnabled = d.hasIssuesEnabled;
    r.openIssues = d.issues.totalCount;
    r.openPRs = d.pullRequests.totalCount;
    const rel = d.releases.nodes[0];
    if (rel) r.release = { tag: rel.tagName, date: rel.createdAt };
    for (const ref of [d.defaultBranchRef, ...d.refs.nodes]) {
      if (ref?.target?.oid && ref.target.committedDate) {
        r.heads.set(ref.name, { oid: ref.target.oid, date: ref.target.committedDate });
      }
    }
  });
  detailsDone += batch.length;
  progress(`reading branches: ${detailsDone}/${detailed.length}`);
});

// 4. Compare each candidate with its parent: the default branch, plus any recent
//    branch whose head the parent doesn't have. If a branch is ahead, its head commit
//    is the fork's own, so the head's date is the fork's latest own commit.
const branchRef = (r: Repo, branch: string) =>
  `${r.owner}:${r.repo}:${encodeURIComponent(branch).replaceAll("%2F", "/")}`;
async function compare(base: Repo, head: Repo, branch: string) {
  const c = Compare.safeParse(
    await github(`repos/${head.name}/compare/${branchRef(base, base.defaultBranch)}...${branchRef(head, branch)}?per_page=1`),
  );
  return c.success ? { ahead: c.data.ahead_by, behind: c.data.behind_by } : undefined;
}
let compared = 0;
await mapLimit(candidates, async (f) => {
  const parent = byName.get(f.parent!)!;
  const main = await compare(parent, f, f.defaultBranch);
  f.ahead = main?.ahead;
  f.behind = main?.behind;
  const parentOids = new Set([...parent.heads.values()].map((h) => h.oid));
  const ownDates: string[] = [];
  const mainHead = f.heads.get(f.defaultBranch);
  if (main?.ahead && mainHead) {
    f.ownBranches.push(f.defaultBranch);
    ownDates.push(mainHead.date);
  }
  const sideBranches = [...f.heads]
    .filter(
      ([b, h]) =>
        b !== f.defaultBranch &&
        !BOT_BRANCH.test(b) &&
        !parentOids.has(h.oid) &&
        Date.parse(h.date) > Date.parse(f.createdAt),
    );
  f.branchesCapped = sideBranches.length > MAX_BRANCHES_PER_FORK;
  for (const [branch, head] of sideBranches.slice(0, MAX_BRANCHES_PER_FORK)) {
    if ((await compare(parent, f, branch))?.ahead) {
      f.ownBranches.push(branch);
      ownDates.push(head.date);
    }
  }
  f.lastOwnCommit = ownDates.sort().at(-1);
  progress(`comparing forks: ${++compared}/${candidates.length}`);
});
progress("");

// 5. Score forks that have work of their own. Stars weigh most because they show
//    people actually use the fork; recent own commits, releases and open issues show
//    someone is maintaining it.
const ranked = candidates.filter((f) => f.ownBranches.length > 0);
for (const f of ranked) {
  const days = daysSince(f.lastOwnCommit!);
  f.score =
    3 * Math.log10(1 + f.stars) +
    Math.log10(1 + f.descendants) +
    Math.log10(1 + (f.ahead ?? 0)) +
    (days <= 90 ? 2 : days <= 365 ? 1 : days <= 730 ? 0.5 : 0) +
    (f.release && f.release.date > f.createdAt ? 1 : 0) +
    (f.issuesEnabled && f.openIssues + f.openPRs > 0 ? 0.5 : 0) -
    (f.archived ? 3 : 0);
}
ranked.sort((a, b) => b.score - a.score);

// 6. Look outside the fork network. GitHub only links forks made with the Fork button,
//    so a project that re-uploaded the code or moved to a new repo is invisible above.
//    Two cheap signals catch many of these: the original's README or description
//    pointing somewhere, and same-named repos that contain the original's first commit.
const SUCCESSOR_WORDS =
  /instead|supersed|recommend|consider|alternative|fork|maintain|successor|moved|migrat|replac|continu|new home/i;
const NOT_OWNERS: Record<string, true> = { orgs: true, sponsors: true, features: true, settings: true, topics: true, apps: true, marketplace: true };
const inNetwork = new Map([root, ...forks].map((r) => [r.name.toLowerCase(), r]));
const rootDescription = (start.data.source ?? start.data).description ?? "";
const readme = z.object({ content: z.string() }).safeParse(await github(`repos/${root.name}/readme`));
const readmeLines = readme.success ? Buffer.from(readme.data.content, "base64").toString("utf8").split("\n") : [];
const pointerQuotes = new Map<string, string>(); // repo the original points to -> the line that says so
for (const text of [rootDescription, ...readmeLines]) {
  if (!SUCCESSOR_WORDS.test(text)) continue;
  for (const [, owner, repo] of text.matchAll(/github\.com\/([\w.-]+)(?:\/([\w.-]+))?/g)) {
    if (NOT_OWNERS[owner.toLowerCase()]) continue;
    // A bare org link ("active fork: github.com/Nheko-Reborn") usually means the same repo name there.
    const name = `${owner}/${repo?.replace(/(\.git)?\.*$/, "") || root.repo}`;
    if (name.toLowerCase() !== root.name.toLowerCase() && !pointerQuotes.has(name)) {
      pointerQuotes.set(name, text.trim().replace(/\s+/g, " ").slice(0, 140));
    }
  }
}

const History = z.object({
  data: z.object({
    repository: z.object({ defaultBranchRef: z.object({ target: z.object({ history: z.object({ totalCount: z.number() }) }) }) }),
  }),
});
const history = History.safeParse(
  await github(
    "graphql",
    `{ repository(owner: ${JSON.stringify(root.owner)}, name: ${JSON.stringify(root.repo)}) {
      defaultBranchRef { target { ... on Commit { history { totalCount } } } } } }`,
  ),
);
const totalCommits = history.data?.data.repository.defaultBranchRef.target.history.totalCount;
const oldest = z
  .array(z.object({ sha: z.string() }))
  .safeParse(totalCommits && (await github(`repos/${root.name}/commits?sha=${root.defaultBranch}&per_page=1&page=${totalCommits}`)));
const firstCommit = oldest.data?.[0]?.sha;
const sameName = z
  .object({ items: z.array(RestRepo) })
  .safeParse(await github(`search/repositories?q=${encodeURIComponent(`${root.repo} in:name fork:false`)}&sort=stars&per_page=10`));
const lookalikes = (sameName.data?.items ?? []).filter((r) => r.name.toLowerCase() === root.repo.toLowerCase()).map((r) => r.full_name);

type Related = { name: string; stars: number; pushedAt: string; archived: boolean; where: string; quote?: string };
const related = (
  await mapLimit([...new Set([...pointerQuotes.keys(), ...lookalikes])], async (name): Promise<Related | undefined> => {
    const quote = pointerQuotes.get(name);
    // Renamed repos redirect, so look the name up before deciding it's outside the network.
    const repo = inNetwork.has(name.toLowerCase()) ? undefined : RepoWithSource.safeParse(await github(`repos/${name}`)).data;
    const known = inNetwork.get((repo?.full_name ?? name).toLowerCase());
    if (known) {
      if (!quote || known === root) return undefined;
      const rank = ranked.indexOf(known);
      const where = rank >= 0 ? `#${rank + 1} above` : "in the fork network, no commits of its own";
      return { name: known.name, stars: known.stars, pushedAt: known.pushedAt, archived: known.archived, where, quote };
    }
    if (!repo) return undefined;
    const sharesHistory =
      firstCommit !== undefined &&
      z.object({ sha: z.string() }).safeParse(await github(`repos/${repo.full_name}/commits/${firstCommit}`)).success;
    if (!sharesHistory && !quote) return undefined;
    const where = `outside the fork network${sharesHistory ? ", shares its history" : ""}`;
    return { name: repo.full_name, stars: repo.stargazers_count, pushedAt: repo.pushed_at, archived: repo.archived, where, quote };
  })
).filter((r) => r !== undefined);
const liveNamed = related
  .filter((r) => r.quote && !r.archived && daysSince(r.pushedAt) <= 365)
  .sort((a, b) => b.stars - a.stars)[0];

const rootLastCommit = [...root.heads.values()].map((h) => h.date).sort().at(-1) ?? root.pushedAt;
const rootQuiet = root.archived || daysSince(rootLastCommit) > 365;
const best = ranked[0];
const why = (f: Repo) =>
  [
    `${f.stars}★`,
    f.descendants && `${f.descendants} fork${f.descendants === 1 ? "" : "s"} of its own`,
    f.ahead && `${f.ahead} commit${f.ahead === 1 ? "" : "s"} ahead of ${f.parent}`,
    `last own commit ${age(f.lastOwnCommit)}`,
    f.release && f.release.date > f.createdAt && `release ${f.release.tag} ${age(f.release.date)}`,
  ]
    .filter(Boolean)
    .join(", ");
const rootState = `${root.name} ${root.archived ? "is archived" : rootQuiet ? "looks inactive" : "is still active"} (last commit ${age(rootLastCommit)}).`;
// Same set as `ranked`, so this is defined whenever `best` is.
const newest = ranked.reduce((a, f) => (f.lastOwnCommit! > a.lastOwnCommit! ? f : a), ranked[0]);
const namedNote =
  liveNamed &&
  `Its ${rootDescription.includes(liveNamed.quote!) ? "description" : "README"} points to ${liveNamed.name} (${liveNamed.stars}★, last push ${age(liveNamed.pushedAt)}${liveNamed.where.startsWith("#") ? "" : `, ${liveNamed.where}`}).`;
const forkNote = !best
  ? "No fork has commits of its own."
  : liveNamed && best.name !== liveNamed.name
    ? `Top fork in the network: ${best.name} (${why(best)}).`
    : liveNamed
      ? ""
      : !rootQuiet
        ? `Most notable fork: ${best.name} (${why(best)}).`
        : daysSince(best.lastOwnCommit!) <= 365
          ? `${best.name} looks like the one carrying it on: ${why(best)}.`
          : `Its most notable fork, ${best.name}, has gone quiet too (${why(best)}). Newest work of its own: ${newest.name} (${age(newest.lastOwnCommit)}).`;
const verdict = [rootState, namedNote, forkNote].filter(Boolean).join(" ");

if (asJson) {
  const plain = (r: Repo) => ({ ...r, heads: undefined });
  console.log(
    JSON.stringify(
      {
        root: { ...plain(root), lastCommit: rootLastCommit },
        input: target,
        forksWalked: forks.length,
        forksPushedAfterForking: touched.length,
        forksCompared: candidates.length,
        verdict,
        ranked: ranked.map(plain),
        related,
      },
      null,
      2,
    ),
  );
} else {
  const rows = ranked.slice(0, TABLE_ROWS).map((f, i) => [
    String(i + 1),
    f.name + (f.name.toLowerCase() === target.toLowerCase() ? " *" : "") + (f.archived ? " (archived)" : ""),
    f.depth > 1 ? f.parent! : "",
    String(f.stars),
    String(f.descendants),
    `${f.ahead ?? "?"}/${f.behind ?? "?"}`,
    `${f.ownBranches.length}${f.branchesCapped ? "+" : ""}`,
    age(f.lastOwnCommit),
    f.release && f.release.date > f.createdAt ? `${f.release.tag} (${age(f.release.date)})` : "",
    f.issuesEnabled ? String(f.openIssues) : "off",
  ]);
  const header = ["#", "fork", "forked from", "stars", "forks", "ahead/behind", "branches", "last own commit", "release", "issues"];
  const widths = header.map((h, c) => Math.max(h.length, ...rows.map((r) => r[c].length)));
  const line = (cells: string[]) => cells.map((cell, c) => cell.padEnd(widths[c])).join("  ").trimEnd();

  console.log(
    `${root.name}: ${root.stars}★, ${forks.length} forks in the network, ${touched.length} pushed to after forking, ${ranked.length} with commits of their own.`,
  );
  if (touched.length > candidates.length) {
    console.log(`Compared the top ${candidates.length} (starred first, then most recently pushed).`);
  }
  if (ranked.length) {
    console.log(`\n${line(header)}\n${rows.map(line).join("\n")}`);
    console.log("\nahead/behind and branches are measured against the repo each fork came from.");
  }
  if (related.length) {
    console.log(`\nNamed by ${root.name} or sharing its history:`);
    for (const r of related) {
      console.log(`  ${r.name}  ${r.stars}★  pushed ${age(r.pushedAt)}${r.archived ? " (archived)" : ""}  ${r.where}`);
      if (r.quote) console.log(`      "${r.quote}"`);
    }
  }
  console.log(`\n${verdict}`);
}
console.error(`(${restCalls} REST + ${graphqlCalls} GraphQL calls)`);
