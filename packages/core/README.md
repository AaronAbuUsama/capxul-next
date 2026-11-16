# core

The api (`packages/core` in code): the Capxul server. One Cloudflare Worker, written in Effect and deployed by Alchemy,
that carries out a world's operations over HTTP with Effect's own Rpc server, and keeps every call's spans in its
database for the runner. What each operation does, its payload, answer, refusals and events, is the blueprint's
(`packages/blueprint`); the handlers are how.

## What it serves

- The world group at `/world`: every operation inside one world, at the world's endpoint (`CAPXUL_DOOR_URL`), each a
  POST of Effect Rpc in JSON at the path the blueprint declares (`src/doors.ts`).
- The account group at `/platform`: served for real by `packages/world` (`src/platform`), with the api's own sign-in
  and span middlewares. The api's account handlers are empty and refuse with `NotImplemented` (`src/domains/world.ts`).
- The world's read-only chain JSON-RPC at `/chain` (`src/chain.ts`), and `/health` and the site probe
  (`src/probe.ts`), which are not operations. Any other path answers 404 in JSON.

What every call gets, a span under the caller's trace and a signed-in caller, is in the headers of
`src/telemetry/middleware.ts` and `src/telemetry/spans.ts`. A deploy with `CAPXUL_HANDLERS=empty` serves every
operation as `NotImplemented` (`src/empty-handlers.ts`), so a journey can be shown to fail against empty handlers.

## Where it runs

The same code in two places. What a deploy binds is a `Deployment` (`src/stack/deployment.ts`); the running Worker
reads its facts per request, by the names in `src/env.ts`.

- A world's api (`packages/world`, `src/core/Core.ts`), bound to the world's database, endpoint and sites.
- A stage of its own stack `CapxulCore` (`alchemy.run.ts`), named `core-<6 hex>`, with a Neon project of its own and
  Hyperdrive in front of it (`src/stack/database.ts`). The runner deploys one, applies `migrations/`, runs, reads the
  spans back and destroys it. Alchemy's state is local (`.alchemy/`), so only the checkout that created a stage can
  destroy it. Never run `alchemy nuke`.

## Adding an operation

Declare it in the blueprint first ([AGENTS.md](../../AGENTS.md), "How a feature is built"). Then write its handler
where its domain's work lives (`src/<domain>/`) and add one entry to that domain's file in `src/domains/`. A new
domain is a new file there and one entry per group it serves in `src/handlers.ts`. The server compiles only with one
handler per operation, so a missing one fails `pnpm types`. A subject its approvals authorise needs an entry in
`landings`; `src/approvals/landed.ts` says how.

## Migrations

`migrations/` holds the `app` schema. Both migrators (the runner's for a stage, `packages/world`'s for a world) apply
its `.sql` files in name order, and a world is given only the files it has not seen. So an applied migration is never
edited and a name never changes once merged: a change to stored state is a new file, `NNNN_<domain>.sql` or
`NNNN_<domain>_<what>.sql`, its number one more than the highest on the branch the slice was cut from. The rule and
its reasons are in the header of `test/migrations.test.ts`, which checks it.

## Checks

`pnpm types` and `pnpm test`, in memory and with no keys. The `*-sql` tests run only with `CAPXUL_TEST_DATABASE` (a
throwaway Postgres) and are skipped otherwise, as in CI. The chain operations' tests run against a local stand-in of a
world (`test/chain/`, `up.sh` and `down.sh`) with `pnpm --filter @capxul/core chain:test`, which `pnpm test` does not
run. What a deployed api proves is in the runner's verdicts and the [roadmap](../../docs/roadmap.md).
