// The operator concept's door, as it is: none. packages/backend/src/operator has no `index.ts` and no
// `#operator` entry in the backend's import map; no other concept imports it (operator/README.md:21).
// Others reach it only by running its internal functions: the mail owner runs operator.outboxes.record
// and operator.notices.record (integrations/mail/service.ts:171, integrations/mail/notices.ts:41), and the
// chain seam reads operator.receipts.is-held over HTTP (platform/proof-controls/receipt-policy.ts:56). Those
// are rpcs, booked in their area files. This file books no procedure.

export {};
