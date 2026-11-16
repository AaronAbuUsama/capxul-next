# The site service's API

The site service (`door/door.py`, the HTTP side and its checks, with `door/sites.py` and the modules beside it doing
the work) is the only process that makes, uses or removes a company's site on the bench. Each module's header says how
it works; this page is the API a caller sees. `packages/world` is its caller (`src/site/call.ts`).

## Where a world reaches it

The platform stack records `doorUrl`: `http://<stage>-door.<domain>` through the tunnel or, with `PLATFORM_EDGE=none`,
the host's loopback port (only the host itself reaches it).

## The token

A world's token is minted when the world is created (`src/token.ts`; `mint`, `doorKey`, `doorKeyIn` and
`platformOutputsIn` are exported through `src/door.ts` for `packages/world`) and travels in `X-Capxul-Site-Token`:

`v1.<world>.<quota>.<expires>.<HMAC-SHA256 under the platform's door key over the rest>`

where `<world>` is the blueprint's `WorldName`. The site service checks the signature (a world cannot widen its own
token), the expiry, the site's name (`<label>-<world>.<domain>`, the roadmap's `<company>-<world>`; a label has no
dash, so the name says whose site it is), that a site asked about is the token's world's (`site-not-in-world`
otherwise), and for a new site the quota, before any work. The door key is an `Alchemy.Random` of the platform stage
(`DoorKey-g<n>`), read from the shared state by whoever holds the Cloudflare key (`src/state.ts`), never an output. A
new `PLATFORM_DOOR_KEY_GENERATION` replaces it and so revokes every token.

## The calls

| Call | What |
|---|---|
| `POST /sites {label, company, api_key, api_secret}` | Answers 202 and makes the site in the background: a ready copy of the company's template, the wizard already run, then joined to the world; with none yet, a copy of the bench's blank company site ([site-templates.md](site-templates.md)) with the wizard run for the company, every app's `after_migrate` hooks, joining the token's world (its clock), the scheduler, and an API user of the site's own, `capxul-core@service.invalid`, with the key and secret the world sent and the roles `Accounts User`, `Purchase User`, `Sales User`; never the bench's Administrator. With no blank it is made from nothing, one at a time (2 to 4 minutes). `GET /sites/<site>`'s `made_from` says which (`{template, how, fell_back}`, `how` being `company pool`, `company copy`, `blank pool`, `blank copy` or `from nothing`, and `fell_back` the reason it was not the company pool, or null), and each fallback is also a `site.make.fell_back` step |
| `GET /sites/<site>`, `GET /world` | A site's state (`creating`, `ready`, `failed`) with each step's time; the world's sites |
| `ANY /sites/<site>/api/...` | One call to the site's own REST API, carried to web with the site's Host, as the user `Authorization: token <key>:<secret>` names. Cookies are dropped and any other credential refused; a site not ready answers `site-creating` or `site-failed` |
| `DELETE /sites/<site>`, `DELETE /world` | Removes a site (`bench drop-site`, its archive deleted; if that fails, its database and user dropped directly), or every site of the world, its saved backups and its site snapshots. A token of quota 0 may do it, so the sweeper can for an expired world |
| `POST /world/backup {snapshot}` | Starts saving every ready site of the world under the snapshot's name (`door/snapshots.py`) and answers 202 `saving` at once; a second save of the name replaces it |
| `GET /world/backup/<snapshot>` | That backup: `saving`; `saved` with each site's `{site, label, ms, bytes}`; or `failed` with `error`. None answers `backup-not-found` |
| `POST /world/restore {snapshot, api_key, api_secret, clock}` | With the source world's token in `X-Capxul-Source-Token` as well: makes every site that world saved as the snapshot again in the token's world, under the same label, and answers 202. Within the token's quota |
| `POST /templates {template, site}` or `{template, snapshot}` | Makes a site template from a ready site of the token's world or from every site of a backup it saved; answers 200 with `made: true` (about 3 s a site), then fills its pool in the background. A name that exists makes nothing and answers `made: false` with each site's `made_by`. A name beginning `blank-` is refused (`template-reserved`) |
| `GET /templates` | Every whole site template (the blank too), its sites, how many ready copies each has in the pool, when it was last used (`used_at`, `idle_s`), the last refills' times, `pool_size`, `blank_pool_size` and `blank` (its name, whether it is `usable`, its make's time and steps, or its last failure) |
| `POST /templates/sweep {idle_s, dry_run?}` | Removes every site template unused for more than `idle_s` (at least `DOOR_TEMPLATE_MIN_IDLE_S`, an hour by default; `sweep-idle-invalid` otherwise), with its pool, and skips one whose lock is held. Answers `{removed, kept, busy}` |
| `DELETE /templates/<template>` | Removes a site template, its pool and their databases. For a person: no run removes one by name |
| `GET /health` | `{ok: true, app}`: `app` is a hash of the apps the bench makes sites with, read at the start, which a site template's name fingerprints |
| `POST /world/claim {template, api_key, api_secret, clock?, browser_core_url?}` | Takes a ready copy of every site of the site template for the token's world, each `<label>-<world>.<domain>`, within its quota, and answers 200 when they are ready (`door/claim.py`). The site is then a site of the world like one made by `POST /sites`. It holds the template world's company facts, so the world must hold the matching chain state |
| `POST /world/save {point}` | Saves every ready site of the world to a site snapshot (`point` in code: `door/points.py`). A second save of the name replaces it |
| `POST /world/reset {point}` | Resets every site the site snapshot holds in place (same name, database and credential), then the world's clock entry. Refuses `point-invalid` (400), `point-not-found` (404), `point-site-missing` or `point-site-changed` (409) |
| `GET /world/points`, `DELETE /world/points/<point>` | The world's site snapshots; removes one and its saved databases |
| `Prefer: respond-async` on `POST /templates`, `/templates/sweep`, `/world/claim`, `/world/save`, `/world/reset`, `/clock`, `DELETE /world`, `/sites/<site>` | The call runs as a job (`door/jobs.py`): the site service waits up to `DOOR_JOB_WAIT_S` (20 s), then answers as the call always has, or 202 `{job, state: running, what, running_ms}` while it still runs. `packages/world` asks for every one (`doorJob`) |
| `GET /world/jobs/<job>` | That job, with the same world's token: waits again, then the call's own answer, or 202 while it runs. Another world's job, or one a restarted site service forgot, is `job-not-found` |

Long work never holds a request: a site made from nothing, a backup and a restore answer 202 and run in the
background, and every other long call can run as a job, so no request waits past Cloudflare's 100 s.
