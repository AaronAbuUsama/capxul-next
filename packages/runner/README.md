# runner

The runner makes a run: it calls a world's operations through the api's endpoint (`packages/core`, Core's door),
applies the same generic checks to every call, and writes a run record of everything it saw. It knows no operation and
no journey by name: it reads the blueprint (`@capxul/blueprint`) and runs the journeys that `@capxul/scenarios`
registers (`packages/scenarios`). Each journey's operations judge their own calls with their checks; the runner adds
its generic checks and records every step.

## Run it

```bash
./run.sh scenarios [name...]             # the journeys (or those named) in one world, reset before each
./run.sh scenarios --expect=not-implemented   # each in a fresh stage of the api's empty handlers; must fail at step 1
./run.sh scenarios --one-stage --expect=not-implemented   # the same, all in one stage
./run.sh scenarios --via=cli [name...]   # every operation through the command line (packages/cli)
WORLD_BENCH=<platform stage> ./run.sh scenarios --core=local [name...]   # a rehearsal: the api in workerd here
./run.sh shared                          # make the shared world, or renew it
./run.sh scenarios --shared [name...]    # the journeys on the shared world, each from its starting points
./run.sh starting-worlds                 # make every starting point, timed, then destroy them
./run.sh door [--world=<name>]           # every operation once, in a fresh stage or in a world
./run.sh chain --world=<name>            # the chain operations' journey through a world
./run.sh alchemy <args...>               # an alchemy command for the CapxulCore stack; never nuke
```

A run exits 1 when it did not end as it expected or left something behind. `run.sh` lists every mode with its
settings; each setting, with its default, is in [`src/settings.ts`](src/settings.ts). In an agent's container the
session's network proxy adds the Cloudflare and Neon keys; `run.sh` makes fresh endpoint tokens for the run and never
prints them. CI runs `scenarios` in `.github/workflows/world.yml`, and `shared` then `scenarios --shared` after each
deploy of the sites in `.github/workflows/platform.yml`.

Each mode is described at the top of its module:

- one world, reset in place before each journey: [`src/worlds/run.ts`](src/worlds/run.ts), its starting points in
  [`src/worlds/starting.ts`](src/worlds/starting.ts);
- the shared world: [`src/shared/make.ts`](src/shared/make.ts) and [`src/shared/starting.ts`](src/shared/starting.ts);
- `--core=local`: [`src/local/host.ts`](src/local/host.ts); `--via=cli`: [`src/client.ts`](src/client.ts);
- a stage each, or one stage: [`src/scenario-runs.ts`](src/scenario-runs.ts); `--world`:
  [`src/in-world.ts`](src/in-world.ts).

## What a run writes

One JSON run record per run under `records/`, written by the runner and never by hand: every call with what was sent
and what came back, its checks, and its caller and server time beside its budget; for a journey, every step. A run of
the journeys adds a summary whose `outcome` is the run's. The fields, the folders and the summary's rules are in
[docs/what-a-run-writes.md](docs/what-a-run-writes.md); why each run in [`records/`](records) was made, and what it
found, is in its folder's `README.md`.

## The generic checks

`span`, `outcome`, `events` and `path`, on every call of every run: [`src/checks/checks.ts`](src/checks/checks.ts)
says what each passes on. Nothing fails on speed, and a builder never changes them
([AGENTS.md](../../AGENTS.md), "How it is measured" and "How work flows").

Site templates on the bench never change once made; the rule and its reasons are in
[packages/platform](../platform/README.md).
