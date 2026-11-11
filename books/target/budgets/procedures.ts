// The door of the target budgets concept: the procedures other concepts invoke inside their own
// transaction to write budgets' tables. It is empty, by decision budgets.no-door.
//
// No other concept writes a budget row as part of its own money fact. Payments' budget spends,
// payroll's agreements and their reservations, and dated payments move money through the Budgets
// contract, and the chain records them; budgets stores none of that. The spend check payments
// makes before it births a budget spend is a read of org-budgets (which budget, its chain id,
// token, period and status) and of the chain (`Budgets.authorised`, `Budgets.leftOf` and the
// token's payout ceiling) inside payments' own rpc, which may read budgets' tables because
// payments depends on budgets. A read needs no procedure (rules.procedures: a procedure is only
// for a write that must commit with the invoker's).

export {};
