# Review of the cut's old decisions

Task: `m1-old-decisions`, 11 November 2026.

`decision-review.json` accounts for all 202 decisions marked `rewrite` in the historical
`cut-proposal.json`. The proposal is not edited: it is the input, not today's status.
Each review identifies its disposition, reason, replacement authority and location.

- **Rewritten:** the id remains so links, acceptance-rewrite evidence and earlier rulings still
  resolve. The current choice states its scope under the hosted-site/one-door design.
- **Archived:** either already moved out by the cut (the manifest names the archived file), or
  retained as an explicitly archived decision stub because other decisions still cite its id.
  A stub rejects the historical mechanism; it does not restore it.
- **Confirmed:** the surviving behavioural rule still applies. A dated review in `why` explains
  its narrower scope. Removed subjects in the original evidence are not reintroduced.

The 175 original in-tree decision specifications are preserved, verbatim as TypeScript object
text, in `docs/cut-archive/decision-review-history.json`. This is historical evidence, not a module
imported by the blueprint. The other 26 already-archived decisions remain in the cut archive;
`devnet.head-follows-world` was previously renamed and rewritten as `devnet.site-follows-world`.
This review carries forward the unmerged work in commits `09b926a` and `132ac32`.
The original migration recipe is `packages/plan/scripts/review-old-decisions.mjs`; its category-wide
answers were superseded by explicit per-id choices in
`packages/plan/scripts/refine-decision-review.mjs`. The refinement restores original questions, confirms concrete
surviving choices with their rationale, and replaces changed mechanisms individually. For example,
added tokens still receive exactly one opening at the add block, whereas admitted assets do not;
added-token scans retain cursors/finality but reject the old no-reversals assumption. Site-owned
chart allocation and payroll accrual mechanisms are explicitly archived rather than silently retained.
The blueprint remains authoritative; neither script is a runtime component.

## Round 2 correction: documents (F-1.1)

`concepts.documents` is **rewritten**, not confirmed unchanged. Core retains chain document
hash evidence and caller-supplied participant admissions. The old dependency on a Core payroll
concept is obsolete: Frappe HR owns payroll runs and Salary Slips on the company site. Printing
uses the door; a held site payment binds its draft with `plugs.document-canon`, without requiring
a duplicate Core payroll document or a payroll call to `documents.store`. The refinement script
now records this explicit scope instead of restoring the old choice. Original evidence is unchanged.

## Round 3 correction: participant admission (F-2.1)

`documents.participants` is **rewritten**, not confirmed with its original rationale.
The retained rule still fixes participants at storage time and admits Organization-side
readers through current active Seats, with missing and unreadable indistinguishable.
Its rationale no longer places documents below Core payroll: Frappe HR owns Salary Slips,
and site HR permissions, not generic company-Seat admission, protect their salary data.
The refinement recipe now supplies an explicit replacement rather than restoring the
obsolete dependency from historical evidence.

## Authority

This is a coordinator reconciliation, not new owner testimony. Earlier `aaron.*` records retain
their ids for references but explicitly defer to `aaron.frappe-native` and `aaron.one-door`.
Frappe owns the business documents; Core owns chain authority and money facts. The rules for
ordered site projection, held payments, role projection and whole-world snapshots are the later
`plugs.*`, `sites.*` and `devnet.*` decisions cited in each review. The old swarmD migration is
archived in favour of the authored plan, portal and repository loop.

## Eval identity: implemented by the engine owner

`m1-engine-rules` landed before this reconciliation. Its `system.eval-identity` record in
`blueprint/shared/state-gaps.ts` is the authority: the first refusal or integration failure
keeps its existing id; subsequent cases append `/2`, `/3`, etc., in declaration order.
A global collision is a build problem. No error vocabulary or acceptance claim was changed
by this review to avoid collisions, and no eval rows were discarded.

This checkout's build derives 5,173 eval rows with 5,173 unique ids and zero repeated ids.
These numbers describe the current cut, not the earlier review's larger catalogue.
`pnpm tasks` independently reports `duplicateEvalIds 0`.

Run `pnpm blueprint` followed by
`node --experimental-strip-types packages/plan/scripts/check-decision-review.mjs` to check both
review coverage and the derived catalogue. These are task-level checks, not product eval verdicts.
