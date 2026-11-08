// Payroll's door: the procedures other concepts invoke inside their own transaction. There are none.
//
// Old payroll's door held `settle-run-for-settled-payment` and its neighbours, which payments invoked
// inside a settlement so that a settled Payment never left its payroll run open. Runs are dropped
// (concepts.payroll), so that money fact no longer exists, and payments never depends on payroll
// (dependencies.payments-payroll): an agreement collection is `Agreements.collect`, whose PaymentSent
// payments settles like any other payment born from a chain fact. Nothing else writes payroll's
// tables: notices and the daily agreement notices read them and react to `agreement_transitioned`
// and `agreement_write_transitioned` through the outbox (P4). Decision payroll.no-door.

export {};
