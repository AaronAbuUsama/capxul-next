# Archive

Dead material, kept so nothing is lost. Nothing here is built, checked, or read by a tool, and none of it describes
the current direction: for that, read the top-level `README.md` and run `pnpm plan show`.

**The one rule.** A thing keeps its old path under `archive/`: what was `demo/app` is `archive/demo/app`, what was
`docs/handoff/2026-11-09` is `archive/docs/handoff/2026-11-09`. So when an older document (`START-HERE.md`, a
hand-over, a workflow script) names a path that no longer exists, look for it here at the same path. To archive
something, `git mv` it to its own path under `archive/`, add a row below, and fix every live reference in the same
commit (`docs/repository-map.md` says what counts as live).

| Path here | What it was | Why archived | Date |
|---|---|---|---|
| `demo/` | A clickable mock-up of Capxul on Frappe for a 25-person company (`app/`), the data generator behind it (`data/`) and the research it rests on (`research/`). 34 files, 11 MB. | The mock-up did its job on 9 November; the product is now specified in the book. `docs/design/frappe/what-it-takes/frappe-reality.md` still cites `research/`, at its path here. | 10 November 2026 |
| `kit/` | Two git bundles: `hillclimb-kit.bundle` (the starter kit's local history) and `swarmd-next-design.bundle` (the abandoned swarmD rebuild). `kit/README.md` says how to restore each. | Neither is used: the build does not start from the kit, and swarmD is not rebuilt. Kept because the bundles are the only copy in this repository. | 10 November 2026 |
| `docs/handoff/2026-11-09/` | The 9 November sitrep and next steps, 96 screenshots, 39 workflow scripts, a scratchpad. 139 files, 42 MB. | Evidence of one day's hand-over; only `START-HERE.md` names it, as "not required reading". | 10 November 2026 |
| `docs/original/` | Three source notes from before the book: `FINISH-CAPXUL.md`, `swarm-cli.md`, `swarmd-today.md`. | Only the old workflow scripts read them. | 10 November 2026 |
| `docs/design/screens/` | Six screenshots of the first portal prototype. | Nothing refers to them; the portal is `packages/portal` now. | 10 November 2026 |
| `docs/mission/remaining-work.md` | A work list written on 8 November. | Overtaken by the plan (`plan/plan.json`). | 10 November 2026 |
