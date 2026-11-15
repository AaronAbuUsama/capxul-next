// Example data the budget's verbs share.

const TOP_HAT = "26960358049567071831564234593151059434471056821808218863738184065024";

const OFFICE_HAT = "26960358049567071831564234593151059434471056821808218863738184065025";

/**
 * @internal Northwind's top budget, in the examples.
 */
export const top = {
  id: "7",
  org: "org_northwind1",
  name: "Northwind Trading",
  parent: null,
  hat: TOP_HAT,
  holders: [],
  asset: "USDC" as const,
  period: "month" as const,
  amount: "1000000",
  spent: "0",
  committed: "0",
  left: "999000",
  closed: false,
};

/**
 * @internal Its office costs budget, in the examples.
 */
export const office = {
  ...top,
  id: "8",
  name: "Office costs",
  parent: "7",
  hat: OFFICE_HAT,
  holders: ["sam"],
  amount: "1000",
  left: "1000",
};
