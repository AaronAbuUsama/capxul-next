# @capxul/provisioner

Every environment as an Alchemy stack, and every world as an Alchemy stage (Aaron's ruling
`aaron.alchemy-provisioning`, component `provisioner` in the blueprint). Callers use `src/provisioner/door.ts` and never
import Alchemy, so a breaking Alchemy release changes this package only. Alchemy is pinned to one exact version.

| File | What |
|---|---|
| `src/provisioner/door.ts` | `provisioner(placement, config)`: `deploy`, `park`, `resume` and `destroy` one world's box |
| `src/provisioner/stage.ts` | A world id's stage (`world-<id>`) and box name (`capxul-world-<id>`); refuses ids Alchemy or a hostname cannot carry |
| `src/provisioner/docker-box.ts` | The docker placement: one container that runs its own Docker daemon, plus a volume for that daemon's disk |
| `src/provisioner/alchemy.ts` | The only call into Alchemy's programmatic API: plan, then apply, for one stage; state under `var/provisioner` |
| `src/main.ts` | The command line: `provisioner deploy|park|resume|destroy <world>` |
| `box/Containerfile` | The world box image: Ubuntu 24.04 with its own Docker daemon, Node, pnpm, git and psql 17 |
| `box/box-start.sh` | The box's entrypoint: trusts an extra CA if one is mounted, then runs `dockerd` |
| `box/run-world.sh` | Inside the box: `run-world prepare`, `create <world>`, `slice-zero <world>` through today's supervisor |
| `bin/build-box.sh` | Builds `capxul-world-box:dev` (through the agent proxy when one is set) |

## What a world's life looks like

- **deploy**: Alchemy creates the box's disk (a Docker volume) and the box, and starts it. Deploying again changes nothing.
- **park**: the box stops; its disk stays. Billing on a cloud placement stops with it.
- **resume**: the same box starts again with its disk as it was.
- **destroy**: Alchemy removes everything the stage made, disk included.

The box runs its own Docker daemon, so the devnet supervisor runs inside it as it runs on a machine today. No
`--privileged`: all capabilities, unconfined seccomp and AppArmor, and a writable cgroup tree are enough. Alchemy never
saves a world's data. A consistent save (chain, Postgres and sites paused together) is the supervisor's own snapshot,
taken inside the box.

## Placements

- `docker` (built): a laptop or a cloud container. In a Claude cloud container the box shares the host network (the agent
  proxy is on loopback) and trusts the proxy's CA (`CAPXUL_BOX_TRUST_CA`). Because of that shared network, two docker-placed boxes on one
  host would collide on ports; one box per host until boxes get their own network.
- `e2b` (next): test runs in an E2B sandbox, destroyed after the run. Alchemy's E2B provider first shipped in
  2.0.0-beta.86 (12 November 2026); the workspace's three-day minimum release age admits it from 15 November.
- A long-lived machine with a real disk, for shared worlds: not chosen yet.

## Checks

```bash
pnpm --filter @capxul/provisioner check
pnpm --filter @capxul/provisioner test                                   # unit tests; the lifecycle test skips
CAPXUL_PROVISIONER_DOCKER=1 pnpm --filter @capxul/provisioner test       # also the whole life of a box, needs Docker
```

Environment for `src/main.ts`: `CAPXUL_WORLD_BOX_IMAGE` (default `capxul-world-box:dev`, built by `bin/build-box.sh`), `CAPXUL_PROVISIONER_STATE` (default
`var/provisioner`), `CAPXUL_BOX_TRUST_CA`, and the proxy variables, which it passes into the box.
