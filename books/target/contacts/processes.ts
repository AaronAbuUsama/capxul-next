// Contacts' durable processes. There are none.
//
// An address book entry, a lead and a deal change only inside an rpc: nothing about them waits on a
// signature, the chain, a date, a person or Bridge, so none has a process (decision
// rules.durable-processes). A lead's conversion is one transaction; a deal's expected closure date
// is a forecast, not a timer. The member relationship is read from organizations' Seats when the book
// is read, so no workflow copies it. The old `parties.contacts.emitRelationshipChanged` action only
// posted telemetry after a write (P7: the `contact_transitioned` event now leaves through the
// outbox) and is not ported. Decision contacts.no-door-no-process.

export {};
