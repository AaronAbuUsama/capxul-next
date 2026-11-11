# Runbook: merge swarmd PR #133 and deploy swarmd-server

Written 2026-11-09 at about 14:40Z. Sources: the cross-lane review, the live prediction and the deploy-mechanics report, plus checks I re-ran for this runbook (GET requests and read-only wrangler calls only).

## 1. Verdict: GO, after 16ee6a0 is pushed and its CI is green

**Why go**

- **The code finding is fixed.** The cross-lane review found one code problem that had to be fixed before the deploy: in an archived namespace, a build manager could still open tasks and pairs through `task_open` and `pair_start`. Commit 16ee6a0 fixes it. I re-ran both checks at 16ee6a0 for this runbook:
  - `OPENAI_API_KEY= npm test -w @swarmd/server`: 103 files and 774 tests pass; 12 files and 129 tests are skipped as live.
  - `npm run check`: exits 0 with no `not ok`.
  - The tree is clean, and the commit has no attribution lines.
- **The second finding is operational, not code.** It is bt-check (it names AaronAbuUsama/swarmd, so it would get that repository's events). It is handled by archiving bt-check as the first write after the deploy (step 10). The archive route only exists once the new code is live.
- **Nothing in the platform changes shape:**
  - no Durable Object migration;
  - no new class or binding;
  - `wrangler.jsonc` is unchanged.
- **The live image can be reused.** The image inputs (`packages/server/sandbox.Dockerfile` and `src/bin/env-server.ts`) are byte-identical to main, so the deploy pins the digest that is live now.
- **Rollback is one command:** `wrangler rollback` to 096b6307.
- **Nothing live needs a secret binding.** Every egress secret on the live swarm is `GITHUB_TOKEN` for github.com, sent as Basic under `x-access-token`. That is the server's built-in default, so nothing needs `swarmd secrets bind`.
- **Reads that fail today should start answering:** `/r/swarmd/managers`, `/r/swarmd/usage`, `/inbox`, and the `factory` and `factory-build` rows.

**No-go if any of these is true**

- CI on 16ee6a0 is red.
- main has moved past 1b6a8de and the merged tree has not been re-checked.
- The swarm is not quiet (a sandbox container is live, or a ticket is mid-turn).
- Cloudflare refuses the upload.

## 2. State at 14:40Z (re-checked for this runbook)

| What | Value |
|---|---|
| PR #133 | Open and draft. `mergeable: true`, `mergeable_state: clean`. Head on GitHub is 634d399, whose `check` passed and whose `ask` was skipped. |
| Local branch | `claude/infrastructure-refactor-plan-v41iue` at 16ee6a0552f8cecbde63b04878af93d253c12e1e. It is one commit ahead of origin and **not pushed**. |
| origin/main | 1b6a8deb813d6f3b2fca2b0464e2d697f23ed696. Local `main` is 182 behind origin; a fast-forward works. |
| Live Worker | Version 096b6307-0a5a-4462-8c8d-36f0f4a99319 at 100%, deployed 13:44:28Z from main 1b6a8de. It pins image `sha256:9d52e1028a2dc8b508265104e5c098caa65f70f5f117a51553be19a463f39c17`, with migration tag v5. `swarmd-server-sandboxdo` has 0 live instances. |
| Live reads (token sent unless noted) | **401**<br>- `/version` (no token)<br><br>**404**<br>- `/version`<br>- `/namespaces/swarmd/secrets`<br><br>**200**<br>- `/me`<br>- `/r/namespaces` (36 namespaces)<br>- `/r/swarmd/ops`<br>- `/r/swarmd/swarmd`<br>- `/r/capxul-test/managers`<br>- `/r/swarmd/factory-build/tickets`<br><br>**500, error 1101**<br>- `/r/swarmd/managers`<br>- `/r/swarmd/usage`<br>- `/inbox`<br>- `/r/swarmd/factory`<br>- `/r/swarmd/factory-build`<br>- `/r/swarmd/factory/usage` |
| Live data details | - `/r/swarmd/factory-build/tickets` has 8 items; 2 of them have no id (the empty T-2 and T-5).<br>- On `/r/capxul-test/managers`, `build` is listening and `eval-hooks` is paused with 8 queued. |
| swarmd ledger | 34 tasks: K-14, K-29 and K-31 active; K-5 and K-8 blocked. |
| Environment | `SWARMD_URL` (the live URL), `SWARMD_TOKEN`, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set. `SLACK_SIGNING_SECRET` is not set. dockerd is not running, and it is not needed with `--image`. |

## 3. Rules for this run

- **Secrets:** never print `SWARMD_TOKEN` or `CLOUDFLARE_API_TOKEN`. Commands reference the variables only.
- **No attribution lines** in commits, PR bodies or the merge commit message (AGENTS.md).
- **Live server:** all writes are the ones listed in this runbook. Do not run the deployed e2e suite: it creates more `e2e-*` namespaces and spends model money.
- **Worker secrets:** delete none during this run. A rollback routes by `SLACK_NAMESPACE` and `GITHUB_NAMESPACE`, and any secret change makes `wrangler rollback` stop to confirm (section 10).
- **Waiting:** run wait loops in the background or with Monitor, because foreground `sleep` may be blocked.
- **Shell setup:** each shell block needs:
  ```bash
  S=/tmp/claude-0/-home-user/c92cd756-b1a0-5414-9fe4-a7834db8d32a/scratchpad
  U=https://swarmd-server.thedao.workers.dev
  ```

## 4. Before the merge

**Step 1. Push the review fix.**

```bash
cd /home/user/swarmd
git status --porcelain --untracked-files=no      # must print nothing
git rev-parse HEAD                               # 16ee6a0552f8cecbde63b04878af93d253c12e1e
git push origin claude/infrastructure-refactor-plan-v41iue
```

**Step 2. Wait for CI on 16ee6a0.** The `check` workflow runs `npm ci`, `npm run check` and `npm test -w @swarmd/server`; it takes about 5 to 8 minutes.

```bash
until gh api repos/AaronAbuUsama/swarmd/commits/16ee6a0552f8cecbde63b04878af93d253c12e1e/check-runs \
  --jq '.check_runs[] | select(.name=="check") | .status' | grep -qx completed; do sleep 30; done
gh api repos/AaronAbuUsama/swarmd/commits/16ee6a0552f8cecbde63b04878af93d253c12e1e/check-runs \
  --jq '.check_runs[] | "\(.name) \(.status) \(.conclusion)"'
```

- **Expected:** `check completed success`.
- `ask` may read `skipped`. That is normal: `swarmd-checks.yml` runs only for PRs opened by `swarmd-agent[bot]`.
- **If red:** no-go. Fix on the branch, test first, push, and wait again.

**Step 3. Confirm main has not moved.**

```bash
git fetch origin && git rev-parse origin/main    # 1b6a8deb813d6f3b2fca2b0464e2d697f23ed696
gh api repos/AaronAbuUsama/swarmd/pulls/133 --jq '{head:.head.sha, mergeable, mergeable_state}'
```

- **Expected:** head 16ee6a0…, `mergeable: true`.
- If main moved: merge main into the branch (merge, never rebase, as the PR body promises). Re-run both checks, push, and repeat step 2.

**Step 4. Bring the PR body up to date (recommended).** The body lists every lane commit except 16ee6a0, and it ends with a "Generated by Claude Code" line, which AGENTS.md forbids.

```bash
gh api repos/AaronAbuUsama/swarmd/pulls/133 --jq .body > $S/pr133.md
```

Edit `$S/pr133.md` as follows:

- **"The lanes":** add this row:
  `| Cross-lane review | 16ee6a0 | A build manager in an archived namespace starts no pair and opens no task: task_open and pair_start answer conflict (DOC-17); a pair already running keeps opening its seats. |`
- **"Checks":** change the count to `774 passed, 129 skipped`.
- **bt-check bullet:** change it to say "archived right after the deploy (`swarmd ns archive bt-check`)".
- **End of the body:** delete the final `---` line and the `_Generated by …_` line.

Then send it:

```bash
gh api -X PATCH repos/AaronAbuUsama/swarmd/pulls/133 -F body=@$S/pr133.md --jq .html_url
```

**Step 5. Check the swarm is quiet.**

```bash
cd /home/user/swarmd/packages/server && npx wrangler containers list
```

- **Expected:** `swarmd-server-sandboxdo` shows 0 live instances.
- If it shows more than 0, a ticket's sandbox is working. Wait until it is idle. A deploy cuts every in-flight Durable Object call; that is how P-2 got stuck at 08:57Z.

## 5. Merge

**Step 6. Mark the PR ready and merge it.** `gh pr merge` uses GraphQL, which is blocked in this environment, so use the REST and CCR routes.

```bash
gh api -X POST repos/AaronAbuUsama/swarmd/pulls/133/ccr/ready_for_review
gh api -X PUT repos/AaronAbuUsama/swarmd/pulls/133/merge \
  -f merge_method=merge \
  -f sha=16ee6a0552f8cecbde63b04878af93d253c12e1e \
  -f commit_title='Merge pull request #133 from AaronAbuUsama/claude/infrastructure-refactor-plan-v41iue' \
  -f commit_message='Secrets bound by the owner, events per namespace, reads that survive a bad manager, /version and namespace archive'
```

- **Expected:** `{"merged":true,"sha":"<M>",...}`.
- Use a merge commit, not a squash, so the lane commits that the reviews cite stay on main. Do not delete the branch.
- **If the merge answers 405 for a required review or a ruleset:** stop and ask Aaron. Do not bypass it.

What the merge starts:

- `check.yml` runs on main.
- `docs.yml` deploys `swarmd-docs`, because `apps/docs` changed. For a few minutes the docs describe `/version`, archive and bindings before the server has them.
- The merge's own GitHub events (the push to main, the PR closing) reach the old Worker, which sends them to `swarmd` only.

## 6. Pull main

**Step 7. Check out the merged main.**

```bash
cd /home/user/swarmd && git fetch origin && git checkout main && git pull --ff-only
M=$(git rev-parse HEAD); echo "$M"                                   # the merge sha from step 6
git diff --quiet 16ee6a0552f8cecbde63b04878af93d253c12e1e HEAD && echo "tree = tested head"
git status --porcelain --untracked-files=no                          # must print nothing, or /version gets -dirty
```

- If the tree differs from 16ee6a0 (main moved during the merge): stop, and run `npm ci`, `npm run check` and the server tests again.
- No `npm ci` is needed otherwise. Between 1b6a8de and 16ee6a0 no dependency changed: only the server's `check` script did.

## 7. Deploy

**Step 8. Start a live tail before deploying.** Run it in the background and keep it until step 13 is done.

```bash
cd /home/user/swarmd/packages/server && npx wrangler tail swarmd-server --format pretty > $S/tail.log 2>&1
```

**Step 9. Deploy, pinning the live image.**

```bash
cd /home/user/swarmd/packages/server && node scripts/deploy.ts \
  --image "registry.cloudflare.com/$CLOUDFLARE_ACCOUNT_ID/swarmd-sandbox@sha256:9d52e1028a2dc8b508265104e5c098caa65f70f5f117a51553be19a463f39c17" \
  2>&1 | tee $S/deploy.log
```

- **Expected output, in order:**
  - `deploying <M>` with no `-dirty`;
  - the bindings `MANAGER`, `SANDBOX`, `DIRECTORY`, `LEDGER` and `BLOBS`;
  - the vars `SWARMD_COMMIT` and `SWARMD_BUILT_AT`;
  - `Uploaded swarmd-server`, then `Current Version ID: <V>`.
- **Record V.**
- **Why `--image`:** plain `node scripts/deploy.ts` builds the image with Docker. Here dockerd is not running, and once started the build fails at `npm install` with SELF_SIGNED_CERT_IN_CHAIN, because the build container does not trust the proxy's CA. The image inputs are unchanged since 1b6a8de, so pinning the live digest is exact.
- **If it fails:** run `npx wrangler deployments list --name swarmd-server | tail -8`.
  - If 096b6307 is still at 100%, nothing changed. Stop and report; the likeliest cause is the API token's write scope, which no read could verify.
  - Do not fall back to a plain deploy.

**Step 10. Check `/version`, then archive bt-check at once.** Between the end of step 9 and this archive, do not push, comment or open anything on AaronAbuUsama/swarmd. From the deploy until the archive, every event on that repository also reaches bt-check.

```bash
for i in $(seq 24); do curl -s $U/version | grep -q "\"commit\":\"$M\"" && break; sleep 5; done
curl -s -w '  HTTP %{http_code}\n' $U/version     # no token
cd /home/user/swarmd && npx swarmd ns archive bt-check; echo "exit $?"
npx swarmd version
```

**`/version` answers:**
- **Expected:** `{"commit":"<M>","builtAt":"2026-11-09T…","protocol":"1.0"}` with HTTP 200 and no token.
- **If it still answers 401 or 404 after 2 minutes, or names another commit:** roll back (section 10).

**`ns archive bt-check` answers:**
- **Expected:** `✓ bt-check archived: it takes no new work and drops out of listings (undo: swarmd ns unarchive bt-check)`, exit 0.
- **`✗ conflict: bt-check is archived, but bt-check/build wasn't told (…)` (exit 1):** the archive still stands. Routing reads the Directory's archive marker, not the manager. Run the command once more.
- **Anything else (forbidden, not_found, 500):** run `npx swarmd ns ls --archived`. If bt-check is not listed, roll back (section 10), because every AaronAbuUsama/swarmd event would otherwise be doubled into bt-check.

**`swarmd version` answers:**
- **Expected:**
  ```
  swarm: <M> · deployed <builtAt> · protocol 1.0
  cli: protocol 1.0
  ```

## 8. Smoke tests (GET only)

**Step 11. Status codes.** Every path should answer 200. A 500 on `/r/swarmd/*` or `/inbox` is a finding, not a rollback trigger (section 10).

```bash
cd /home/user/swarmd
for p in /me "/r/namespaces?limit=200" /r/swarmd/managers /r/swarmd/usage /inbox /r/swarmd/factory /r/swarmd/factory-build \
         /r/swarmd/factory/usage /r/swarmd/factory-build/tickets /r/swarmd/ops /r/swarmd/swarmd /r/capxul-test/managers \
         /namespaces/swarmd/secrets; do
  printf '%-36s ' "$p"; curl -s -o /dev/null -w '%{http_code}\n' -H "authorization: Bearer $SWARMD_TOKEN" "$U$p"; done
```

**Step 12. Answers.**

| Check | Expected | If not |
|---|---|---|
| `npx swarmd ns ls --json \| jq .total` | `35` (36 minus bt-check) | 36: bt-check is not archived; go back to step 10 |
| `npx swarmd read swarmd://swarmd/managers --json \| jq '{names:[.items[].name], broken}'` | `names` is `factory`, `factory-build`, `ops`, `swarmd`, and `broken` is `null` | `broken: [{manager: …factory-build, reason}]` with the other three answering is acceptable: give Aaron the reason. A 500 (1101) is the live-fix lane missing a case: copy the exception from `$S/tail.log` and report it. It is not a rollback, because the old Worker fails the same way |
| `npx swarmd read swarmd://swarmd/factory-build/tickets --json \| jq '[.items[].id]'` | `["T-1","T-3","T-4","T-6","T-7","T-8"]` (8 → 6; the empty T-2 and T-5 are gone) | Report it |
| `curl -s -H "authorization: Bearer $SWARMD_TOKEN" $U/inbox \| jq '[.items[] \| select(.id=="broken")]'` | `[]`, HTTP 200 | A `broken` notice: report its reason |
| `npx swarmd secrets ls --ns swarmd` | `swarmd's secrets come from Worker secrets`, then `  GITHUB_TOKEN → github.com (Basic under x-access-token) · the server's` | "Infisical": an `INFISICAL_*` secret is set that nobody expected; tell Aaron |
| `npx swarmd read swarmd://capxul-test/managers --json \| jq '[.items[] \| {name,state,queued}], .broken'` | `build` listening, queued 0; `eval-hooks` paused, queued 8; `null` | Report it |
| `npx swarmd secrets ls --ns capxul-test` | The same single `GITHUB_TOKEN` server row, from Worker secrets | Report it |
| `cd /home/user/infrastructure && node packages/swarm/src/main.ts --ns capxul-test status --json \| jq .data.server` | `reachable: true`, `version: "<M>"` (null today), `compatible: true` | Report it |
| `node packages/swarm/src/main.ts --ns capxul-test doctor --json \| jq '.data.checks[] \| {id,status,detail}'` | `server-version` pass, `swarmD <M>` (warn today); `secrets` no longer `server_feature_missing`; `server-shape`, `namespace`, `role`, `team`, `models` pass; `github-app` warn (unchanged) | `github-events` stays warn: its text is fixed in the Capxul CLI and is now out of date (follow-up for that lane, section 12) |

**Step 13. Events.**

- **Slack.** No repository script replays a signed Slack DM. The e2e suite signs its posts with its own test secret and skips that suite on a deployed swarm. `SLACK_SIGNING_SECRET` is only a Worker secret, not in this environment. Do not hand-craft one.
  - Ask Aaron to send the bot one DM after the deploy, or wait for real traffic.
  - In `$S/tail.log`, expect `POST …/connectors/slack/events - Ok` and an `ingress` log line with namespace `swarmd`.
- **GitHub.** The first event on AaronAbuUsama/swarmd after the archive should show `POST …/connectors/github/events - Ok`, with `ingress` lines for `swarmd` only and never `bt-check`. The STATUS PR in step 16 produces such an event.
- **Telegram:** nothing to check. No `TELEGRAM_*` secret is set.
- **Errors after about 10 minutes:**
  ```bash
  grep -cE "Exception Thrown|Exceeded|\(error\)" $S/tail.log
  grep -n "connectors/" $S/tail.log | tail
  ```
  Expect 0.

## 9. Post-deploy writes

**Step 14. bt-check.** Done in step 10.

**Step 15. Archive the 31 other leftovers.** Run them one after another; each wakes that namespace's managers once (about 166 manager Durable Objects in all). This also matters for safety: on every Slack, GitHub or Telegram event, `listening()` reads all 174 non-archived manager instances in one `Promise.all`, and a throw in any one fails the event. Archiving shrinks that to the 7 instances that matter.

```bash
cd /home/user/swarmd
for ns in e2e-mw4kwf83 e2e-mw4ky3aj e2e-mw4kyd3h e2e-mw4kyoax e2e-mw4kzvcw e2e-mw4l1722 e2e-mw4lny06 e2e-mw51pngl \
          e2e-mw54se84 e2e-mw55348d e2e-mw5561tl e2e-mw55aohw e2e-mw5be05v e2e-mw5bjasv e2e-mw5by2hi e2e-mw7e1y7o \
          e2e-mw85g05v e2e-mw87j5xz e2e-mw87jfi4 e2e-mw87mhzy e2e-mw87tcg5 e2e-mw87z8kh e2e-mw883xn0 e2e-mw886wvm \
          e2e-mw889m45 e2e-mw88c7i4 e2e-mw88evkj pack-2560 qs-check sbx-probe pi-uat; do
  out=$(npx swarmd ns archive "$ns" 2>&1); echo "$ns exit=$? $out" | tee -a $S/archive.log
done
npx swarmd ns ls                                   # exactly: main, swarmd, capxul-test, capxul (each "· admin")
npx swarmd ns ls --archived --json | jq .total     # 32
curl -s -o /dev/null -w '%{http_code}\n' -H "authorization: Bearer $SWARMD_TOKEN" $U/inbox   # 200
```

- **Expected for each namespace:** `✓ <ns> archived…`, exit 0.
- **Exit 1 with `✗ conflict: <ns> is archived, but <manager> wasn't told (…)`:** expected for old v1 setups that no longer validate (for example a removed model). The archive stands: the namespace is out of every listing and no outside event reaches it. Only that manager's `schedule` or `conditions` slots could still fire. Note them for Aaron and do not retry more than once.
- **Tickets that leave the inbox:** these wait on a person and drop out of the inbox once archived. They can still be answered or stopped.
  - qs-check T-6;
  - the five e2e-mw7e1y7o T-1 tickets.
- **Keep:** `swarmd`, `capxul`, `capxul-test`, and `main` (the empty bootstrap namespace; Aaron may archive it).
- **Do not:** delete any Worker secret now; unarchive anything; bind any secret.

**Step 16. Record the deploy in STATUS (a docs-only PR).** Do this after steps 10 to 15 pass.

1. Branch from main.
2. Update the rows that say "not deployed": 7a, 7b, 7c, Secret bindings and Events per namespace. Each should say "deployed 2026-11-09 as <V> (<M>)", plus what was checked live.
3. Update the "Deploy again" line: reuse the image with `--image` when `sandbox.Dockerfile` and `src/bin/env-server.ts` are unchanged, because the image build fails in cloud sessions (proxy CA).
4. Replace the needs-you bt-check line with "archived after the deploy; 32 leftovers archived".
5. Update "Last updated".
6. Fix `apps/docs/content/docs/how-to/deploy.md` "LedgerDO is planned": it has been live since migration v5.
7. Run `npm run check`, commit with no attribution lines, open the PR and merge it once `check` passes.

The PR's `opened` event is the GitHub routing check from step 13.

## 10. How to tell it went wrong, and the rollback

| Sign | Action |
|---|---|
| `deploy.ts` fails and 096b6307 is still at 100% | Nothing changed. No rollback; report it |
| `/version` is not 200 with commit `<M>` within 2 minutes of a successful upload | Roll back |
| A read that answers 200 today answers otherwise: `/me`, `/r/namespaces`, `/r/swarmd/ops`, `/r/swarmd/swarmd`, `/r/capxul-test/managers` | Roll back |
| `$S/tail.log` shows `Exception Thrown` or 500s on `/connectors/slack/events` or `/connectors/github/events` for real events (Slack switches an app's events off after sustained failures) | If the exception names a leftover namespace's manager (`listening` or `policy.apply`), archive that namespace first: archiving removes it from routing at once. If it persists, or names swarmd, roll back |
| bt-check cannot be archived (step 10) | Roll back |
| Only `/r/swarmd/managers`, `/r/swarmd/usage` or `/inbox` still answer 500 | Not a rollback: the old Worker fails the same way. Report the exception |
| Archives answer `conflict` | Not a rollback (step 15) |

**Rollback**

```bash
cd /home/user/swarmd/packages/server
npx wrangler rollback 096b6307-0a5a-4462-8c8d-36f0f4a99319 --name swarmd-server -m "back to main 1b6a8de: <reason>" -y
npx wrangler deployments list --name swarmd-server | tail -8      # 096b6307… at 100%
curl -s -o /dev/null -w '%{http_code}\n' https://swarmd-server.thedao.workers.dev/version   # 401 again: the old Worker
```

Both versions are at migration tag v5 with the same classes and bindings, so Cloudflare allows it. The rollback restores the image pin too, because the image is part of the version. If a secret changed in the meantime, wrangler asks, and `-y` accepts. Durable Object storage and R2 are not rolled back.

**After a rollback**

- **Data is safe.** Nothing is lost or left unreadable:
  - The filled ticket, trigger, decision, run and pair documents are the ordinary seed shape that main reads.
  - The `binding:*` and `archived:*` Directory keys are ignored by main.
  - The old golden snapshots are untouched.
- **What comes back:**
  - The 500s on `/r/swarmd/managers`, `/r/swarmd/usage` and `/inbox` return.
  - Archived namespaces reappear in listings.
  - Routing returns to `SLACK_NAMESPACE` and `GITHUB_NAMESPACE`, so bt-check again hears nothing.
- **What not to do:** do not unarchive anything. Do not revert main: fix forward in a new PR. After the next forward deploy, run `swarmd ns archive` again for any namespace whose setup was replaced in the meantime.
- **Leftover managers:** a manager that was pushed `archived` keeps that field. Under main, its own policy-edit tool fails until `swarmd up` pushes it a new setup. This only affects the leftover namespaces.
- **Record and report:** note the rollback in STATUS ("deployed and rolled back: <reason>") and tell Aaron. The docs site will still describe the new features.

## 11. What to tell Aaron

Fill in `<M>`, `<V>` and the archive results, then send:

> **swarmD deployed: PR #133 merged as <M>, Worker version <V> (rollback target 096b6307).**
>
> **Live now**
> - `GET /version` answers with no token and names <M>.
> - `/r/swarmd/managers`, `/usage` and `/inbox` answer 200 again (they gave 500 / 1101 since factory-build's empty T-2). factory-build's tickets list shows 6 records; the empty T-2 and T-5 are gone. <or: factory-build is reported as broken: <reason>>.
> - Secrets resolve only through bindings. The only one in use is the server default `GITHUB_TOKEN` for github.com, and the store is Worker secrets (no Infisical yet).
> - Each Slack, GitHub and Telegram event now goes to the namespaces whose sources hear it.
>
> **Archived**
> - bt-check, the leftover build-team check that named AaronAbuUsama/swarmd, was archived right after the deploy, so swarmd's GitHub events are not doubled.
> - 31 other leftovers were archived: 27 e2e-*, pack-2560, qs-check, sbx-probe and pi-uat. <list any that answered conflict>
> - Left: main, swarmd, capxul, capxul-test. Archived namespaces keep their records, and `swarmd ns unarchive <ns>` undoes it.
>
> **Expect**
> - The first sandbox per worker spec rebuilds its golden cold, about 8 minutes, because the golden key now includes the namespace. This covers swarmd's workers and runner, and the first ticket in capxul and in capxul-test.
> - GitHub events for repositories no namespace names are now dropped with a log line.
>
> **Needs you**
> 1. **K-29 / P-2** (PR #127) has been stuck in gating since 08:57Z: the previous deploy reset its gate, and T-3/T-4 still show working. This deploy does not unstick it. Drop it (`swarmd act drop swarmd://swarmd/tasks/K-29 --args '{"reason":"…"}'`) or re-run it?
> 2. **M-7:** P-3 / K-32 stalled because its maker never opened. Decide or drop.
> 3. **T-8 / K-14** has been idle since its 11-06 'ready' report. Keep it or drop it.
> 4. **The old routing secrets:** `SLACK_NAMESPACE` and `GITHUB_NAMESPACE` are no longer read but are kept for a rollback. OK to delete them once you accept this deploy? Each delete is its own Worker version.
> 5. **Infisical:** a universal-auth identity. Set `INFISICAL_CLIENT_SECRET` and `INFISICAL_PROJECT_ID` first and `INFISICAL_CLIENT_ID` last: each `secret put` deploys, and a CLIENT_ID alone makes every non-default binding fail.
> 6. **DOC-16:** should sources become a boundary between namespaces? Today any maintainer can hear any channel or repository the shared bot reaches.
> 7. **The GitHub App on Xelmar-tech**, a token per installation (#120 follow-up).
> 8. **A DM to the bot:** send one so I can see a Slack event reach swarmd end to end. There is no signed replay script, and I don't hold the signing secret.
> 9. **The sandbox image can't be rebuilt from a cloud session** (the proxy's CA breaks `npm install` in the build). This deploy reused the live image. A change to the image needs a Dockerfile or deploy.ts change, or a deploy from your machine.

## 12. Follow-ups (not blocking; put them in the STATUS PR or as issues)

**swarmD**

- **`Directory.listening`** (`directory/internal/listening.ts`): one `Promise.all` with no catch. One throwing manager of any namespace gives a 500 for every event. Apply the "read each manager apart" rule from `control/internal/fanout.ts`.
- **`delivered()` in `main.ts`** answers 500 for the whole event when one manager of one namespace throws on submit. With fan-out to several namespaces, one broken manager makes Slack and Telegram redeliver to all, and the 500s count toward Slack disabling events.
- **Redirects:** pin `redirect: 'manual'` in the MCP client fetch (`mcp/internal/client.ts:64`) and in `egressFetch`, so the bound key cannot follow a redirect to a host the binding doesn't list.
- **Archived namespaces:**
  - `run_evals`, `merge` and `deploy` are not refused there. They act on open work, so this may be right; decide it and document it.
  - The docs don't say that bind and unbind still work while a namespace is archived.
- **Secret resolution:**
  - An Infisical 404 (a wrong project id or a missing folder) reads as an empty folder, so the error is `missing_secret`.
  - If the Directory can't be reached during `secrets.resolve`, egress throws (a 500 to the sandbox) instead of answering a 502 value.
  - The ledger runner's namespace comes from `ctx.id.name`, and it now also picks the runner's bindings. If `ctx.id.name` were undefined, the runner would use namespace `ledger`.
- **e2e suite:** it should archive its own namespace; STATUS 7c already lists this. Local e2e namespaces also pile up across `wrangler dev` runs.

**Capxul CLI lane** (`Xelmar-tech/infrastructure`, `packages/swarm`)

- **`ns archive` won't work against this deploy.** It sends `POST /namespaces/<ns>/archive` and waits for `/version` to list `features: ["namespace-archive"]`. swarmD serves `PUT /namespaces/<ns>/archive`, and `/version` is `{commit, builtAt, protocol}` with no features list, so the command will always answer `server_feature_missing`.
- **`doctor`'s `github-events` check** is a fixed warning about `GITHUB_NAMESPACE` and is now out of date.
- **The pin** is 2c46d82; move it to <M> with `pin build --commit <M>`.
