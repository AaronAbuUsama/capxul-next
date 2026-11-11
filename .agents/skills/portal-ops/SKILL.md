---
name: portal-ops
description: Build, serve and check the capxul-next book (the portal) from the coordinator's Amp orb, so Aaron can read it and answer the Questions page. Use at the start of the lead thread, after every plan change, merge or eval run, and when Aaron cannot reach the book.
---

# Portal ops

The book is generated from the blueprint, the plan and the scoreboard (`packages/portal`). It is served from the
coordinator's orb, because the Questions page writes Aaron's answers to `plan/answers.jsonl` in the checkout that serves
it, and only the coordinator applies and commits them. A book served from any other checkout loses answers.

## Serve it

`.amp/services.yaml` declares the `book` service: it builds the site and serves it on Amp's `$PORT`, with a portal link
on the thread. Only people who can view the thread can open it.

```bash
amp orb services ensure            # starts the book if it is down
amp orb service status book
amp orb service logs book
amp orb service restart book       # after a rebuild, if the page did not refresh
```

## Check

```bash
pnpm portal:check                                             # every page and link
curl -sf -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:$(amp orb service status book --json | jq -r .port)/"   # 200
```

## Keep it current

- Rebuild with `pnpm portal` after every plan change, merge or eval run. The pages are generated, so a page is only as
  new as its last build.
- Before the orb pauses or the lead thread hands over, commit and push `plan/answers.jsonl` (a `Plan:` commit), so no
  answer is lost.
- Never start a second book on another port. If the book will not come back, read its logs, fix what you can, and tell
  Aaron in one message what was wrong and what you did.
