# Finding the fork that kept going

I wanted to know if there's a better-maintained fork of [Requestrr](https://github.com/darkalfx/requestrr). GitHub's [network graph](https://github.com/thomst08/requestrr/network) didn't help: it's a wall of lines you have to pan around, and it doesn't tell you which fork people actually use. So I tried the existing tools, then wrote a small one, `gh network`, and tested both on 14 abandoned-looking repos.

`gh network owner/repo` walks the whole fork network, including forks of forks. It compares each fork with the repo it came from on every recent branch, not just the main one. Then it ranks the forks by stars, forks of their own, recent commits, releases and open issues. It also reads the original's README and description for "use X instead" links. It also checks repos with the same name for the original's first commit. That catches successors that GitHub doesn't count as forks.

Here's Requestrr, trimmed to fit:

```
$ gh network thomst08/requestrr
#  fork                  forked from         stars  forks  ahead/behind  last own commit  release
1  thomst08/requestrr *                      491    43     134/3         4mo ago          V2.1.10 (4mo ago)
2  slmlm2009/requestrr…  thomst08/requestrr  1      0      8/7           12mo ago         V2.1.9 (12mo ago)
…
darkalfx/requestrr is archived (last commit 3y ago). thomst08/requestrr looks like the one carrying it on.
```

So Requestrr checks out. thomst08's fork is still the one to use, and none of the forks under it has taken over.

To test it, I found repos where the maintainer named a successor (mostly in the repo description) and compared three tools. I used GitHub's own forks page with its default settings, [Fork Finder](https://forkfinder.getinfotoyou.com/) (the best existing tool I found) and `gh network`.

| Original | Known successor | GitHub forks page | Fork Finder | gh network |
|---|---|---|---|---|
| [vue-animate](https://github.com/haydenbbickerton/vue-animate) | asika32764 (fork) | ✅ | ✅ | ✅ #1 |
| [pascal-language-server](https://github.com/arjanadriaanse/pascal-language-server) | castle-engine (fork of a fork), genericptr (separate repo) | ❌ | ❌ | ✅ both |
| [dhis2-fhir-adapter](https://github.com/dhis2/dhis2-fhir-adapter) | ITINordic (fork) | ❌ | ✅ | ✅ #1 |
| [Alt_nCov2019_primers](https://github.com/ItokawaK/Alt_nCov2019_primers) | nasasaki (fork, 0 stars) | ❌ | ✅ | ✅ #1 |
| [inventory-tweaks](https://github.com/mkalam-alami/inventory-tweaks) | Inventory-Tweaks (fork) | ❌ | top 3 | ✅ #1 |
| [gominer](https://github.com/Dirbaio/gominer) | decred (fork) | ❌ | ✅ | ✅ #1 |
| [pourover](https://github.com/nytimes/pourover) | hhsnopek (fork) | ❌ | top 3 | ✅ #1 |
| [requestrr](https://github.com/darkalfx/requestrr) | thomst08 (fork) | ✅ | ✅ | ✅ #1 |
| [monarchmoney](https://github.com/hammem/monarchmoney) | bradleyseanf (fork) | ✅ | ✅ | ✅ #1 |
| [spot](https://github.com/xou816/spot) | Diegovsky/riff (separate repo) | ❌ | ❌ | ✅ from README |
| [nheko](https://github.com/mujx/nheko) | Nheko-Reborn (separate repo) | ❌ | ❌ | ✅ from description |
| [overseerr](https://github.com/sct/overseerr) | seerr-team/seerr (separate repo) | ❌ | ❌ | ✅ from README |
| [spectacle](https://github.com/eczarny/spectacle) | none; Rectangle is a rewrite | ❌ | ❌ | ✅ notes Rectangle from README |
| [atom](https://github.com/atom/atom) | pulsar-edit/pulsar (separate repo) | ❌ | ❌ | ❌ |

What I learned:

- **GitHub's forks page** hides anything older than 2 years by default, so 7 of the 12 old repos showed zero or one fork. Change the period to 5 years and sort by stars before you give up on it.
- **Fork Finder** works without a GitHub token, but it skips forks of forks. It also scores almost every quiet fork 0, so its single "best fork" pick was right 4 times out of 7.
- **Separate repos are the big blind spot.** 5 of the 12 successors aren't GitHub forks at all, so no fork-list tool can see them. The original's README usually says where it went, so check there first. Atom is the one I couldn't solve: Pulsar re-uploaded the code under a new name, and Atom's README never mentions it.

To be fair, most of these successors are named in the original's description, and `gh network` reads that. But the fork ranking alone, without the README check, still put the right fork first in all 9 cases where the successor is a fork.

It needs the [GitHub CLI](https://cli.github.com/) and [Bun](https://bun.sh/). Small networks take a few seconds. Atom's 17,000 forks took about 2 minutes and 1,000 API calls.
