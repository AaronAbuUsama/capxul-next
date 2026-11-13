# @capxul/provisioner

Every environment as an Alchemy stack, and every world as an Alchemy stage (Aaron's ruling
`aaron.alchemy-provisioning`, component `provisioner` in the blueprint). Callers use `src/provisioner/door.ts` and never
import Alchemy, so a breaking Alchemy release changes this package only. Alchemy is pinned to one exact version (2.0.0-beta.86, admitted early under the one release-age exception Aaron allowed on 12 November).

| File | What |
|---|---|
| `src/provisioner/door.ts` | `provisioner(placement, config)`: `deploy`, `park`, `resume` and `destroy` one world's box |
| `src/provisioner/stage.ts` | A world id's stage (`world-<id>`) and box name (`capxul-world-<id>`); refuses ids the supervisor would refuse (1 to 12 letters and digits) |
| `src/provisioner/docker-box.ts` | The docker placement: one container that runs its own Docker daemon, plus a volume for that daemon's disk |
| `src/provisioner/alchemy.ts` | The only call into Alchemy's programmatic API: plan, then apply, for one stage; state under `var/provisioner` |
| `src/main.ts` | The command line: `provisioner deploy|park|resume|destroy <world> [--placement none|docker|e2b]` |
| `box/Containerfile` | The world box image: Ubuntu 24.04 with its own Docker daemon, Node, pnpm, git and psql 17 |
| `box/box-start.sh` | The box's entrypoint: trusts an extra CA, runs `dockerd`, stops worlds on park and starts them on resume |
| `box/run-world.sh` | Inside the box: `run-world prepare`, `create`, `slice-zero`, `up`, `stop`, `inspect` through today's supervisor |
| `bin/proxy-relay.mjs` | Cloud containers only: serves the loopback agent proxy on the Docker bridge for boxes |
| `bin/build-box.sh` | Builds `capxul-world-box:dev` (through the agent proxy when one is set) |

## What a world's life looks like

- **deploy**: Alchemy creates the box's two disks (Docker volumes: one for its Docker, one for `/work`, the checkout and
  world files) and the box, and starts it. Deploying again changes nothing.
- **park**: every running world inside stops cleanly (its supervisor fences a world that was killed), then the box
  stops; its disks stay. Billing on a cloud placement stops with it.
- **resume**: the same box starts again with its disks as they were, and the worlds that parking stopped come back up.
- **destroy**: Alchemy removes everything the stage made, disk included.

The box runs its own Docker daemon, so the devnet supervisor runs inside it as it runs on a machine today. No
`--privileged`: all capabilities, unconfined seccomp and AppArmor, and a writable cgroup tree are enough. Alchemy never
saves a world's data. A consistent save (chain, Postgres and sites paused together) is the supervisor's own snapshot,
taken inside the box.

## Placements

A box is optional (`aaron.sandbox-optional`). A world's placement comes from `--placement` or `CAPXUL_WORLD_PLACEMENT`;
with nothing set it is `none`: the world runs straight on the machine under the devnet supervisor, as it always has, and
the provisioner has nothing to do. Every check passes without a box, a sandbox or an E2B key.


- `docker` (built): a laptop or a cloud container. Each box has its own network, so the Docker inside it owns its own
  firewall rules and two boxes never share ports. (Sharing the host's network broke the sites: the box's Docker and the
  host's wrote rules into the same firewall, and containers on one world's network could not reach each other.) In a
  Claude cloud container, whose agent proxy listens only on loopback, `bin/proxy-relay.mjs` serves that proxy on the
  Docker bridge; set `CAPXUL_BOX_PROXY=http://172.17.0.1:<port>` and `CAPXUL_BOX_TRUST_CA` to the proxy's CA.
- `e2b` (next): test runs in an E2B sandbox, destroyed after the run, through `@alchemy.run/e2b`. Waits on an
  `E2B_API_KEY` in the environment.
- A long-lived machine with a real disk, for shared worlds: not chosen yet. Its shared worlds keep their Frappe sites on
  the host's one shared bench (aaron.shared-bench-for-shared-worlds); a box at the docker or e2b placement keeps its own.

## Checks

```bash
pnpm --filter @capxul/provisioner check
pnpm --filter @capxul/provisioner test                                   # unit tests; the lifecycle test skips
CAPXUL_PROVISIONER_DOCKER=1 pnpm --filter @capxul/provisioner test       # also the whole life of a box, needs Docker
```

Environment for `src/main.ts`: `CAPXUL_WORLD_PLACEMENT` (`none`, `docker` or `e2b`; default `none`), `CAPXUL_WORLD_BOX_IMAGE` (default `capxul-world-box:dev`, built by `bin/build-box.sh`), `CAPXUL_PROVISIONER_STATE` (default
`var/provisioner`), `CAPXUL_BOX_TRUST_CA` and `CAPXUL_BOX_PROXY` (the proxy as the box sees it).
