# What a run writes

Every run writes JSON under `records/` (or `RUNNER_RECORDS`), by the runner and never by hand (`src/record.ts`).
Until verdicts are built (roadmap item 4.5), this run record is what proves an item: one whose `outcome` is `passed`.

## One run record

- `outcome`: `passed` when the run's own expectations held, every generic check passed on every call, and every world
  or stage it made was destroyed with nothing of it left in the accounts. `rehearsed` is the same with Core run
  locally (`--core=local`, `src/local/host.ts`), so a rehearsal is never taken for the proof. Otherwise `failed`.
- `ended`: how the run's own program ended before any check: `succeeded`, `failed` with a typed failure's tag (a
  refusal, a journey's `ExpectationFailed`), or `died` (`src/failure.ts`).
- `calls`: every call, with what was sent and what came back, its generic checks (`src/checks/checks.ts`) and its
  `timing`: the caller's time, the server span's time and the operation's budget beside them, never enforced
  (AGENTS.md, "How it is measured"). Its `steps` are the server spans beneath the operation's.
- For a journey (`kind: "journey"`), `steps`: every step of its outline, `passed`, `failed` or `not reached`, with its
  tries, the calls it made and how long it took; and `failedStep`, the first that failed (`src/steps.ts`).
- `making`: the calls made in making the journey's starting point, with the same checks.
- `afterwards`: what the accounts held of each world before and after its destroy (`src/world/leftovers.ts`).

## Where it goes

| Run | Records |
|---|---|
| `door`, `chain` | `records/<stage>/door.json`; with `--world`, the stage is the world's (`src/in-world.ts`) |
| `scenarios` in one world | `records/<run>/<journey>.json` each and `summary.json`, with every part timed (`src/worlds/run.ts`) |
| `scenarios --expect=not-implemented` | one stage per journey, its record in the stage's folder; the summary at `records/run-<6 hex>/summary.json` (`src/scenario-runs.ts`) |
| `--one-stage` | `records/<stage>/summary.json` and every journey's record as a line of `journeys.jsonl` |
| `shared`, `starting-worlds` | `records/<run>/shared.json`, `records/<run>/starting-worlds.json` |

## The summary

`./run.sh scenarios` also writes a summary (`src/summary.ts`), whose `outcome` is the run's. It is `passed` exactly
when every registered journey is in the run, each ended as the run expected, and every stage or world was destroyed
with nothing left. What the run expects is a flag:

- `--expect=pass` (the default): each journey's run record passed (or was `rehearsed`).
- `--expect=not-implemented`: each journey failed at its first step on the `NotImplemented` that the api's empty
  handlers (`packages/core`, `CAPXUL_HANDLERS=empty`) answered, reached no later step, and every generic check passed
  on every call (roadmap item 1.14).

A run of named journeys leaves some out, so its summary fails; it still exits 0 when those journeys were as expected.
The summary also sums each machine's coverage (`src/checks/paths.ts`).

Why each run in `records/` was made, and what it found, is in a `README.md` in its folder.
