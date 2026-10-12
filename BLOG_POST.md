# Finding the fork that kept going

I wanted to find a better-maintained fork of [Requestrr](https://github.com/darkalfx/requestrr). GitHub's [network graph](https://github.com/thomst08/requestrr/network) was a wall of lines, with no clue which fork people used. I tried a couple of tools, then wrote `gh network` and checked it against 14 repos.

`gh network owner/repo` walks the forks, including forks of forks. It checks recent branches for work of their own, then ranks forks by stars, forks, recent commits, releases, and open issues. It also checks the original README and description for successor links, and looks for same-named repos with the original's first commit.

Here's Requestrr, trimmed to fit:

```
$ gh network thomst08/requestrr
#  fork                  forked from         stars  forks  ahead/behind  last own commit  release
1  thomst08/requestrr *                      491    43     134/3         4mo ago          V2.1.10 (4mo ago)
2  slmlm2009/requestrr…  thomst08/requestrr  1      0      8/7           12mo ago         V2.1.9 (12mo ago)
…
darkalfx/requestrr is archived (last commit 3y ago). thomst08/requestrr looks like the one carrying it on.
```

The result is right: thomst08's fork is active, and none of its forks has taken over.

I tested 14 repos where someone had named a successor. I compared `gh network` with GitHub's forks page and [Fork Finder](https://forkfinder.getinfotoyou.com/), the best tool I found.

| Original | Known successor | GitHub forks | Fork Finder | gh network |
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

GitHub's forks page hides repos older than 2 years by default. Fork Finder skips forks of forks, and its top pick was right in 4 of 7 fork cases. `gh network` ranked the right fork first in all 9 fork cases and found 4 of 5 separate repos.

Separate repos are the hard part. Five successors weren't GitHub forks, so a fork list can't show them. The original README or description often points to them. Atom didn't point to Pulsar, which had moved the code to a new repo name, so I missed it.

Small networks take a few seconds. Atom's 17,000 forks took about 2 minutes and 1,000 API calls. You need [GitHub CLI](https://cli.github.com/) and [Bun](https://bun.sh/).
