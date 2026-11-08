// Equity's door: the procedures other concepts invoke inside their own transaction. There are none.
//
// No other concept's money fact includes an equity row. A round payment, a SAFE, an exercise, a
// secondary purchase and an exit payout each end in a PaymentSent that payments settles from the
// indexed fact (concepts.payments: Payments born from chain facts), so payments never writes equity and
// never depends on it. The Board proposals equity opens are board's (`board.propose`), the approvals
// approvals' (`approvals.open`), and the documents documents' (`documents.store`): equity invokes their
// doors, never the reverse. Notices reads equity's tables and reacts to its transitions through the
// outbox (P4). Decision equity.no-door.

export {};
