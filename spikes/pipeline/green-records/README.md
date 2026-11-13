# green-records

The run records of three `./run.sh scenarios` runs in a row against the implemented handlers, on 13 November 2026
after the runner and the world were hardened (`../README.md`, "Hardening"). Each run exited 0 with all five
scenarios passed: fifteen fresh worlds, every one destroyed. They are the proof that each scenario passes, as
`../scenarios/red-records/` is the proof that each failed first.

| Directory | Started (UTC) | Exit | Scenarios passed | Worlds destroyed | Relapses while waiting | Calls resent |
|---|---|---|---|---|---|---|
| `run-1/` | 09:40:15 | 0 | 5 of 5 | 5 of 5 | 0 | 0 |
| `run-2/` | 09:43:58 | 0 | 5 of 5 | 5 of 5 | 0 | 0 |
| `run-3/` | 09:47:30 | 0 | 5 of 5 | 5 of 5 | 0 | 0 |

Each file is one scenario's record as the runner wrote it (`../runner/README.md` says what is in it). The server
time of every call is its `serverMs`, and its `steps` say where that time went.

Across the three runs (84 calls): an accepted append took 331 to 1305 ms on the server, median 384 ms; a refused
append 252 to 341 ms, median 287 ms; an export 83 to 839 ms, median 117 ms. Nine calls were over the 500 ms
budget, which is recorded and does not gate. Seven of the nine were the first call of their world, and their first
statement took 638 to 893 ms where it otherwise takes 85 to 170 ms. One was the second call of a world, the same
way (561 ms). One was an append of 504 ms with nothing unusual in it. `../README.md`, "Speed", says what is known
about that first statement.
