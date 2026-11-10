# runs (generic)

A run is a folder: `run.sqlite` (pi-durable: the only truth) and `status.json` (an index derived from it). `play` plays a
script against it (a replay after a restart skips finished steps), `stop` writes the stop file, `table` lists, `ledgerLines`
and `watchRun` look from another process read-only, `work` is the worker's loop (resume the dead, start what is ready, up to
a concurrency). `die.fixture.ts` is a script that SIGKILLs itself, for the resume test. Generic.
