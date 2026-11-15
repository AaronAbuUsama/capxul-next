# No call holds a request past Cloudflare's edge (14 November 2026)

Four `world` runs at once on `staging` met HTTP 524 on a reset's take: with four runs building, taking, saving and
resetting, a take, a save or a reset waited for one of `DOOR_FAST_SLOTS`, and behind joins slowed by a busy machine,
on the request's path. Every such call can now run as a job (`door/jobs.py`, `Prefer: respond-async`): no request is
held longer than the site service's 20 s wait, and the work takes as long as it did. The site service's unit tests
(`door/tests/test_jobs.py`) drive it over HTTP.

This folder measured the site service before and after on a stand-in bench as busy as `staging` was, every time a
tenth of the bench's (one fast slot for four runs, a take's join 4 s, Cloudflare's 100 s as 10 s, the 20 s wait as
2 s), four runs at once, each making its site, keeping a site template, saving, removing, taking, saving, resetting,
setting its clock and taking its world down (`prove.py`, `run.sh`; `old-door.json`, `new-door.json`).

| | Before, asked as before | After, `Prefer: respond-async` | After, asked as before (an old client) |
|---|---|---|---|
| Longest request | 16.0 s: a take, and 12.0 s a save, past the edge (524 through Cloudflare) | 2.0 s | 4.0 s (one run) |
| Every call ended well | yes, on this machine; not through Cloudflare | yes | yes |
| The four runs, whole | 50.4 s | 50.4 s | |

`packages/world`'s own client (`client.ts.txt`) ran two worlds at once against each: every call ended well on both, a
take taking 5.0 s through a job after and 4.0 s held open before (`client.json`, `old-client.json`).
