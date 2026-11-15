# Design notes: contracts from first principles

Working notes for the contracts redesign thread started on 15 November 2026. Not for merging into `master`: the
outcome lands as roadmap decisions and slices.

- `primitive-mapping.md`: the first study, mapping each on-chain primitive (Agreements, Payments, Budgets, Escrow) to
  Frappe/ERPNext/HRMS records. Aaron rejected its agreement recommendation.
- `agreements-design.md`: the second study, "every on-chain movement settles one sealed Frappe document", agreements
  v2, escrow for counterfactual accounts, privacy model. Aaron found the invoice side clunky and wants to rethink the
  contracts from first principles.
- `parity-inventory.md`: what the old stack (`xelmar-tech/infrastructure`) does, as journeys.

Decisions already recorded in `docs/roadmap.md` on master (14 and 15 November 2026): every payment settles one sealed
document; no email on chain; the founder governs the Board; no streaming pay; one public surface, Frappe behind it where
it owns the data; payroll is Frappe HR under Capxul's operations, reconciled with the on-chain primitives.
