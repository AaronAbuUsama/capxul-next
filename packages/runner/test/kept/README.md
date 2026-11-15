# Kept facts written by earlier code

Facts a shared world kept of its starting worlds (`runner.starting_worlds`, `src/shared/facts.ts`), exactly as they
were kept, read back from its database. `test/kept-facts.test.ts` keeps each in a real Postgres, reads it as a run
reads a restored template and decodes every call it holds with today's schemas. Never edited: a later format is a new
file.

| File | What |
|---|---|
| `2026-11-14.json` | The shared world's facts of `payment-drafted`, kept on 14 November 2026 (`./run.sh shared` at 3d31e72) and read back on 15 November: its world.create, world.show and approval.sign calls and the world it was made in. Their contracts name no Budgets, which the blueprint required from 15 November. |
