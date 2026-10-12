// Check gh network's results against cases.json.
// Run with: bun run eval
import { $ } from "bun";
import { z } from "zod";

const Cases = z.object({
  cases: z.array(
    z.object({
      repo: z.string(),
      expect: z.array(z.object({ repo: z.string(), as: z.enum(["top", "related"]) })),
      knownMiss: z.boolean().optional(),
    }),
  ),
});
const Output = z.object({
  ranked: z.array(z.object({ name: z.string() })),
  related: z.array(z.object({ name: z.string() })),
});

const { cases } = Cases.parse(await Bun.file(new URL("cases.json", import.meta.url)).json());
const script = new URL("../gh-network.ts", import.meta.url).pathname;
let failures = 0;
for (const c of cases) {
  const out = Output.safeParse(JSON.parse((await $`bun ${script} ${c.repo} --json`.quiet().nothrow()).stdout.toString() || "null"));
  const ranked = out.data?.ranked.map((r) => r.name.toLowerCase()) ?? [];
  const related = out.data?.related.map((r) => r.name.toLowerCase()) ?? [];
  for (const e of c.expect) {
    const want = e.repo.toLowerCase();
    const rank = ranked.indexOf(want);
    const ok = e.as === "top" ? rank === 0 : related.includes(want);
    const found = !out.success ? "gh network failed" : rank >= 0 ? `ranked #${rank + 1}` : related.includes(want) ? "listed separately" : "not found";
    if (!ok && !c.knownMiss) failures++;
    console.log(`${ok ? "pass" : c.knownMiss ? "miss (known)" : "FAIL"}  ${c.repo} -> ${e.repo} (want ${e.as}, got ${found})`);
  }
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
