# How a world's sites are made on the bench

### A company's site (step 1.4)

`src/things/site/bench.ts`, and two steps of a world's life:

| When | What |
|---|---|
| claim | With `WORLD_BENCH=<platform stage>`, the world's site token is minted under that platform's door key (read from the shared state with the world's own store, `@capxul/platform`'s `doorKeyIn` and `mint`), for this world, `WORLD_MAX_SITES` (3) sites and the world's expiry. The bench is written into the world's record before anything exists, and into its outputs. |
| deploy | Core is deployed with the token and the site door's address (src/parts/api/Api.ts). |
| `site`, after `core` | Each company of `spec.companies` (`--company label=Name,...`): the door makes the site with the world's token and the world's site credential, and the step waits until every site is ready (declared timeout 8 minutes). |
| `unsite`, before `destroy` | Every take-down (a destroy, a failed or interrupted run, a failed create, the sweeper) removes every site of the world from the bench its record names, with a token minted anew (quota 0, 15 minutes: the world's own may have expired), and checks the door holds none. If that fails, the world's Cloudflare and Neon resources are still destroyed, but its name is kept and its record is written again, since Alchemy's destroy deletes it with the resources: its owner and bench, status `unsite failed` and an expiry of now, so `list` shows it and the next sweep removes the sites and then the record. A destroy that fails is recorded the same way, as `destroy failed`, with its hub, whether or not Alchemy had deleted the record yet (`keepRemains`; `test/remains.test.ts` runs both against an in-memory state store and a bench door that answers 530, then a sweep once it is back). |

A call to the site door that waits on what other worlds hold on a busy bench (a claim from a template, a save, a
reset, a template's making, the sweep, the clock, a removal) goes through `doorJob` (`src/things/site/client.ts`): it asks
with `Prefer: respond-async`, the door answers within its own wait (20 s) with the call's answer or a 202 and a job,
and the job is polled until it ends, so no request outlasts the 100 s Cloudflare's edge allows (a `524`, which one of
the four runs of 14 November 2026 met on a reset's claim). A door from before jobs ignores the header and answers when
done, and the client takes either (`test/jobs.test.ts`; packages/platform `records/capacity`, `client.json`).

Why here: the world owns what runs where and is the only thing that lives and dies with its sites, so making and
removing them are world steps; reaching a site is what Core's operations will do, so that is a Core service
(`packages/core`, `SiteDoor`), which reads the token and credential the world bound into it. The site door
(`packages/platform`, `door/door.py`) is the only process that makes or removes sites, and the only way to a site: it
checks the token's world against the site's on every call and carries ERPNext's REST calls on the site's own API user.
Until `org.create` makes a company's site, the world makes it at create; one credential serves the world's sites.
