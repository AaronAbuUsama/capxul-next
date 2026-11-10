# @capxul/loop-ui

The Runs app: watch, inspect and steer the loop's agents. **A prototype**: it shows real runs read from a file
(`src/fixtures/runs.json`), and nothing it does is sent anywhere. The real app will be a client of the loop's host.

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
| `src/app/data.ts` | the runs, and what is derived from them: the timeline of steps, the rounds, the handoffs |
| `src/app/Home.tsx` | Now: what is working, what needs you, what finished, other work in progress |
| `src/app/RunPage.tsx`, `Overview.tsx` | one run: steps, the picked step, the details; the run in short |
| `src/app/Conversation.tsx`, `Results.tsx` | an agent's conversation and the box to talk to it; hand-backs, verdicts, checks |
| `src/app/Inspector.tsx`, `AgentsPage.tsx` | everything about an agent; the agents as a roster with their sessions |
| `tools/export-fixtures.ts` | writes the fixture from runs in `var/runs` (read-only, secrets hidden, long output cut) |

One run can be replayed as if it were live (the switch at the bottom of the sidebar), so the live states can be seen.
