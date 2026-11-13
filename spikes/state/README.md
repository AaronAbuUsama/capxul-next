# State spike

Throwaway code that closes two risks from [the roadmap](../../docs/roadmap.md): Alchemy state shared between
containers, and deleting expired Cloudflare resources without anyone remembering to. Same setup as
[the hosting spike](../hosting/README.md): `alchemy` 2.0.0-beta.85 on Effect 4.1.2, run with Bun from an agent's
container, with the Cloudflare key added by the session's network proxy. Nothing here is product code.

The stack is `CapxulSpikeState`. Every stage is one tiny Worker, standing in for a world's Cloudflare resources, and
its state is in the account's shared state store (`Cloudflare.state()`), not on local disk.

## What is proven (13 November 2026, from a Claude cloud container)

"Directory B" below is a second copy of this code in a fresh directory, run with a fresh home directory: no
`.alchemy` folder and no cached credentials. It stands in for another agent's container.

| Question | Result |
|---|---|
| Can a stage deployed from one container be planned from another that has never seen it? | Yes. `deploy --stage st-a` from this directory took 12 s. `plan --stage st-a` from directory B printed `Plan: no changes` in 7 s. |
| Can the other container read what the stage recorded? | Yes. From B, `state list CapxulSpikeState/st-a` listed `Hello` and `output`, and `state read CapxulSpikeState/st-a/output` printed the owner and the expiry. |
| Can the other container destroy it? | Yes. `destroy --stage st-a --yes` from B printed `Done: 1 succeeded` in 6 s. Cloudflare then answered 404 for the Worker's settings and for its address, and the stage was gone from the store. |
| Does a sweeper delete expired stages from the shared store alone? | Yes. `src/sweep.ts`, run from B, listed three stages. It destroyed `st-expired` (expiry 07:48:26, swept at 07:48:58, destroy 6.4 s, whole sweep 11 s), kept `st-live` ("kept: not expired") and kept `st-noexpiry` ("kept: no expiry recorded"). Cloudflare then listed only the two kept Workers. |
| Does the sweeper leave a stage alone before its expiry? | Yes. A real sweep 13 s before the expiry kept all three. |
| Does the sweeper leave a stage whose expiry it cannot read? | Yes. A stage recorded with `expiresAt: "next tuesday"` was reported "kept: expiry unreadable" and not touched. |
| Does a drift check tell a clean stage from one changed by hand? | Partly; see the next table. |

### Drift

`st-live` had its workers.dev address turned off through the Cloudflare API. `st-noexpiry` had its code replaced
through the Cloudflare API (its address then answered "changed by hand").

| Check | Clean stage | Address turned off by hand | Code replaced by hand |
|---|---|---|---|
| `alchemy drift` 2.0.0-beta.85 (our pin) | exit 0, `Plan: no changes` | **exit 0**, `Plan: 1 to update` | exit 0, `Plan: no changes` |
| `alchemy drift` 2.0.0-beta.87 | exit 0 | exit 2, `Plan: 1 to update` | **exit 0**, `Plan: no changes` |
| `src/run-drift.ts` on 2.0.0-beta.85 | exit 0, `in-sync` | exit 2, `drifted` | **exit 0**, `in-sync` |

Two things follow. The exit code 2 that the documentation describes arrived after our pinned version: on beta.85 a
scheduled job must use the programmatic check (`Alchemist.Drift.scan` and `hasDrift`, as `src/run-drift.ts` does) or
move the pin. And on both versions the drift check does not look at a Worker's code, only its settings (address,
routes, domains, schedules, tags): a clean drift check does not show that the deployed code is ours. `plan` did not
see the replaced code either.

## What the state store is, and what was left in place

The store did not exist. `./run.sh state bootstrap` created it once, in 23 s. It is one per Cloudflare account, shared
by every stack and stage that uses `Cloudflare.state()`, and it is **left in place on purpose**:

| Left in the account | What it is |
|---|---|
| Worker `alchemy-state-store` | The store's API, on `alchemy-state-store.thedao.workers.dev`. Answers 401 without its token; `/version` is open and says `8`. |
| Durable Object namespace `alchemy-state-store_Store` | Where the state is kept (SQLite), encrypted with the key below. |
| Secrets Store `default_secrets_store` | The account had no Secrets Store; bootstrap created this one. It holds two secrets, `AlchemyStateStoreToken` and `AlchemyStateStoreEncryptionKey`. |

It holds no state now: every stage and the stack's own record were deleted. Cost: the account is already on the
Workers Paid plan, an idle Worker and an empty Durable Object are not charged for, and the two secrets are well inside
the Secrets Store's free allowance. This was read from the plan list and Cloudflare's published prices, not from a
bill. To remove it: `alchemy state teardown --backend cloudflare` (it would also delete the Secrets Store if nothing
else is in it by then).

## What was learned on the way

- **Two deploys of the same stage at once are not stopped.** Two processes deployed `st-race` at the same moment. Both
  ended `Done: 1 succeeded`. Cloudflare had two Workers; the store recorded one. The other was an orphan that no
  destroy would ever find (it was deleted here by name). The Cloudflare store has no lock, in beta.85 and in
  beta.87. Alchemy's bucket stores and its Postgres store do lock a stage (read from its source and documentation,
  not run). Until the Cloudflare store does, a world must be created by one process only, under a name nobody else
  can pick, or the state must move to `postgresState` on Neon.
- With `CI=true` a missing store is an error (`Cloudflare State Store 'alchemy-state-store' not found`), not something
  a deploy creates on the way. It is created once with `state bootstrap`.
- With `CI=true` nothing is cached on disk: every command fetches the store's token again through a short-lived
  preview of the store's Worker, which adds about 3.5 s to each command. Any holder of the Cloudflare key can do
  this, so the store adds no new secret to hand out.
- A `.alchemy/` folder still appears beside the stack file. It holds run logs and Worker bundles, no state.
- The sweeper needs only the stack file and the store. Destroy never runs the stack's program, so the sweeper needs
  none of a stage's settings.
- A stack's outputs are written when a deploy succeeds. A stage whose first deploy died half-way has resources and no
  recorded expiry. The sweeper reports it ("kept: no expiry recorded") and does not delete it. This was read from
  Alchemy's source, not run.

## Not yet proven

- The sweeper on a schedule. It is a program that exits 0 or 1; nothing runs it yet. It needs somewhere with Bun and
  the Cloudflare key, such as a scheduled CI job.
- A stage that died half-way through its first deploy (above).
- A stage lock for the Cloudflare store, or `postgresState` on Neon in its place.
- The sweeper over a stack with Neon branches as well as Workers.

## Run it

`./run.sh deploy --stage <st-name> --yes` with `WORLD_OWNER` and `WORLD_EXPIRES_AT` (an RFC 3339 time) set; leave the
second out to record no expiry. `./run.sh plan|destroy|drift --stage <st-name>` and `./run.sh state list|read <path>`
work from any copy of this directory. `./run.sh bun src/run-sweep.ts [--dry-run]` sweeps the stack and prints a
report. `./run.sh bun src/run-drift.ts <st-name>` checks one stage for drift. Finish with a destroy for every stage.
Never run `alchemy nuke`: it deletes every resource in the account, not only this stack's.
