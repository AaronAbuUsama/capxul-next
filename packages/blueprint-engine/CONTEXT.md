# `@capxul/blueprint-engine` maintainer context

## Purpose and ownership

This private package is the engine of the blueprint: it defines the kinds of record (operation, rpc, flow, table,
machine, workflow, decision and the rest), builds a blueprint from a list of records, and reports what is wrong with
it. A problem fails the build; a gap is visible work; a standing gap is one a decision accepts for a stated reason. The
engine also derives the evals each record implies and reads the status document a run writes. It owns no records:
the blueprint that describes this repository is written with it, elsewhere.

## Interface map

- `src/index.ts` is the only entry. It re-exports the record kinds (`src/records/`), `buildBlueprint`
  (`src/build.ts`), the evals (`src/evals.ts`), the status document (`src/status.ts`), the stand of an operation
  (`src/stand.ts`) and the impact, telemetry, example and budget helpers.
- `src/main.ts` is a small CLI: it builds a blueprint module, writes its views and exits 1 on any problem.

## Dependencies and consumers

It depends on `effect` (Schema) only. It has no consumer in this repository yet; the blueprint, the plan and the
portal that move here from capxul-next will be its consumers. The same package lives in capxul-next, so a change made
here is made there too.

## Invariants

1. A record is checked by its schema when it is defined; a failure names its kind, its id and the file that defined it.
2. Links between records are values, never typed strings, and the build reports any link to a record it does not hold.
3. A verdict counts only while its recorded claim matches the claim the blueprint derives now; otherwise it is stale
   and counts as not run.
4. A decision's choice is one of its options.
5. A DocType's Link and Table fields link to `doctype` records, so a change to one shows every DocType it reaches; a
   record is the code exactly, and the repository's agreement check fails the merge on a difference.
6. The engine is shared byte for byte with capxul-next, so repository lint, format and the telemetry-spine scan skip it.

## Proof and evidence boundary

Its proof is its own type check and tests: `pnpm --filter @capxul/blueprint-engine check` and
`pnpm --filter @capxul/blueprint-engine test`. It has no runtime surface in the product.

## Update contract

Change the engine and its tests together, keep the copy in capxul-next the same, and update this file and the
README when a record kind, a rule or the status format changes.
