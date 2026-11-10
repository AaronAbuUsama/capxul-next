# @capxul/loop-ui

The Runs app: watch and inspect the loop's agents. It attaches to the loop's host (`pnpm loop serve`, on this
machine) and shows every run as it changes; Stop asks a run to stop. With no host it says so and shows a recording
(`src/fixtures/runs.json`, real runs of 10 November). Steering an agent from the page is not wired yet.

```bash
pnpm --filter @capxul/loop-ui dev      # http://localhost:4393
```

It is laid out the way agent tools are: every run one click away in the sidebar, a run's steps down the left, the
agent's conversation in the middle with its tool calls folded into each turn, and everything about the agent on the
right. On a phone the three are tabs. It is built from shadcn/ui and its AI components (message scroller, message,
bubble, trace, code block), copied into `src/components/ui/` by `pnpm dlx shadcn@latest add`: that folder is shadcn's
code, not ours.

| Where | What |
|---|---|
| `src/app/types.ts` | a run's data has one definition, in the loop (`@capxul/loop/wire`); this adds only what the page derives |
| `src/app/live.ts` | the attachment to the host: `loop.runs` over pi's Chord layer on a WebSocket |
| `src/app/data.ts` | the runs, and what is derived from them: the timeline of steps, the rounds, the handoffs |
| `src/app/Home.tsx` | Now: what is working, what needs you, what finished, other work in progress |
| `src/app/RunPage.tsx`, `Overview.tsx` | one run: steps, the picked step, the details; the run in short |
| `src/app/Conversation.tsx`, `Results.tsx` | an agent's conversation and the box to talk to it; hand-backs, verdicts, checks |
| `src/app/Inspector.tsx`, `AgentsPage.tsx` | everything about an agent; the agents as a roster with their sessions |
| `tools/export-fixtures.ts` | writes the fixture from runs in `var/runs` (read-only, secrets hidden, long output cut) |

One run can be replayed as if it were live (the switch at the bottom of the sidebar), so the live states can be seen.
