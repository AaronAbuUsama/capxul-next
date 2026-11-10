# host (generic)

The process clients attach to: `serve(deps, { port })` listens on 127.0.0.1 and serves the runs over pi's Chord layer
on a WebSocket (`types.ts` holds the contract and says what travels). A client that attaches gets every run in full,
then only what changes; `stop` asks a run to stop. It reads runs through `deps` and keeps nothing of its own; a run
that is not changing is not read again. Sending input to an agent is not here yet: that needs the host to be the
process that plays the run.
