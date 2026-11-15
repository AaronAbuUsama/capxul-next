# A backup and a removal never hold a call through Cloudflare's edge (14 November 2026)

PR #227's CI run 43599082569 failed with HTTP 524 on `world.snapshot.save`: a second `world.yml` run built its
template world's site from nothing on `staging` at the same time, and `POST /world/backup` waited on the request's path
for `BENCH_LOCK` past Cloudflare's 100 s (CI run 43599154936 beside it failed the same way). The backup now runs in the
background (`GET /world/backup/<snapshot>` for its state) and a ready site's removal no longer takes `BENCH_LOCK`.

This folder measured both site services, the one before and the new one, on a stand-in bench (`prove.py`: the real
`door/door.py`, `bench` replaced by `bench-stand-in.sh`, whose `new-site` of another world's site holds the bench lock
for 130 s), with `packages/world`'s own client saving the world (`save.ts.txt`). Results: `old-door.json` and
`new-door.json`.

| Call, while another world's site is made from nothing | Before | After |
|---|---|---|
| `POST /world/backup` | 200 after 132.2 s (Cloudflare answers 524 at 100 s) | 202 `saving` after 2 ms |
| `DELETE /sites/<ready site>` | 200 after 130.5 s | 200 after 1.0 s |
| `packages/world`'s save (`backUp`: the POST, then `GET` until saved) | 131.4 s, one call held throughout | 130.3 s, no call over a second |
