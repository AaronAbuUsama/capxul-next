# Cloud cost audit: what runs, what it costs, what can go

Written 10 November 2026. The audit itself was read-only. Aaron then approved three cuts, which were made
the same day and are listed under "What was done". Nothing was committed or pushed.
The only other side effect was a `git fetch` in `/Users/abuusama/projects/hosting`, which updated its record
of the remote branches and touched no file.

## What was done, 10 November, on Aaron's word

| Action | Result (M) | Saves a month |
|---|---|---|
| Deleted the two stopped test machines `capxul-firecracker-poc` and `capxul-e2b-embed` | Both terminated at 12:32 UTC; their 512 GiB and 300 GiB disks are gone. No copy was kept | $71.46 (E) |
| Shrank the Capxul worker from `t3a.xlarge` (16 GiB) to `t3a.large` (8 GiB) | Memory in use beforehand was 3.8 GiB. Down from 12:32 to 12:34 UTC. Same addresses. All 11 containers came back; `capxul.com`, staging, Convex, the AA gateway, the preview and the indexer answer. Now 1.9 GiB used of 7.8. A disk snapshot was taken while it was stopped (`snap-09865ecdbf94029c4`) | $59.57 (E) |
| Deleted the Hermes machine | A final snapshot `hermes-deputy-final-20261110` was saved first. Machine gone at 12:37 UTC, with its daily automatic snapshots. The Mac tunnel agent `com.capxul.hermes-deputy-tunnel` is unloaded and disabled; its file is still in place | $24.00 (R) |

| Stopped the Paperclip app on the tools worker | Container stopped at 12:44 UTC, not deleted; its data is on disk. `paperclip.capxul.com` no longer answers; the other nine tool addresses answer. Frees about 0.9 GiB of memory. **Its PostgreSQL is still running**, because the nightly backup refuses to start without it (`backup.py`, line 94) | $0 |

**The rate is now $398.00 a month at list price, down from $553.03.**

### Live readings taken the same afternoon (M)

| Machine | Memory used / total | Disk used | Notes |
|---|---|---|---|
| Controller | 1.1 / 1.9 GiB | 85% | One container (the public proxy), plus OpenShip and the backup timers |
| Capxul worker | 1.9 / 7.8 GiB after the resize | 95% | 11 running containers, 15 stopped ones |
| Tools worker | 11.9 / 15.8 GiB after Paperclip stopped | 23% | 30 running containers |
| Paynest worker | 0.9 / 7.8 GiB | 15% | 4 running containers using 67 MiB between them, 12 stopped ones |
| Ponder machine | 2.0 / 7.7 GiB | 5% | Indexer 0.9 GiB, its PostgreSQL 3.0 GiB |
| Worlds host | not read | not read | New today; the main session's |

**Running on the tools worker and missing from the tables below** (not in the hosting repository):
`openship-mail` (1.5 GiB), `openship-mail-db` and `openship-webmail-hwenucom-webmail`, a mail server and
webmail for `hwenu.com`; `capxul-factory` (268 MiB) and `agent-vault-proxy`, both started 2 November. I do not
know who uses them.

Left for Aaron, because I cannot do them from here:
- Revoke the Google authorisation the Hermes bot held for `aaron@capxul.com` (Google account, third-party access).
- Deactivate the three Hermes bot accounts in Mattermost. Their tokens are in the snapshot.
- Remove `hermes-deputy` from the Tailscale machine list.

Not done: the Google connector is still running, and so is Paperclip's database.

Undo: the Capxul worker goes back to 16 GiB with one stop, type change and start. Hermes can be rebuilt from
its snapshot. The test machines cannot be brought back.

**Revised the same afternoon.** The AWS login on this Mac started working again, so the machine list, the
October bill, a week of processor readings and the backup bucket were read directly (list and get calls only;
two Cost Explorer queries cost $0.01 each). That found one running machine and two stopped ones the first
version missed, and showed the main nightly backup has not run since 29 October.

**Every figure carries a mark.** **(M)** measured today by a probe or AWS reading I ran. **(R)** read from the hosting
repository (`Xelmar-tech/hosting`, `origin/main` at `2f9ca7a`, 29 October 2026) or from files on this Mac.
**(E)** estimated, with the basis given.

## The short answer

- **Seven machines were running this morning (M), not four.** Beyond the four in the repository: `hermes-deputy`,
  a machine that runs the Ponder indexer since 13 October, and the worlds host created today.
- **Two large test machines were stopped but their disks still billed (M):** 812 GiB, about $71 a month (E).
- **This morning: $553.03 a month at list price** = $481.57 for the seven machines (R) + $71.46 for those
  disks (E), plus about $10 to $25 (E) for snapshots and backup storage.
- **Now: $398.00 a month (E), six machines.** The three cuts Aaron approved are made: a saving of $155.03, 28%.
- **You are paying no cash yet.** October's usage was $402.38 and AWS credits covered all of it (M). I could
  not see how much credit is left; every saving makes it last longer.
- **A further $165 (E)** goes when the old Capxul staging system is retired: the Capxul worker ($80.82) and
  the Ponder machine ($84) together. Neither can go alone before that.
- **LiteLLM stays and the CRM stays,** so the tools worker stays at 16 GiB. The $40 I proposed there is
  withdrawn.

## Aaron's decisions, 10 November (after the first version of this report)

| Decision | Effect on this report |
|---|---|
| **Keep the Paynest worker** | Its verdict changes from switch off to keep. The $44 stays |
| **The Hermes machine can go** | Verdict changes from keep to switch off. Saves $24 |
| **Paperclip can go** | Verdict: switch off |
| ~~LiteLLM can probably go; keep CLIProxy~~ | Replaced by the last row |
| **Keep the CRM (Twenty) for now** | Verdict: keep. It stays on the tools worker, which makes the 8 GiB rebuild tighter |
| **Keep LiteLLM as it is** (relayed by the main session: "just keep it working as it is right now for now. We're not going to upset the apple cart for now.") | Verdict: keep LiteLLM, CLIProxyAPI, Headroom and their PostgreSQL. The main build's agents now reach models through `llm.capxul.com` (main session). The tools worker stays at 16 GiB and the $40 saving is withdrawn |

Nothing has been switched off yet.

## What I could and could not use

| Source | Result |
|---|---|
| Hosting repository | Read in full at `origin/main`, plus the unmerged branches and three local checkouts. |
| OpenShip connector | **Saw nothing.** The workspace is "Capxul" and the role is "restricted"; every read of a project or deployment returned "not found". |
| AWS command line | Expired in the morning; **working in the afternoon**, signed in as the account's root user. Read: machines, disks, snapshots, stacks, buckets, October's bill, a week of processor use. **Not readable this way: memory** (only the controller accepts remote commands; the Lightsail machines do not). |
| Public probes (M) | DNS and HTTPS for 30 hostnames, four health endpoints, GitHub run history, and this Mac's Tailscale status. |

So "is it in use" below rests on: does it answer, when was it last deployed, did GitHub touch it recently, and
what the repository says depends on it, and, since the afternoon, processor use over the last week. I have
**no memory reading newer than 2 October**.

## Every machine and every service

Verdicts: **keep**, **shrink**, **merge** (move onto another machine), **switch off**.
Every hostname resolves to the front door because of a wildcard DNS record, so "resolves" proves nothing; the
HTTPS answer is the evidence.

### 1. Controller (front door) — EC2 `t3a.small`, 2 GiB, 30 GiB disk — $21.18 a month (R)

| # | Service | What it is for | Evidence of use | Verdict |
|---|---|---|---|---|
| 1 | Public proxy (`capxul-ingress`, Traefik) | Receives all `capxul.com` traffic and passes it to the right machine | Every hostname below answered through it today (M) | **Keep** |
| 2 | OpenShip control plane | Tracks which container serves which hostname; runs deploys | `openship.capxul.com` answers with a sign-in redirect (M); web deploy ran through it 4 Nov (M) | **Keep** |
| 3 | Nightly backup timer and deploy scripts | Copies databases and files to S3; receives deploy commands from GitHub | Scripts in repo (R). **The nightly backup last succeeded on 29 October** (M); see Risks | **Keep, and repair the backup** |

Machine verdict: **keep.** It is the cheapest machine and everything depends on it.

### 2. Capxul worker — EC2, 200 GiB disk — was `t3a.xlarge`, 16 GiB, $140.39 (R); now `t3a.large`, 2 vCPU, 8 GiB, $80.82 (E)

This is the old Capxul product's staging system, the one the Frappe rebuild replaces.

| # | Service | What it is for | Evidence of use | Verdict |
|---|---|---|---|---|
| 4 | Convex backend and its site proxy | The old product's staging database and API | `convex.staging.capxul.com/version` answers 200 (M) | Keep until staging is retired |
| 5 | PostgreSQL (three databases) | Storage for Convex and the indexer | Private; in the nightly backup (R) | Keep with #4 |
| 6 | Capxul MCP | The old product's agent endpoint | `mcp.staging.capxul.com` answers (404 at root, as documented) (M) | Keep with #4 |
| 7 | Ponder indexer and its metrics collector | Reads the test chain into a database | **Not on this machine any more** (M): no Ponder container runs here. `indexer.capxul.com` has routed to the Ponder machine (#29) since 13 October (M). Health 200, but its last indexed block was 19 hours old at my morning probe (M) | See #29 |
| 8 | AA gateway | Sends and sponsors test-chain transactions | `/health` reports healthy, paymaster funded (M) | Keep with #4 |
| 9 | Staging web (`app.staging.capxul.com`) | The old web app, staging copy | Answers 200 (M); last deployed 4 Nov (M); a teammate opened a pull request against it today (M) | Keep until staging is retired |
| 10 | Pull-request previews | One web container per open pull request | 4 pull requests open; `pr-1227` preview answers 200, the other three do not (M) | Keep with #9 |
| 11 | Marketing site (`capxul.com`, `www`) | The public website | Answers 200 (M); last deployed 2 Nov (M) | **Keep, and move it before this machine ever goes** |
| 12 | Storybook | Password-protected component catalogue | Answers 401 as designed (M); rebuilt today (M) | Keep with #9 |
| 13 | Worker proxy (`openship-edge`) | Routes inside the machine, holds certificates | Required by everything above (R) | Keep |

Stopped on this machine, taking disk only (R): the Convex dashboard, the reserved production web
(`app.capxul.com` has no certificate (M)), and cold copies of the tools that moved off on 1 October.

Machine verdict: **shrunk on 10 November; switch off when old staging is retired.**
Its disk is 95% full: 183 of 193 GiB used (M). The stopped tool copies from 1 October are part of that.
Twelve tool containers left this machine on 1–2 October and its size was never reduced (R). A full copy of this
stack, run twice over, used 4.9 GiB in the 10 October pilot (R, one sample). So 8 GiB should hold it (E).
Moving to `t3a.large` (2 vCPU, 8 GiB) costs $80.82 (E, same price basis as the repository's figure) and
**saves $59.57 a month**.
Processor use, 3–10 November (M): 7–10% on average across the four processors, with five-minute peaks of
45–83%, and a full credit balance all week. Two processors carry the average easily; the peaks (deploys)
will run slower. The indexer, which used to take most of this machine's processor (R, CAP-381), no longer
runs here.

### 3. Tools worker — Lightsail, 4 CPU, 16 GiB, 320 GB — $84 a month (R)

| # | Service | What it is for | Evidence of use | Verdict |
|---|---|---|---|---|
| 14 | Twenty CRM (`crm`) | Customer records | Answers 200 (M). One workspace on 2 Oct (R) | **Keep for now** (Aaron) |
| 15 | Paperclip (`paperclip`) | Agent-company tool, with its own database and Codex login | Answers 200 (M). Not used (Aaron). Nothing else calls it (R) | **Switch off** (Aaron) |
| 16 | Mira (`code-review`) | Reviews pull requests | Reviewed a pull request today (M) | **Keep** |
| 17 | LLM gateway: LiteLLM, CLIProxyAPI, Headroom, PostgreSQL (`llm`, `cliproxy`) | Routes AI model calls | Both answer 200 (M). Mira calls LiteLLM (R); the main build's agents call LiteLLM (main session); Hermes and Mattermost's AI plugin call CLIProxy (R) | **Keep all four** (Aaron) |
| 18 | Vaultwarden (`vault`) | Team password vault | Answers 200 (M). Holds hosting credentials (R) | **Keep** |
| 19 | Coneshare (`dataroom`): web, two workers, PostgreSQL, Redis | Investor data room | Answers 200 (M). On 2 Oct it held one test document and no real ones (R). Recommended 4 GB by its maker (R) | Switch off if still empty |
| 20 | Infisical (`secrets`): backend, PostgreSQL, Redis | Holds Capxul's secret values | Answers 200 (M). GitHub release and test workflows read from it; a new identity was added 29 Oct (R) | **Keep** |
| 21 | Mattermost (`chat`): app, PostgreSQL, local AI container | Team chat | Answers 200 (M). Its own backup succeeded every day from 29 Oct to 9 Nov (M). Hermes bots live in it (R) | **Keep** |
| 22 | Google Workspace connector (`google-mcp`) | Lets agents read Google mail and calendar | Answers 200 (M). Its only caller I found is the private Hermes bot (R). Its definition is only on an unmerged branch (R) | **Switch off with Hermes**, unless something else uses it |
| 23 | Worker proxy (`openship-edge`) | Routes inside the machine | Required by everything above (R) | Keep |

Machine verdict: **keep at 16 GiB.** The earlier proposal to rebuild it at 8 GiB is withdrawn.
Going: Paperclip (2 containers) and the Google connector. Staying: Twenty (#14) and the whole LLM gateway
(#17), both Aaron's decisions. Still open: the data room (#19).
Why 8 GiB no longer works: memory in use was about 6 GiB on 2 October (R), before Infisical, Mattermost and
the Google connector were added, and little now leaves. The 8 GiB size also has two processors, and this
machine averaged 15–23% across four over the last week with peaks near 80% (M), which is 30–46% on two.
Switching a single tool off saves no money, because the machine is a fixed price.

### 4. Paynest worker — Lightsail, 2 CPU, 8 GiB, 160 GB — $44 a month (R)

| # | Service | What it is for | Evidence of use | Verdict |
|---|---|---|---|---|
| 24 | Paynest PostgreSQL | Meant to hold Paynest's data after a migration | A test restore found **zero tables** (R). The migration never happened (R) | **Keep** (Aaron) |
| 25 | Paynest Redis | Meant to hold Paynest's queues | The same restore found **zero keys** (R) | **Keep** (Aaron) |

Also on it, stopped (R): twelve tool containers kept as a way back from the 2 October move. The live copies
have run on the tools worker for five weeks with nightly backups.
No Paynest app was ever deployed here (R). The one app that ran, `base-stellar`, was crash-looping and was
removed on 2 October (R). `paynest.xyz` and `app.paynest.xyz` point elsewhere (M).

Machine verdict: **keep (Aaron's decision, 10 November).** My first recommendation was to switch it off,
because nothing reaches it and it holds no data. It has about 6.9 GiB of its 8 GiB free (R, 2 October).
The twelve stopped tool copies on it can be deleted to free disk; that saves no money.

### 5. Hermes deputy — Lightsail, 2 CPU, 4 GB, 80 GB — $24 a month (R)

| # | Service | What it is for | Evidence of use | Verdict |
|---|---|---|---|---|
| 26 | Team bot gateway (`@deputy`) | Shared assistant in Mattermost; weekday briefings | Machine is active on the tailnet now (M) | **Switch off** (Aaron) |
| 27 | Private bot gateway (`@deputy-private`, Personal Assistant) | Your own assistant, with your Google access; daily 08:30 briefing | Same machine, active (M) | **Switch off** (Aaron) |
| 28 | Two desktop gateways | Let the Mac app talk to both bots | Same machine (R) | **Switch off** (Aaron) |

Machine verdict: **switched off and deleted on 10 November (Aaron's decision). Saves $24 a month.**
It holds your Google authorisation and three Mattermost bot tokens, so those should be revoked, not just
deleted with the machine. A manual snapshot of it from 10 October already exists (M).

### 6. Ponder machine — Lightsail compute, 4 CPU, 8 GiB, 320 GB — $84 a month (M)

Not in the hosting repository. Found in AWS as `capxul-ponder-staging-ireland`, created 11 October.

| # | Service | What it is for | Evidence of use | Verdict |
|---|---|---|---|---|
| 29 | The Ponder indexer, its PostgreSQL and metrics collector | Old staging's indexer: reads the test chain so the app can list activity and settle payouts | **It is the live indexer** (M). The front door has sent `indexer.capxul.com` here since 13 October (`/etc/capxul/ingress/dynamic/cap381-indexer-cutover.yaml` on the controller), and the Capxul worker runs no Ponder. 1.7–4.7% processor, about 2 GB a day sent out (M). Its own backup ran today (M) | **Keep until old staging is retired** |

Machine verdict: **keep with old staging.**
An earlier version of this report called it an unused stand-by. That was wrong: I had read the Linear issue
CAP-381, which still says the public indexer has not moved. The route on the controller shows it has.
The "cutover" in its name is a separate, larger step that has not happened: CAP-278, "Execute the cut", the
old product's move to its V3 contracts with a wipe of staging. It is in the backlog, not started, untouched
since 14 October (M). This machine does not depend on it.
It cannot move back onto the Capxul worker cheaply: the indexer took most of that machine's processor when it
had four (R), and it now has two.

### 7. Worlds host — Lightsail, 4 CPU, 16 GiB, 320 GB — $84 a month (M)

| # | Service | What it is for | Evidence of use | Verdict |
|---|---|---|---|---|
| 30 | `worlds-host-ireland` (stack `capxul-worlds-host`) | Company sites for the Frappe rebuild | Created today 11:26 UTC, running, fixed address `34.249.131.57` (M). In use by the main build (main session) | **Keep** |

Machine verdict: **keep.** New today and approved. Its DNS zone `worlds.capxul.com` (stack
`capxul-worlds-dns`) costs about $0.50 a month (E).

### Stopped machines that still cost money (M) — both deleted on 10 November

| # | Machine | What it was for | State | Cost | Verdict |
|---|---|---|---|---|---|
| 31 | `capxul-firecracker-poc`, EC2 `r8i.4xlarge`, 512 GiB disk | A sandbox trial; tagged to expire 30 October | Stopped since 29 October | $45.06 a month for the disk (E) | **Deleted** (Aaron). Its stack `capxul-fc-20261028-093319` remains; it costs nothing |
| 32 | `capxul-e2b-embed`, EC2 `r8i.4xlarge`, 300 GiB disk | Tagged "agent-sandbox-test" | Stopped since 30 October | $26.40 a month for the disk (E) | **Deleted** (Aaron) |

A stopped EC2 machine costs nothing for its processor, but its disk bills in full: 812 GiB at $0.088 was
**$71.46 a month** (E).

### Other things that cost money

| Item | What it is | Likely cost (E) | Verdict |
|---|---|---|---|
| S3 backup bucket | Nightly backups plus seven Mattermost slots | $1.75 in October (M) | Keep |
| EBS snapshot, 200 GiB (M) | The Capxul worker's disk on 1 Oct | up to $10 | Delete: the 10 Nov snapshot replaces it |
| EBS snapshot, 200 GiB, 10 Nov (M) | The Capxul worker's disk, taken while stopped for the resize | a few dollars; only blocks changed since 1 Oct are billed while both exist | Keep while the nightly backup is broken |
| EBS snapshot, 100 GiB, and its machine image `capxul-machine-20261014-134154` (M) | A machine image from 14 Oct; I have not confirmed what it is for | up to $5 | Open |
| Lightsail snapshots of Hermes, 80 GB, 10 Oct and 10 Nov (M) | The deployment copy and the final copy | up to $4 | Keep the final one until you are sure Hermes is not coming back; the 10 Oct one can go |
| `capxul-devpod-pilot` stack | Results bucket, an 8 GiB machine image and an expiry function from the 10 Oct agent-worker pilot (M) | about $1 | Switch off if the pilot is over |
| Paynest asset bucket | Empty S3 bucket for a migration that did not happen | under $1 | Leave |
| Public IP addresses | Included in the machine prices above; $7.51 in October (M) | — | — |

### October's bill (M)

| Line | Usage |
|---|---|
| Lightsail | $195.95 |
| EC2 machines | $156.02 |
| EC2 disks and snapshots | $41.15 |
| Public addresses | $7.51 |
| S3 | $1.75 |
| **Total usage** | **$402.38** |
| Credits applied | −$402.38 |
| **Paid** | **$0.00** |

October is lower than today's rate because the worlds host did not exist, the two test disks existed for two
days, and Hermes and the Ponder machine started mid-month.

## The totals

| | Monthly |
|---|---|
| Seven running machines at list price: 21.18 + 140.39 + 84 + 44 + 24 + 84 + 84 (R, M) | $481.57 |
| Disks of the two stopped test machines (E) | $71.46 |
| **This morning** | **$553.03** |
| Two stopped test machines deleted: done (E) | −$71.46 |
| Capxul worker shrunk to 8 GiB: done (E) | −$59.57 |
| Hermes machine deleted: done (R) | −$24.00 |
| **Now: six machines, 21.18 + 80.82 + 84 + 44 + 84 + 84 (E)** | **$398.00** |
| Later, when old staging is retired: Capxul worker and Ponder machine switched off (E) | −$164.82, leaving about $233 |

Withdrawn: the tools worker rebuilt at 8 GiB (−$40), because LiteLLM and the CRM stay.
The first version of this report said $313.57 today. It missed the Ponder machine ($84) and the test
disks ($71.46), and the worlds host ($84) did not exist yet.

## The largest savings, graded

| | A · Delete the two stopped test machines | B · Shrink Capxul worker | C · Switch off Hermes machine | D · Switch off Ponder machine |
|---|---|---|---|---|
| Saving a month | $71.46 (E) | $59.57 (E) | $24.00 (R) | $84.00 (M) |
| Ships the saving now | ✅ two deletes | ✅ one stop and start | ✅ one snapshot and delete | ❌ it is the live indexer |
| Reversible | ❌ the disks are gone | ✅ same step back | ✅ restore from the snapshot | ⚠️ rebuild from its backup |
| Blast radius | ✅ nothing reached them; stopped for 11 days | ⚠️ `capxul.com` and staging were down 2 minutes | ✅ three chat bots and two briefings stop | ❌ old staging loses its indexer |
| Risk to data | ⚠️ the disks were not inspected | ✅ disk untouched, and snapshotted | ⚠️ bot history and Google tokens live in the snapshot | ✅ a rebuilt index; backed up nightly |
| Status | **Done 10 November** | **Done 10 November** | **Done 10 November** | **Not recommended** until old staging is retired |

## What breaks, and how to undo it

**C · Hermes machine off.**
Stops: the `@deputy`, `@deputy-private` and Personal Assistant bots in Mattermost, the 08:30 and 09:00
briefings, the 16:00 follow-up, and the two "Deputy · VPS" connections in the Mac app (R).
Lost unless snapshotted: bot conversation history, memory and the board-maintenance job.
Also do: revoke the Google authorisation for `aaron@capxul.com`, deactivate the three bot accounts, remove the
machine from Tailscale, and unload the Mac launch agent `com.capxul.hermes-deputy-tunnel`, which will
otherwise retry forever (R).
Do it by snapshot then delete. **Stopping a Lightsail machine does not stop the bill.**
Undo: create a machine from the snapshot (about $1–2 a month to keep (E)) and re-authorise Google.

**Paperclip off.**
Stops: `paperclip.capxul.com` and its agents. Nothing else calls it (R).
The nightly backup script requires Paperclip's database and **will fail** until Paperclip is removed from its
list (`deploy/openship/backup.py`, lines 94 and 135) (R). That backup is already not running (see Risks).
Undo: start the two containers again; the data stays on disk.

**A · The two stopped test machines deleted.**
Breaks: nothing running. Both have been stopped since 29 and 30 October (M).
Lost: whatever is on the 512 GiB and 300 GiB disks. I have not looked inside them.
Undo: none, unless a snapshot is taken first (about $0.05 a GiB a month for the part actually used (E)).
Also remove: the stack `capxul-fc-20261028-093319` and the machine image `capxul-machine-20261014-134154`.

**D · Ponder machine off (not recommended now).**
Breaks: `indexer.capxul.com`, and with it old staging's activity lists and anything that settles from the
indexer. It is the only running copy (M).
Also do, when old staging is retired: stop its nightly backup timer `cap381-indexer-backup.timer`, remove the
route file on the controller, and remove the machine from OpenShip.
Undo: a new machine and a restore from its nightly backup.

**LiteLLM stays (Aaron).** Not switched off, and nothing it depends on. Kept here for the record is why it
could not simply have gone. Mira is set like this (`deploy/services/mira.compose.yaml:49`):

```yaml
llm:
  base_url: ${MIRA_LLM_BASE_URL:-https://llm.capxul.com/v1}
  api_key_env: LITELLM_API_KEY
  model: gpt-6-astra
  indexing_model: gpt-5.6-luna
```

The main build's agents now use the same address (main session). Removing LiteLLM would stop both.

**Google connector off.**
Stops: Google mail and calendar access for agents. The private Hermes bot is the only caller I found (R).
Undo: start it again; the Google authorisation would need renewing.

**B · Capxul worker to 8 GiB.**
Breaks: `capxul.com`, staging, previews and Storybook are down for 3–5 minutes while the machine restarts.
Risk: half the processors. Average use is 7–10% of four (M), so the average fits; peaks of 45–83% (M) would
run slower, and backend installs already need the indexer stopped first (R, CAP-381).
Undo: the same step in reverse, another 3–5 minutes.

**Data room off (if you choose).**
Any data-room link stops working. Saves no money by itself. Undo: start it again.

**Later · Capxul worker off entirely.**
Breaks: the whole old staging system and every preview. The marketing site must move to the tools worker
first, or `capxul.com` goes dark. Undo: the machine is kept by CloudFormation on deletion and has a full
snapshot.

## What I could not see, and what would let me

| Could not see | Access that would show it |
|---|---|
| How much AWS credit is left and when it expires | The Billing page of the AWS console, under Credits; the command line does not show it |
| Memory in use on each machine and per container | A read-only command on each machine. Only the controller accepts remote commands from AWS; the others need SSH through the controller, which I have not done |
| What is on the two stopped test machines' disks | Starting them (about $1 an hour each) or your memory of the trials |
| When each service last received a request | Reading the proxy's access log on the controller |
| Anything in OpenShip | A read role on the Capxul workspace for the connector in this session |
| Whether you or the team use the data room | Only you know |
| Why the nightly backup stopped on 29 October | The backup job's log on the controller |
| Whether the agent-worker controller container still runs on the Capxul worker | OpenShip read access |
| Whether the old Railway projects (`adorable-illumination`, `personal-llm-gateway`, `mira`) were deleted and stopped billing | A Railway login; the command line here is logged out |
| What writes the `mail-backups` folder on the tools worker | A look on that machine |

## Risks noticed in passing

0. **The main nightly backup has not run since 29 October** (M). The bucket holds 14 nightly folders from the
   last 30 days, with gaps, and none after `2026-10-29T03-29-42Z`. So the password vault, the secrets store,
   the CRM, LiteLLM's database and the staging databases have had no backup for 12 days. Mattermost and the
   Ponder machine have their own backups, and both ran today (M). This matters more than any saving in this
   report.
   The job `capxul-hosting-backup.service` on the controller runs every night at about 03:18 UTC and has
   failed every night from 30 October to 10 November (M). It fails at the same step each time: copying
   `capxul-files.tar.gz` off the Capxul worker (`backup.py`, line 170). That machine's disk is 95% full (M)
   and it was restarted on 29 October (M); I have not confirmed which of the two is the cause. Because the
   job stops at that step, the tools worker's databases are not uploaded either.
1. **The four AWS alarms notify nobody** (R). The controller's low-credit alarm was already firing on
   21 September (R). The three Lightsail machines have no alarms defined at all (R).
2. **Nothing watches memory or disk** on any machine (R).
3. **The Hermes machine's definition is not in Git.** It exists only as uncommitted files in
   `/Users/abuusama/projects/hosting/deploy/hermes/` (R). Lose this Mac and the recipe is gone.
4. **Three live services have no definition on `main`:** the Google connector (ingress on an unmerged
   branch), Mattermost (only its route and backup are in the repository) and Twenty (its Compose file is an
   untracked file on this Mac) (R).
5. **The Google connector is not in any backup I could find** (R).
6. **The AWS login on this Mac is the account's root user** (M). It can do anything, including close the
   account. A separate sign-in with limited rights would be safer for everyday and agent use.
7. **Backups live in the same AWS account and region as the machines** (R). One compromised account loses
   both.
8. **The front door is a single small machine with no stand-by** (R). If it stops, everything stops.
9. **The indexer is 19 hours behind** while reporting healthy (M).
10. **The connector's OpenShip credential is not marked read-only** (M), even though its role sees nothing.
11. **Do not delete the CloudFormation stack `capxul-temporary-coolify`.** Despite the name it owns the
    controller, the Capxul worker and their network (R).
12. **Three machines have no definition in the hosting repository:** Hermes (now deleted), the Ponder machine and the
    two stopped test machines (M, R). Only Linear and tags say what they are.
13. **The test machines were tagged to expire and did not.** `capxul-firecracker-poc` carries an expiry of
    30 October and an expiry function, yet it and its 512 GiB disk are still there (M).
14. **The Capxul worker's size now differs from its template.** The CloudFormation template in the hosting
    repository still says `t3a.xlarge` (R); the machine is `t3a.large` (M). The template should be changed
    to match, or the next person to read it will be misled.
15. **Linear issue CAP-381 is out of date.** It says the public indexer has not moved; it moved on
    13 October (M).
16. **Deploy workflows still say "Coolify"** in their names though they drive OpenShip (R, M). Harmless, but
    it will mislead the next reader.

## The local checkouts, as found (unchanged)

| Checkout | Branch | State |
|---|---|---|
| `/Users/abuusama/projects/hosting` | `codex/capxul-domain-migration`, last commit 22 Sep | 9 modified files (280 lines added), all from the Coolify period and overtaken by `main`. Untracked: `deploy/hermes/` (the only copy of a live machine's definition), Coolify-period Compose files for Twenty, Coneshare and Vaultwarden, and `deploy/backup/vaultwarden.py` |
| `/Users/abuusama/projects/hosting-ops` | `ops/controller-install-workflow` | Clean. Its work is on `main` |
| `/Users/abuusama/projects/hosting-preview-fix` | `fix/preview-controller-extend-origins` | Clean apart from a Python cache folder. Its work is on `main` |

Four more worktrees of the same repository exist on this Mac; three are marked prunable by Git.
