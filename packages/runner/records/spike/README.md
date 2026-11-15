# spike

The Proof of roadmap item 0.7, from the pipeline spike (its code was deleted when it graduated): the run records of
three `./run.sh scenarios` runs in a row against the implemented handlers, on 13 November 2026, after the runner and
the world were hardened (a world ready only after 20 `Pong` answers in a row, and Hyperdrive's cache off). Each run
exited 0 with all five scenarios passed: fifteen fresh worlds, every one destroyed. They are the proof that each
scenario passes, as [../spike-red-records](../spike-red-records) is the proof that each failed first: one record per
scenario against the empty handlers, written before anything was implemented. They sit outside this folder because
the status feed counts item 0.7 Done only while every JSON record under its Proof passed.

| Directory | Started (UTC) | Exit | Scenarios passed | Worlds destroyed | Relapses while waiting | Calls resent |
|---|---|---|---|---|---|---|
| `run-1/` | 09:40:15 | 0 | 5 of 5 | 5 of 5 | 0 | 0 |
| `run-2/` | 09:43:58 | 0 | 5 of 5 | 5 of 5 | 0 | 0 |
| `run-3/` | 09:47:30 | 0 | 5 of 5 | 5 of 5 | 0 | 0 |

Each file is one scenario's record as the spike's runner wrote it. The server time of every call is its `serverMs`,
and its `steps` say where that time went.

Across the three runs (84 calls): an accepted append took 331 to 1305 ms on the server, median 384 ms; a refused
append 252 to 341 ms, median 287 ms; an export 83 to 839 ms, median 117 ms. Nine calls were over the 500 ms
budget, which is recorded and does not gate. Seven of the nine were the first call of their world, and their first
statement took 638 to 893 ms where it otherwise takes 85 to 170 ms. One was the second call of a world, the same
way (561 ms). One was an append of 504 ms with nothing unusual in it. What is known about that first statement is in
[packages/core/docs/latency.md](../../../core/docs/latency.md).
