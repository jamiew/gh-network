# gh network

Find the fork that kept going.

```sh
gh extension install jamiew/gh-network
gh network owner/repo
```

You need [GitHub CLI](https://cli.github.com/) and [Bun](https://bun.sh/).
Add `--json` for the full results as JSON.

`gh network` walks forks and forks of forks, then checks which have their own
work on recent branches. It ranks them by stars, forks, recent commits, releases,
and open issues. It also checks the original README and description for links to
successors, and looks for same-named repos with the original's first commit.

## Example: monarchmoney

[hammem/monarchmoney](https://github.com/hammem/monarchmoney) has 153 forks.
`gh network` picks [bradleyseanf/monarchmoneycommunity](https://github.com/bradleyseanf/monarchmoneycommunity),
which kept going after the original went quiet. More in the
[blog post](https://jamiedubs.com/blog/gh-network/).

Each fork's life, from creation to its last commit of its own:

[![Each monarchmoney fork drawn as a line from creation to its last commit of its own](https://jamiedubs.com/images/blog-posts/gh-network/monarchmoney-forks-lifelines.jpg)](https://jamiedubs.com/images/blog-posts/gh-network/monarchmoney-forks-lifelines.svg)

How much work each fork has of its own versus how recently it had any:

[![Scatter plot of monarchmoney forks by commits of their own and date of their last commit](https://jamiedubs.com/images/blog-posts/gh-network/monarchmoney-forks-scatter.jpg)](https://jamiedubs.com/images/blog-posts/gh-network/monarchmoney-forks-scatter.svg)

For fun, the fork tree with distance from the center as time:

[![The monarchmoney fork tree drawn radially, where distance from the center is time](https://jamiedubs.com/images/blog-posts/gh-network/monarchmoney-forks-radial-time.jpg)](https://jamiedubs.com/images/blog-posts/gh-network/monarchmoney-forks-radial-time.svg)

## How well does it work?

I tried it on 14 repos with a known successor. It ranked the right fork first
in all 9 cases where the successor was a fork. It also found 4 of 5 successors
that were separate repos. [See the cases](eval/cases.json).

| | GitHub forks | [Fork Finder](https://forkfinder.getinfotoyou.com/) | gh network |
|---|---:|---:|---:|
| Right fork ranked first (9 repos) | 3 | 6 | 9 |
| Separate successor found (5 repos) | 0 | 0 | 4 |
| Checks forks of forks | No | No | Yes |
| Checks branches | No | No | Yes |

It missed Atom → [Pulsar](https://github.com/pulsar-edit/pulsar). Atom doesn't
link to Pulsar, and Pulsar moved the code to a new repo name.

To rerun the cases, use `bun run eval`. Add new examples to
[eval/cases.json](eval/cases.json).
