# AGENTS.md

`CLAUDE.md` is a link to this file. Every agent (Amp, Claude, Codex) reads the same rules.

## This branch is `master`: the rebuild line (read this first)

`master` is a separate line of work from `main` and `integration/build`. It was cut from `main` at `f12a831` on
13 November 2026, at Aaron's request, to rethink the blueprint and the build pipeline without
disturbing the product work in flight on those two branches.

- Rebuild work goes by pull request into `master`. Where the rules below say `integration/build`, read `master`.
- Never merge `master` into `main` or `integration/build`, and never open a pull request from this line into them,
  unless Aaron asks for it in writing.
- Work that belongs to the in-flight product line stays on `main` and `integration/build`. Do not base it on `master`.
- `main` is merged into `master` only on purpose, by whoever leads this line, never as a routine catch-up.

If your task was written for `main` or `integration/build` and you are on this branch, stop and switch branches.

The plan this line follows is [docs/roadmap.md](docs/roadmap.md).

## Three sources, one owner for every fact

- **The blueprint** (`packages/blueprint`) says what Capxul does: its operations, refusals, events and starting worlds,
  as Effect declarations the product imports.
- **The world** (`packages/world`) says what runs where: the Alchemy stacks that create and destroy a world.
- **Run records**, made by checks and scenario runs, say what is proven. Nobody writes one by hand.

Every fact has one owner in code. Everything else that needs it imports it, generates it from it, or is checked
against it, so two places cannot disagree (`docs/roadmap.md`, "One source for every fact"). Nothing checks this as a
whole yet.

## Worlds

A world is created, used and destroyed as one unit, with an owner and an expiry. The rules are in
[docs/roadmap.md](docs/roadmap.md), "World lifecycle rules, enforced by code". They belong in `packages/world`; until it lands, nothing checks them.

## How work flows

- One piece of work, one branch, one pull request into `master`. The lead merges it when CI is green. Nothing in
  the repository checks this.
- Never push to, merge into or open a pull request against `main` or `integration/build`. Never force-push. Nothing
  checks this; it is on you.
- A builder must not change the scenarios or the runner's generic checks: those judge its work. It may change
  everything else it needs, the world and the runner's plumbing included (readiness, caching, connections), and every
  such change shows in its diff. Nothing checks this yet; the reviewer reads the diff.
- Measure first. Every run record holds every operation's timings, caller and server, with the spans of each step. A
  budget stays provisional and is never enforced until it is set from measured runs, so nothing fails on speed until
  then. Nothing checks this yet.
- CI (`.github/workflows/check.yml`, job `gate`) runs rungs 1 to 5 of the ladder on every pull request and every
  push to `master`.

## The ladder

Run `pnpm check` before you open a pull request. It runs rungs 1 to 5 in order and stops at the first that fails.
`pnpm format` rewrites the code into shape; run it before `pnpm check`.

| Rung | Command | What fails it |
|---|---|---|
| 1. Shape | `pnpm shape` | An entry at the top level, a package or a file under `docs/` that `packages/lint/src/shape.ts` does not list; a package or spike with no `README.md`; a source file under `packages/` over 300 lines; the two lists of entry files in `.oxlintrc.json` naming different paths |
| 2. Format | `pnpm format:check` | TypeScript or JavaScript under `packages/` that oxfmt would change (config: `packages/lint/oxfmt.json`) |
| 3. Lint | `pnpm lint` | Any finding of `.oxlintrc.json`, every rule an error: oxlint's correctness and suspicious rules and a few more, all of Effect's rules from `@effect/tsgo` but two (each off with its reason), and ours from `packages/lint` (below) |
| 4. Types | `pnpm types` | A type error in any TypeScript package, or an Effect language service error or warning (`effect-tsgo tsc`) |
| 5. Tests | `pnpm test` | A failing unit test in any package (`pnpm frappe:test` included). Foundry's tests in `packages/contracts` are not in it: CI has no Foundry |
| 6. Proof | `spikes/pipeline/run.sh scenarios` | A scenario that fails in a fresh world. Until the runner leaves the spike, this is the command. CI does not run it: CI has no Cloudflare or Neon keys yet (roadmap step 1.8) |

Our lint rules, each tested in `packages/lint/test/rules.test.ts`:

- `capxul/blueprint-owns-names`: an operation, a refusal (a tagged error), an event or a starting world is declared
  only in `packages/blueprint`.
- `capxul/effect-only`: no `async`, `await`, `new Promise`, `try`, `throw`, `process.env`, `Date.now`, `new Date()`
  or `console` in TypeScript outside entry files. Entry files are listed in `.oxlintrc.json` under
  `settings.capxul.entries`, each with its reason.
- `capxul/import-door`: another package is imported only through its door, `src/door.ts`, or by its bare name.
- `capxul/no-json-text`: no `JSON.parse`, `JSON.stringify`, `Schema.parseJson` or string schema documented as JSON
  outside entry files and the edges listed under `settings.capxul.jsonEdges`.

What the ladder does not cover: `spikes/` (temporary code, deleted when its step graduates it; only its README is
checked), Ponder's files in `packages/indexer` (type-checked only), the Solidity in `packages/contracts`, and the
Frappe app's Python and form scripts (unit tests and formatting only). An override of a rule names its reason next
to it, in `.oxlintrc.json` or on the line it excuses.
