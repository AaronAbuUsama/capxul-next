# The api's latency to its database

The baseline every call of the api pays, measured by the pipeline spike (roadmap item 0.7, 13 November 2026; its
code was deleted when it graduated) in 84 calls over three runs. The run records are
[packages/runner/records/spike](../../runner/records/spike/README.md); every call's `serverMs` and `steps` say where
its time went.

## One statement is one round trip of about 87 ms

The api is a Worker that ran in the eastern United States, where the runner's container was; the world's Neon branch
is in `aws-eu-west-2`, London. Through Hyperdrive, every statement was one round trip across the Atlantic: median
87 ms (81 to 212 ms over 253 statements). Connecting to Hyperdrive took 0 to 17 ms, median 3 ms. So a call's time is
mostly its count of statements:

| Call | Statements | Server ms |
|---|---|---|
| An accepted write with its event (`BEGIN`, the insert, the event, `COMMIT`) | 4 | 331 to 504, median 379 |
| A refused write (the transaction rolled back) | 3 | 252 to 341 |
| A read | 1 | 83 to 144 |

Where the api and the database run decides this more than any handler: four statements are 340 ms only because the
two are an ocean apart.

## A young world's first statement

The first call to a world's database often paid about 650 ms more, all of it in its first statement (560 to 890 ms
where it otherwise took 85 to 170 ms); the statements after it were normal. The likeliest cause is that Hyperdrive had
no open connection to Neon yet and opened one (TLS and the login across the Atlantic); Hyperdrive reports nothing of
it, so that is inferred from the timing. A world about 10 s old no longer paid it. A readiness wait that only probes
the Worker cannot reach it, since a probe never touches the database: in 7 of 15 worlds the first call still paid.

## Hyperdrive's cache is off

Hyperdrive caches a `select` outside a transaction for up to 60 s by default, so a read just after a write could miss
it. The api's Hyperdrive is made with `caching: { disabled: true }` (`src/stack/database.ts`), and a read is one bare
statement.

## A Worker's clock moves only on I/O

Inside a Worker the clock stands still between I/O, so a span with none, such as an empty handler's, measures 0 ms.
A span's time is the I/O it waited on.

## A new address is not routed at once

For some seconds after a deploy, Cloudflare's edge can answer for a new workers.dev address with its own 404 page,
between two answers from the Worker (probes 6 and 7 of 40, 250 ms apart, 3 s after the deploy). One answer does not
mean the address is routed; how the runner waits for it is the header of `packages/runner/src/world/warmup.ts`.
