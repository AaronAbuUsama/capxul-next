<!--
One pull request per task, from its branch (lane/<concept>, lane/integrations, lane/journeys, ms/<step> or
review/<decision>) into integration/build. Title: [<task key>] <task title>.
The builder writes this body at its first submit and rewrites it at every submit. It holds only the Handback
(docs/design/swarm-templates.md, section 3.3). Every round's gate, evals, checks, signals and the merge are
comments posted by code (section 9.2), not edits here. Fill every heading; write _none_ where a part is empty.
Never paste a token, key or password. A maker never says done: the verdicts do.
-->
Task: `<task key>` · <K-n, or "stage 0">
Round: <n> of 5 · head `<7 hex>` · spent $<x.xx> of $<budget>
Checkers: reviewer<, adversary>
Task card: #<issue, at stage 0; otherwise _none_>

## Submit

**Version:** `<the 40-hex commit you pushed>`
**Addresses:** <F-n, F-m, or none>
**Note:** Changed: <what changed, one or two sentences>. Should move: <eval ids>. Ran: <n> pass, <n> fail, <n> unverifiable, <n> error (<command>). Disputes: <F-n (why), or none>.

<!-- The note is at most 600 characters, in these four parts and this order. -->

## Evals

<!-- Every eval of the task, in the task's order, with its claim and your own run's result. Your run is for
information only: the verdicts that count are the sandbox's (stage 1) or Mission Control's run (stage 0). -->

| Eval | Claim | Own run |
|---|---|---|
| `<eval id>` | <claim> | <pass, fail, unverifiable, error or not run> |

**Own run:** <n> pass · <n> fail · <n> unverifiable · <n> error · `<the command you ran>`

## Handover

<!-- What the next maker needs if another round follows. Done: each with the evals it passed in your run.
Left: what is not, and why; something needed outside the task's paths is "outside <path>: <what>", never a change.
Decisions: each a decision record id or matter id. Where: path:line, at most 6. -->

### Done

- <what is built> (<evals it passed in your run>)

### Left

- <what is not, and why>

### Decisions

- `<decision id or M-n>`: <what it settled>

### Where

- `<path>:<line>` <why to look there first>

## Blueprint first

<!-- Records and decision records this change adds or edits, in its own concept's folder, or "No record changed".
A rewritten claim keeps the frozen claim first in its was and carries a decision. -->

- **Records:** <record keys, or No record changed>
- **Decisions:** <decision ids added or edited, or none>
- **Plan:** <docs/mission/tasks.json regenerated, or unchanged>
- **Blueprint checks:** `pnpm exec tsc -p blueprint` <result> · blueprint <n> problems · `check-frozen` <n> breaches

## Findings

<!-- Every finding open at the start of this round: fixed (how), or disputed (why it is wrong). A disputed finding
stays open until its checker marks it fixed. Round 1: _none_. -->

| Finding | Answer |
|---|---|
| F-<n> | <fixed: how · or · disputed: why> |

## After merge

<!-- The task's evals that came back unverifiable, each with why. They do not block the merge (retro D7); a person on
the project's waive list may waive them. -->

- `<eval id>`: <why it cannot run here, and where it will>
