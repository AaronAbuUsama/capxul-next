# cli (generic)

`pnpm sandbox`: argv in, a result out (`sandboxCli`). It prints nothing and exits nothing (`src/main.ts` does); a
command's streamed output goes through the injected `write`. Commands: `up`, `exec`, `push`, `pull`, `ls`, `down`,
`reap` (types.ts has their shapes). Invariants: a refused command (bad arguments) exits 2 with the usage; a failure of
the box or the launcher exits 1 with its words; `exec` passes on the command's own exit code.

Tests: `cli.test.ts`, through `sandboxCli` with a launcher that keeps boxes in a map and lends them a real box server.
