# gh network

When a GitHub project goes quiet, someone often keeps it going in a fork.
GitHub makes that fork hard to find.
`gh network` finds it for you.

## Getting started

You need the [GitHub CLI](https://cli.github.com/) and [Bun](https://bun.sh/).

```sh
gh extension install jamiew/gh-network
gh network darkalfx/requestrr
```

## How it compares

I tested it on 14 repos where we already know which fork took over.
They're listed in [eval/cases.json](eval/cases.json).

| | GitHub's forks page | [Fork Finder](https://forkfinder.getinfotoyou.com/) | gh network |
|---|---|---|---|
| Put the right fork first (9 repos) | 3 | 6 | 9 |
| Found a successor that isn't a fork (5 repos) | 0 | 0 | 4 |
| Looks at forks of forks | No | No | Yes |
| Looks at every branch | No | No | Yes |
| Works without installing anything | Yes | Yes | No |

The one it missed is Atom → [Pulsar](https://github.com/pulsar-edit/pulsar), which isn't linked from Atom at all.

## What it does

It lists every fork, including forks of forks.
It checks which forks have commits of their own, on any branch.
It ranks them by stars, forks, recent commits, releases and open issues.
It reads the original's README for "use this instead" links.
It looks for same-named repos that share the original's history.

## Tips

Add `--json` to get the full results as JSON.
Big networks are slow: Atom's 17,000 forks take about 2 minutes.

## Testing

Run `bun run eval` to check every repo in `eval/cases.json` again.
Add a repo there when you find a new good example.
