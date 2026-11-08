// Contacts' durable processes. There are none.
//
// An address book entry is a short-lived row that changes only inside an rpc: nothing about it waits
// on a signature, the chain, a date, a person or Bridge, so it has no process (decision
// rules.durable-processes). The member relationship is read from organizations' Seats when the book
// is read, so no workflow copies it. The old `parties.contacts.emitRelationshipChanged` action only
// posted telemetry after a write (P7: the `contact_transitioned` event now leaves through the
// outbox) and is not ported. Decision contacts.no-door-no-process.

export {};
