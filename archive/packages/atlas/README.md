# atlas

The lean, fully generated site that answers two questions: what the product is, and where it stands. Every page is
made from the blueprint, the status document and git; nothing is written by hand, and the plan and the software factory
are not in it.

```bash
pnpm atlas          # writes var/atlas (index.html, work.html, concepts/, journeys/); exits 1 if a page fails its check
pnpm atlas:test
```

- **Product** (`index.html`): what Capxul is and who uses it; evals passing now, failing and stale; problems, gaps and
  the changes the code owes a decision; where every operation stands; each journey and each concept.
- **Concept pages**: its operations with their stand and why, what the code owes, its gaps, the records it holds,
  who worked on it and its recent commits.
- **Journey pages**: each step, its concept and its stand.
- **Work** (`work.html`): who worked on which concept (tooling counted apart), and a timeline by day with commits,
  who made them, eval verdicts and the concepts touched.

`src/model.ts` derives everything (pure), `src/render.ts` makes the HTML (pure), `src/check.ts` proves the generators
work: every page exists, every link lands on a page, and no value is missing. `src/history.ts` reads git.
