# check

Reads a generated site back and says whether it can be trusted. It never builds a site itself: it is given the
files, a second generation of them, and what the book expects.

```ts
const outcomes = check(files, again, expect(book, waits));
passed(outcomes);   // true when no part has a failure
```

| Part | Fails when |
|---|---|
| every record has a page and both twins, and every page belongs to a record | a record of a kind that has pages lacks its HTML, Markdown or JSON; or a file is the page of no record |
| every internal link and anchor resolves | an `href`, `src` or Markdown link names a file that is not there, an anchor names no `id` on its target, or a page uses one `id` twice |
| two generations are byte-identical | any file differs between the two, or one has a file the other lacks |
| the Questions list equals the judgments list | `data/review.json` is not exactly the decisions `waits` holds, in the book's order |
| every operation has a stand | an operation's `data/operation/<id>.json` has no stand of `specify`, `decide` or `build` |
| the eval catalogue lists every eval the book derives | the rows of all `data/eval/<kind>.json` files do not add up to the evals the book derives |

A page that belongs to no record is one of the fixed set: the five top pages, `docs/<name>` for each catalogue,
`eval`, and `eval/<kind>` for each kind of eval the book derives. `expect` lists them by rule.

`waits` is `forAaron` from `books/target/shared/waiting.ts`, the predicate `tools/report-judgments.ts` lists its
"For Aaron" section with. The check derives the expected list from the book and that predicate, not from the site.

## Rules

- `expect` reads the book only. It shares no code with `site`, so a mistake in how the site chooses its pages is
  seen here and not repeated.
- Links that leave the site (`https:`, `mailto:`) are not followed.
- A failure is a value: an `Outcome` with a count and up to a few lines of detail. Nothing throws.
