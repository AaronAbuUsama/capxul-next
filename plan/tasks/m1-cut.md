## What
Removed from the book everything that rebuilt what Frappe already does: the Capxul versions of accounts, payroll and HR, the CRM, projects, and document printing. 908 records were moved to `docs/cut-archive/` with a reason each. Equity, the hosted FDE, referrals and services are parked there, not deleted.
## Why
More than half the old book described a product we are no longer building. Tests derived from it would have pulled the build the wrong way.
## Done when
- The book builds with no problems on the new shape.
- Every one of the 215 old operations is either still in the book or classified with a reason.
- `tools/report-cut.ts --check` finds no archived record still in the book.
## Links
- `docs/design/cut-proposal.md`
- `docs/cut-archive/INDEX.md`
