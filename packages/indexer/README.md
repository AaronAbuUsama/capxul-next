# @capxul/indexer

The Ponder app (Ponder 0.18.6) that indexes a world's chain into the `ponder` schema of the world's Postgres: its
tables are `ponder.schema.ts`, its handlers `src/`, its ABIs `abis.ts`. It serves no GraphQL or SQL over HTTP; facts
are read from Postgres.

`packages/world` runs it as each world's index: its image copies this app with the world's own configuration
(`packages/world/ponder/`, whose `ponder.config.ts` says how it differs from this one), and `src/index/` there starts
and stops it.

To run it by hand, against Postgres and a chain of your own:

```bash
pnpm --filter @capxul/indexer start --schema ponder --port 42069 --hostname 127.0.0.1
```

The environment it needs is read in `ponder.config.ts`. `/health` is Ponder's process liveness and `/ready` its
completed backfill. Stop Ponder before a whole-database snapshot or restore, and restart with the same configuration
and schema to recover; do not use `ponder dev`, whose hot reload rebuilds the tables.
