# cloud (generic)

A **box** is one container a run's agents work in, off this machine. The process that plays the run stays here with
its ledger, its model calls and its door; every file an agent reads or writes and every command it or a gate runs
happens in the box.

- **Inside the box**, `src/bin/box.ts` serves pi-durable's own `NodeExecutionEnv` over HTTP (`internal/server.ts`):
  `/call` for one environment method, `/exec` for a command run in the background and polled (a fifteen-minute gate
  holds no request open), `/blob` for whole files (the git bundles), `/info` for the commit the image holds.
- **Here**, `BoxEnv` (`internal/env.ts`) is an `ExecutionEnv` whose every method is a call to that server. The agents
  module asks for it per tool call (`HostOptions.envFor`), so the coding tools run unchanged. Watching files is not
  offered (`not_supported`).
- **The lane travels as git** (`internal/box.ts`). The lane has the same absolute path here and in the box, so paths,
  prompts and confinement agree. `push` sends the commits the image lacks as a bundle and checks the lane out there
  (a box lane already at the tip keeps its uncommitted work, for a resumed agent); `pull` commits in the box and
  fast-forwards the lane here; `restore` undoes what a reader left.
- **Launchers** (`internal/launch.ts`): `cloudflare` (the Worker in `packages/loop/cloud/`), `docker` (the same image on
  127.0.0.1, for testing it), `running` (a box already up at an address, for tests).

Invariants: the box needs no network (the image has the repository and its packages); a key never leaves the
`Link`'s headers; a failure of the box is a value (`Result`), never a throw.

Tests: `cloud.test.ts` runs pi-durable's environment conformance suite against the box, plus streaming, stopping and
the git round trip, against a server in this process; with `LOOP_BOX_IMAGE=<tag>` the same tests run against a Docker
container of the image. `capxul/cloud.test.ts` plays a whole pair run through a box.
