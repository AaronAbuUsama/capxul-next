# Admission: two processes cannot both take a cluster's last place

`run.sh` runs two processes at once, each admitting 10 worlds to a cluster that admits 4, through `admit`
(`src/lifecycle/claim.ts`), on a real Postgres 16 on this machine behind a stand-in of Neon's SQL endpoint. The
registry starts without the `hub` column, so the first claim also adds it. `summary.json`: the cluster never held more
than 4; an owner's sixth world was refused `WorldQuotaReached` at once (8 to 22 ms), full cluster or not.
`prepareRegistry` runs under its own lock because two claims adding the column at once collided here.

Not measured: a wait for room in a real run, four runs at once on `fleet` at its full capacity, or whether the
account's limits on running containers allow that many worlds at once.
