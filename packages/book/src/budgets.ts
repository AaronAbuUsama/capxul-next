// Budget defaults per class (policy P5, accepted 7 November 2026): operation p50/p95 in ms,
// from the unavoidable hops of each class. A target record that sets other numbers says why.

export const BUDGET_DEFAULTS = {
  read: { p50Ms: 600, p95Ms: 1200 },
  "live-read": { p50Ms: 300, p95Ms: 1000 },
  write: { p50Ms: 700, p95Ms: 1500 },
  "chain-read": { p50Ms: 900, p95Ms: 2000 },
  "chain-submit": { p50Ms: 2000, p95Ms: 4000 },
  "chain-settle": { p50Ms: 3000, p95Ms: 8000 },
  vendor: { p50Ms: 1500, p95Ms: 4000 },
  background: { p50Ms: 2000, p95Ms: 15000 },
} as const;

export type BudgetClassName = keyof typeof BUDGET_DEFAULTS;

/** A budget at its class default, for records that take the default. */
export const budget = (cls: BudgetClassName) => ({ class: cls, ...BUDGET_DEFAULTS[cls] });
