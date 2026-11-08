// The indexing concept's door, as it is: none. packages/backend/src/indexing has no `index.ts` and no
// `#indexing` entry in the backend's import map; no concept imports it, only its own Convex registrations
// and convex/schema.ts (for `indexingTables`) do (indexing/README.md:20, foundation's concept_indexing).
// The cron registry (platform/jobs.ts:130, :139, :150) reaches its workflows by Convex reference. This
// file books no procedure.

export {};
