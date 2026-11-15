# Handoff: the rebuild's conductor moves to Amp (15 November 2026)

Status: **current**, from the evening of 15 November 2026. The Claude Code conductor and its threads were wrapped up
and archived. Whoever conducts next starts here, whatever agent they run on.

## Read first

1. `AGENTS.md`: the rules, the ladder, "Lanes, leads and the conductor".
2. The kit in `.claude/skills/`:
   - `threads`: the thread types and their emojis;
   - `conductor`: the loop and the merge rule;
   - `hashtags`: Aaron's `#shortcuts`.

   Also `.claude/agents/reviewer.md`, the 🔍 review. The kit is written for Claude Code: read "session" as your
   agent's thread, and "subagent" as yours.
3. `docs/roadmap.md`, and the design notes on `master`:
   - `docs/design/blueprint.md`: the decisions, the glossary in part 12, the layout in part 13, the path in part 5;
   - `docs/design/system.md`: what is generated and what is hand-written;
   - `docs/design/world.md`: the world package's layout.

## Where each piece of work stands

| Work | Its state, durable | Next |
|---|---|---|
| Blueprint stage 2 (the next milestone) | `docs/design/blueprint.md`, part 5, "Where it stands"; `slice/blueprint` (#295, passed 🔍 review) and its pull requests #299, #301, #302; the triage backlog in #306 | Land 2a when `gate` and `world` are green on a head that includes `master`, then finish 2b |
| Docs into one set | `docs/design/docs.md`, section 12, on `slice/docs`; #304 left open with its state | Continue the moves; take `master`'s version of `packages/world` |
| World layout | Landed (#300); `docs/design/world.md`; #311 records where it stands | The comments-only follow-up named in world.md |
| System map | Landed (#307), `docs/design/system.md`, with its build order and open questions | Follow its build order after stage 2 |
| Old pull-request triage | `docs/design/pr-triage.md` on `design/pr-triage` (draft #285, never merged) | Aaron approved closing groups 1, 2, 3 and 5 and keeping #145; the closures wait on his word in the triage thread or on #285 |
| Axiom | Set up, nothing sending yet (below) | The instrumentation lane wires it |

## Axiom

- Org Capxul Labs, edge `eu-central-1.aws.edge.axiom.co`, monthly limit $26 (its $25 fee counts toward it).
- 13 datasets: `capxul-{test,real}-{traces,logs,events,metrics}`, `capxul-agents-{traces,logs,metrics}`,
  `capxul-cloudflare-{traces,logs}`.
- Tokens, in Aaron's macOS Keychain and Bitwarden, never in a repository or container:
  `capxul-ingest-{test,real,agents,cloudflare}` (send-only) and `capxul-query` (read, capped at $1 an hour and $5 a day).
- Cloudflare destinations `axiom-capxul-traces` and `axiom-capxul-logs` wait for a wrangler config.
- Open: lock the event datasets' schemas once declared; the wrangler change; Axiom's billing page shows no payment
  method though the $25 was paid (Aaron, before 15 December).

## Lessons from 15 November

- **Merge on a fresh base.** A pull request merges only when it has no conflicts and `gate` ran on a head that includes
  the current `master`; two pull requests, each green alone, broke `master` once.
- **Review every slice.** A slice into `master` gets a 🔍 review pass first.
- **The conductor never connects to Aaron's computer.** A session that does is limited to his trusted devices, so no
  other thread or schedule can reach it. Work on his Mac is a 🖥️ thread he starts himself.
- **Sessions started by a schedule have no GitHub or thread tools,** so status pages are kept by a thread that is sent
  updates.
- **Codex review is out of credit,** so its comments are noise.
