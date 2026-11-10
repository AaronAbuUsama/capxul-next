# answers

The owner's answers to what waits on him, saved. `respond(req, deps)` turns one request into one response, as plain data:

- `GET /api/answers` the answers not yet applied;
- `POST /api/answers` `{ target: { kind: decision | task, id }, answer: { how, … } }` appends one validated line to
  `plan/answers.jsonl`; `{ withdraw: <answer id> }` appends a withdrawal (the Undo). Nothing else is writable.
- every other `GET` is a file of the generated site.

The target must be waiting (a decision the blueprint holds for the owner; a task blocked on a need of his), an option must be one
of the decision's, text is at most 2000 characters, the body at most 8192 bytes, and a second answer for one target is
refused until the first is withdrawn. Applied state is not in this file: the coordinator's `plan answers apply` writes it
to `plan/log.jsonl`, so `answers.jsonl` is append only. `src/serve.ts` puts this behind Node's own `http` on 127.0.0.1.

A server started from a linked worktree is closed (`deps.closed`, set by `closedFor` in `src/serve.ts`): `/api/answers`
refuses every request with the reason and writes nothing, because the coordinator reads only the repository's own
`plan/answers.jsonl`. The site itself is still served, so a worktree can show its pages.
