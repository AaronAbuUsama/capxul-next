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
- CI (`.github/workflows/check.yml`, job `gate`) runs the ladder on every pull request and every push to `master`.

## The ladder

Run `pnpm check` before you open a pull request. It runs every rung in order and stops at the first that fails.

| Rung | Command | What fails it |
|---|---|---|
| Shape | `pnpm shape` | An entry at the top level, a package or a file under `docs/` that `packages/lint/src/shape.ts` does not list; a package or spike with no `README.md`; a source file under `packages/` over 300 lines |
| Types | `pnpm types` | A type error in any TypeScript package |
| Tests | `pnpm test` | A failing unit test in any package, Frappe's included (`pnpm frappe:test`) |

`spikes/` is temporary code, deleted when its step graduates it, so the ladder does not check it beyond its README.
