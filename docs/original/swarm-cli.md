# The original Capxul's swarm CLI: what is agreed

Aaron, 9 November 2026. One tool, specific to the original Capxul (`Xelmar-tech/infrastructure`), for the whole
management of its swarm on swarmD: create it, deploy and update its definitions, add workers, tools, skills and
connectors, set models, tiers and secrets, open and read work, read the board and the logs.

- **An agent-friendly CLI only.** No MCP server, no Slack, no Pi plugin, no general harness. Every command answers
  `--json` with stable exit codes and errors from one catalogue; nothing prompts (every choice is a flag; anything
  risky previews first); a retry is safe; the CLI describes itself (every command, its inputs and its answer) so a
  coding agent learns it in one call.
- **Whatever is simplest** (his answer on the open questions): it lives inside the original Capxul repository as one
  small package; it pins today's swarmD (commit `9703092`, built from source, since swarmD is not on npm) and the
  deployed server it talks to; it manages what swarmD has today (routers and workers), and swarmD is fixed only
  where the project needs something it lacks.
- **Built the kit's way:** a small book of its operations and evals, the evals driving the real CLI against a test
  namespace on the swarmD server.

What today's swarmD offers is inventoried in `swarmd-today.md`.
