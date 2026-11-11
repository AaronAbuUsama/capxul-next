---
name: ask-aaron
description: Put a question that only Aaron can answer on the portal's Questions page, as one concrete question he can answer in one tap, then keep climbing. Use for product, architecture, money, credential and irreversible choices, and for his acceptance of a milestone.
---

# Ask Aaron

## Is it his?

It is his only if it changes the product or the architecture, spends or moves money, needs a credential or an account, cannot be undone, or accepts a milestone. Otherwise decide it yourself, write a decision record, and move on. Never bypass a limit to avoid asking.

## One concrete question, in a structured form

- **A decision**: write the decision record with a `question`, two to four `options`, `chosen` set to your recommendation, and a `why`. Block the waiting tasks with `pnpm plan task block <id> --decision <decision id>`. He picks an option on the Questions page.
Prefer a decision whenever he is choosing: the Questions page shows a decision with one button per option, but a plan need only as plain text.

- **A need** (a key, an account, an action on his side, never a command for him to run): `pnpm plan task block <id> --need "<the exact thing, where it goes, and how to check it worked>" --who aaron`.

Each card stands alone: what is being decided, why now, what each option causes, and what you recommend. One question per card. Never ask again what he already answered.

## Then

- Put all of the sweep's questions up together, so he answers in one visit.
- Rebuild the book (the `portal-ops` skill), then send one message of at most 100 words where he reads you (the lead Amp thread), with a link to the Questions page.
- Work that is already authorized continues meanwhile. Keep working on the recommended option where the step can be undone, and route the path around the waiting task.

His answer arrives in `plan/answers.jsonl`. The next sweep applies it.
