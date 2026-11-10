# agents (generic)

Durable agents over pi-durable. `openHost` opens a run's SQLite file with the coding tools, a confinement hook and an
environment that inherits nothing; `ask` puts one question to one agent (its conversation and its question are found again
by key after a restart) and returns its last message with what it cost; `remember`/`record`/`recall` are the ledger of named
steps in the root conversation; `tail` turns a conversation into lines a person can follow (used by `watch`);
`modelsFrom` builds OpenAI-compatible providers from a config, keys read by variable name; `mcpTools` registers an MCP
server's tools. `types.ts` is the module. Nothing here knows Capxul: this is what gets extracted into a library.
