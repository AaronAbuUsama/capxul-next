## What
Aaron reviews two changes to the rules file. Revert whatever he rejects.

1. **Already merged, before he saw it (`f593f2b`).** `CLAUDE.md` (66 lines) became a link to a new `AGENTS.md` (51 lines). The rules and the checks carry over. The old CLAUDE.md swarmD/history banner is now point 2 of AGENTS.md, and there is a new section, "The coordinator". To see it: `git show f593f2b -- CLAUDE.md AGENTS.md`.
2. **Proposed, not made.** Point 2 of AGENTS.md still calls START-HERE.md "the owner's direction of 9 November, kept as a record". Since `m1-entry-docs` merged (`58a0f58`), START-HERE.md is the one-page entry, and the original is in `archive/START-HERE.md`:

```diff
-2. **The map of this repository is [README.md](README.md).** What is current is the plan (`pnpm plan show`) and the rulings in the blueprint. [START-HERE.md](START-HERE.md) is the owner's direction of 9 November 2026, kept as a record: capxul-next is the rebuild of Capxul Core, Frappe-native, coordinated through the plan, the portal and the loop. Where an older document disagrees with the plan or a ruling, the plan and the ruling win.
+2. **The map of this repository is [README.md](README.md).** What is current is the plan (`pnpm plan show`) and the rulings in the blueprint. [START-HERE.md](START-HERE.md) is the one-page entry: the goal, the milestone and the portal. The owner's direction of 9 November 2026 is kept whole in [archive/START-HERE.md](archive/START-HERE.md). Where an older document disagrees with the plan or a ruling, the plan and the ruling win.
```

The coordinator recommends keeping 1 and making 2.
## Why
His rule: any change to CLAUDE.md, or to one of his rulings, is shown to him as a diff first.
## Done when
- His answer is applied, and anything he rejected is reverted
