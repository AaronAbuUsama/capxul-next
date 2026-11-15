# Bench templates never change (14 November 2026)

Two CI `world` runs at once broke each other on `staging`: site templates were named after their starting point
(`payment-drafted`) and any run replaced them and dropped them at its end, so one run dropped `payment-drafted` while
another was about to take from it, and `world.yml` ran one at a time. The rule that followed is the roadmap decision
"Bench templates never change" ([docs/roadmap.md](../../../../docs/roadmap.md)); how the site service keeps it is
`door/templates.py`'s header.

This folder proves it on a stand-in bench (`run.sh`: the real `door/door.py`, `bench` replaced by
`../backup-async/bench-stand-in.sh`, pymysql and the bench's Python by `stand-in/`, so no MariaDB), with two runs A and
B at once doing at the site service what the runner does with its one world's site: made from nothing, kept as a site
template, removed by a reset to `fresh`, taken back by a reset to `payment-drafted`.

| | Before, named after the starting point (`old-door.json`) | After, named by what it holds (`new-door.json`) |
|---|---|---|
| B keeps its site template while A is going | replaces A's `payment-drafted` | makes `payment-drafted-3f9a0c1d-wb`; A's `…-wa` untouched |
| A takes its site back | 200, a copy of **B's** site (B's company facts in A's world) | 200, a copy of its own |
| A's run ends | drops `payment-drafted` | drops nothing |
| B takes its site back | **404 `template-not-found`**: the failure seen in CI | 200, a copy of its own |
| Two makes of one new name at once | | one made (`made: true`), the other answered with it (`made: false`) |
| Another world makes a name that exists | | nothing made, answered with the first world's (`made_by`), which `packages/world` refuses |
| Sweeps (floor 2 s for the proof) | | `idle_s` 1 refused; idle 30 s removed nothing (one busy refilling its pool); after a take, idle 3 s removed the two unused and kept the one just taken from; 3 s later removed it |

`client.json` is `packages/world`'s own client (`client.ts.txt`) against the same site service: `templateCode` read the
`app` fingerprint and fingerprinted the code in under 0.1 s; `keepTemplate` made `payment-drafted-<code>-wd`, answered
`made: false` the second time, and failed for world `we` ("made by world wd, not we"); `sweepTemplates` kept it at once
and removed it 2.5 s later with `WORLD_TEMPLATE_IDLE` at 2 seconds.
