# migrations

The `app` schema of a world's database, as ordered `.sql` files. The runner applies every file here, in name order
and as one transaction, when it creates a world (`../../runner/database.ts`).

They are applied over Neon's HTTPS SQL endpoint, one statement at a time, so a file is split at every `;`. Keep `;`
out of string literals and function bodies, and write each statement so that it can run on an empty database.

Alchemy's own `migrations` setting on a Neon branch is not used: it connects with the Postgres protocol on port
5432, and an agent's container has no route out other than HTTPS.

Add a file with the next number. Never edit one that has been applied to a world that is still alive.
