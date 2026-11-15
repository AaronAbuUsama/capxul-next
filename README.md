# Capxul Next

This is `master`, the rebuild line of Capxul: a hosted, re-skinned Frappe with Capxul's on-chain authority, budgets,
payments and banking built in. It is separate from `main` and `integration/build`.

Where it stands: the dashboard at https://claude.ai/artifact/6vhMzxXsWZptFjKREJnu8g.

## Where to go

| To | Read |
|---|---|
| know the rules before you change anything | [AGENTS.md](AGENTS.md) |
| see the plan, its items and what is Done | [docs/roadmap.md](docs/roadmap.md) |
| know why Capxul exists and how it earns | [docs/grounding.md](docs/grounding.md) |
| understand the blueprint, its formats and the words we use | [docs/design/blueprint.md](docs/design/blueprint.md) |
| understand how these docs are laid out | [docs/design/docs.md](docs/design/docs.md) |
| work on a package | its own `README.md`, under [packages/](packages) |

Each package's one-line reason for existing is in `PACKAGES`, in
[packages/lint/src/shape.ts](packages/lint/src/shape.ts).

## The gate, and a run

```bash
pnpm install
pnpm format                              # rewrite the code into shape
pnpm check                               # the gate: rungs 1 to 5, listed in AGENTS.md
packages/runner/run.sh scenarios         # rung 6: every journey in a fresh world (needs Cloudflare and Neon keys)
```
