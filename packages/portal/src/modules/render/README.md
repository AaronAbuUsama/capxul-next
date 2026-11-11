# render

A `Site` in, the HTML of every page out, plus the stylesheet and the script it was given.

```ts
const files = renderSite(site, { css, js });   // ReadonlyMap<path, content>
```

| File | From |
|---|---|
| `<page id>/index.html` (`index.html` for the Overview) | one page model |
| `assets/style.css` | `Assets.css`, as given |
| `assets/site.js` | `Assets.js`, as given |

## Rules

- Every link is relative to the page that holds it (`relative` from the site door), so the site works from any
  folder, behind any path prefix and from `file://`.
- Every page is whole without the script. The script runs on the Questions page only: it shows one question at
  a time, builds the typed answer (a `ReviewAnswer`) and points a link at a prefilled GitHub issue. It writes
  nothing and holds no credential; without it every question is on the page, with a `<noscript>` note.
- All text from the blueprint passes through `esc` in `internal/html.ts`. No page model carries HTML.
- Long text is never rewritten, only laid out (`internal/prose.ts`): split at sentence ends into paragraphs of two
  or three sentences, never inside backticks or brackets or after an abbreviation; a bracketed citation such as
  `(old S3)` or `(payments.claim-escrow-routes)` is drawn quiet, and links when it names a record.
- Code is highlighted at generation time (`internal/highlight.ts`): a small tokenizer for JSON, the command line
  and TypeScript, on one fixed dark panel, each block under a label that says what it is. The answer on the
  Questions page is built in the browser, so `assets/site.js` highlights it with the same `tk-*` classes.
- A count is drawn as a link to the list it counts (`tiles` in `internal/tables.ts`).
- Where the blueprint holds nothing, the page says so ("the blueprint names none"); a row is not left out.
- The design is `docs/design/portal.md` and the five screens it names (decision `portal.designed-screens`):
  blue, orange and grey only; no red, no green, no emoji, no gradient.
- The module reads no file. `main.ts` reads `assets/` and passes the text in.

## Inside

`internal/chrome.ts` is the frame every page shares (top bar, twins, footer). `internal/parts.ts` holds what more
than one page draws (the stand bar, the operations table, evals, findings). `internal/tables.ts` draws any table a
page model holds, which is all a catalogue page is. `internal/trace.ts` draws a run, on an operation's page and on
Architecture; `internal/evals.ts` draws an operation's evals by kind. One file per page type does the rest.
