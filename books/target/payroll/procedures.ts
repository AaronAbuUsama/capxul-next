// Payroll's door: the procedures other concepts invoke inside their own transaction. There are none.
//
// Old payroll's door held `settle-run-for-settled-payment` and its neighbours, which payments invoked
// inside a settlement so that a settled Payment never left its payroll run open. Runs are back in
// Frappe HR's shape (payroll.scope), but the other way round: a run births its command through
// payments' door and its own process follows `payment_transitioned` (payroll.pays-through-payments),
// so payments still never depends on payroll (dependencies.payments-payroll). An agreement collection
// is `Agreements.collect`, whose PaymentSent payments settles like any other payment born from a chain
// fact. Nothing else writes payroll's tables: notices and the daily agreement notices read them and
// react to payroll's events through the outbox (P4). Decision payroll.no-door.

export {};
