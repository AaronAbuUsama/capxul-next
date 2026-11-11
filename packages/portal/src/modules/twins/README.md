# twins

The same `Site` for a reader that is not a browser: an agent, a script, a search index.

```ts
const files = twinsOf(site);   // ReadonlyMap<path, content>
```

| File | What it is |
|---|---|
| `<page id>.md` | the page as Markdown: the same sections, in the same order, as the HTML |
| `data/<page id>.json` | the page model itself, keys sorted, two-space indent |
| `llms.txt` | the way in: the fixed pages, the concepts, the grammar of the record pages, the data files |

`data/index.json` carries the counts, the commit, the problems, the gaps and the nav. `data/review.json` is the
waiting list the portal check compares with the judgments report. `data/operation/<id>.json` carries the stand,
the SDK call, the trace and a JSON skeleton per return shape; its Markdown twin prints them as fenced code and
lists. `data/eval/<kind>.json` holds every eval of one kind: the portal check counts their rows.

## Rules

- A Markdown twin links to other twins (`.md`), never to an anchor: a twin has no ids. It opens with a line that
  links to its own HTML and JSON.
- Text from the blueprint is put on one line and cannot start a link (`plain` in `internal/md.ts`).
- The JSON twin is the page model with nothing added and nothing left out, so a page never says more than its data.
- No timestamp anywhere. The commit is the one the caller passed.
