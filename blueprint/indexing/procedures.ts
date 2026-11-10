// Indexing's door: no procedures. Ponder alone writes indexing's views (components.ponder), so no
// concept writes them through a procedure, and nothing in `app` is indexing's to write. Concepts
// that depend on indexing read its views directly, scoped by parties' directory (P8), and are
// triggered by the chain events Ponder indexes. Decision: indexing.tables-only.

export {};
