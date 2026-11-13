# Budgets selected-stack checks

This runner shares the Books selected-stack door (`../books/door.ts`) and its rules: one fresh, complete, receipt-first slice-0 run on `postgres-ponder-erpnext-v4`, restricted roles only, and an explicit failure for every check when a prerequisite fails.

`tbl:budgets/schema` is bound to live introspection against the declared Capxul-only metadata contract. Amounts, commitments, spend, closed state and wearers stay chain-owned. Tenancy and writers are near-misses: no slice-zero runtime writer persists budget metadata yet, and an empty table or seeded rows cannot satisfy them. They bind once budget preparation is composed through the Board proposal, the Approvals carrier end and the Sponsorship SafeOp builder.
