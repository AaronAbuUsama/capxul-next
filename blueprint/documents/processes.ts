// Documents' durable processes. There are none.
//
// A document is stored once, inside the transaction that births its subject, and never changes: it
// waits on no signature, chain, date, person or vendor, so it has no process (A3, rules.durable-processes).
// What the old concept did in the background goes (decision documents.movement-memos):
// - `documents.memos.ensure` and its `authorize` and `persist` steps proved Transfers on chain to write
//   Memos on a reader's demand; no SDK method or CLI command called it (P2). A Movement's Memo is now
//   stored with the Movement, in payments' record transaction, through `documents.store`.
// - the orphan markers that followed reorgs over a scan window: a Movement's reorg is payments' `remove`
//   and `restore` on its own machine, and the Memo, immutable, stays as it was.
// - the `ponderFallback` and `memosEnsured` wide events: telemetry is the runtime's (P6, P7).

export {};
