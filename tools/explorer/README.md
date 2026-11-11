# The book explorer

A read-only page over the target book: concepts, commands, decisions (with the ones waiting for Aaron), the command
packs and the gaps. It is published as a private claude.ai artifact; the book stays the source of truth.

```sh
node --experimental-strip-types tools/export-explorer.ts tools/explorer/book.json "<when>"   # not committed
```

Then publish `tools/explorer/index.html` with `book.json` beside it. D0's portal replaces this page.
