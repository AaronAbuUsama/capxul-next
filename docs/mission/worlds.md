# Worlds: what they are, what the book has, how to make them cheap

Written 10 November 2026. Research and a proposal; nothing here was built or run against a service.

How to read the tags. **[B]** the book or code, with `file:line` (book paths are under `blueprint/`; `old:` is the old product's extracted copy). **[O]** the owner's words, 10 November. **[P]** my proposal. **[M]** something I measured today, read-only.

## 1. The words

| Word | What it means (owner, then book) | Where the book or spike means something else |
|---|---|---|
| **World** | [O] All companies connected to one chain, with one clock and one record. Not one company. | [B] `worlds.ts:4` and `worlds.ts:36`: a "world" is a **named snapshot** an eval starts from (139 of them). `foundation.ts:719` and `devnet/decisions.ts:1509`: `capxul-devnet world save`, `world grant` mean snapshot and access. Both are the owner's *snapshot*, not his world. [B] The environments (`foundation.ts:645`, `:809`; `time.ts:356`) are close to his meaning, but each is one stack, and the supervisor is one per machine (`decisions.ts:309`; `old: packages/devnet/README.md:21`: "singular", fixed ports). The spike never says "world": one chain at `127.0.0.1:8545`, one bench at `:8000`, sites named `<slug>.localhost` (`INTERFACE.md:26-33`). |
| **Company** | [B] An Organization: its on-chain part plus one hosted Frappe site (`rulings.ts:668`). | The spike's `org create` registers it on the one chain (`INTERFACE.md:119-125`); no world is named. |
| **Kind of world** | [O] devnet, simulated worlds, and (for contrast) the real one. | [B] devnet, shared world, staging (`time.ts:356`). "Shared world" means real people with grants; his simulated world is the same stack with agents as the players. |
| **Season** | [B] A time-boxed run of a shared world: start from a saved world, run at a rate, jump on a schedule, end in a reset (`decisions.ts:1627`). | Not in his words today. [P] Survives as an optional schedule on a world. Not first. |
| **Clock** | [B] One `now` for everything in the world: frozen or running, at a rate of 1 to 60 (`decisions.ts:1305`). | Spike has no clock work: `FINDINGS.md` says nothing about time. [M] |
| **Record** | [O] Everything that happens, also training data. | [B] Not in the book. Only `critical-path.md:26-33` and `cloud.md:49`. |
| **Snapshot** | [B] The whole world saved under a name (`flows.ts:426`, `:452`; `surface.ts:452-454`). | The book restores **in place only**. |
| **Template** | [P] A snapshot meant to be copied into new worlds. New word. | [B] `worlds.ts:36-42` already is one: `from` plus `steps`. |

## 2. What the book designs, and whether it still fits

`aaron.world-clock` (`rulings.ts:502`) ruled: a devnet, staging or shared world is self-contained, and **everything follows its one clock** (chain, backend, Ponder, mail, WhatsApp, the Frappe head, the FDE). A shared world may run faster than real time (four world hours per real hour). Chain-only was rejected. **Not ruled:** the 1-to-60 bound, `dev time set`, and that staging keeps the real clock. The book marks those "stands until he answers" (`decisions.ts:1305`, `time.ts:356`).

`aaron.seasons` (`rulings.ts:617`) ruled only: a shared world runs in seasons (start from a known world, rate, jumps, reset; players join). The real-time schedule, no overlap, eleven commands and the player grants are the book's own recommendation (`decisions.ts:1627`).

| Thing | Where | Fits now? |
|---|---|---|
| One clock authority, versioned protocol, followers, warp barrier | `decisions.ts:309`, `:500`, `:538` | **Yes.** It is the right shape. Its "backend Now layer" must be rewritten for the rebuilt service. |
| Rate 1 to 60, follow at a rate | `:1305`, `:1406` | **Yes**, bound unconfirmed. |
| Frozen mode, deterministic stepping, start-at | `:421`, `:582`, `:640` | **Yes.** This is how long histories run (section 5). |
| A Frappe site follows the world clock by app hooks, no fork | `:1448` | **Yes, and now central.** Every company is a real site. Unproven: the spike has no clock test, and the design read Frappe from 8 November. |
| Stand-in Frappe head, stand-in tables | `devnet/data.ts:183` | **No.** Real sites replace it. |
| Snapshot save/restore, stateful followers (site backup per snapshot) | `flows.ts:426-483`, `decisions.ts:1823` | **Mostly.** Anticipates sites as followers. Says nothing on a separate world. |
| Eval world catalog (`from`, `steps`, build order) | `worlds.ts:111`, `:2000` | **Mechanism yes, steps stale** (old CLI, waitlist, OpenFort onboarding). |
| Mail sink, scripted gates and prices, channels stay in the world | `decisions.ts:145`, `:228`, `:253`; `time.ts:395` | **Yes.** |
| Shared world: grants, gateway | `decisions.ts:1509`, `:1681` | **Partly.** Gateway guards the service API, not a company's site URL. |
| Seasons | `decisions.ts:1627-1773` | Fits; defer. |
| Several worlds on one machine | none | **Gap.** |
| The record, world creation, templates, separate-world restore | none | **Gaps.** |

## 3. The kinds of world

| | Local devnet | Simulated: real speed | Simulated: faster | Simulated: stepped | Real world |
|---|---|---|---|---|---|
| Who is in it | One developer, one or two companies [O] | Agents and scripts running companies; people may watch [P] | Same | Same | Real people and companies |
| Chain | Anvil fork on the laptop | Anvil per world on the host [P] | Same | Same | Public chain |
| Time | Frozen or running, rate 1 to 60 | Running, rate 1 | Running, rate up to 60 [B] | Frozen; moves only by warp or step [B `:421`] | Real |
| Outside services | Stand-ins: mail sink, Bridge, WhatsApp, prices [B `time.ts:395`] | Same, per world | Same | Same | Real |
| Who can see it | That machine only | Anyone with a grant; any company's screens [P] | Same | Same | Its members |
| Recorded | Yes, optional upload [P] | Yes | Yes | Yes | Yes, with consent rules [P] |
| Snapshot/restore | Yes [B] | Yes [P] | Yes | Yes, cheapest | No |
| For | Building | Soaks, demos | Weeks in a day | Deterministic histories, evals, training | Customers |

## 4. What "creating a world" means

[P] The things that must come into being, in order:

1. A world id, a state folder, a port block, a bearer token. (Gap: today's devnet is singular.)
2. A chain instance (Anvil) with the contracts deployed. Deploying took 25 s in the old product (`critical-path.md`); a template skips it by loading saved chain state (`old: chain-state.ts:70`, `anvil_loadState`).
3. The service and its database, one per world.
4. The clock: mode and rate (`dev time set`), optionally start-at.
5. The record: first entry `born`, naming its parent.
6. Hostnames: `<company>.<world>.<zone>` under the wildcard route (`cloud.md`, proposal 2).
7. The stand-ins (mail sink, Bridge, prices) and the people and agent keys.
8. Then the companies: `org create`, each a site (143 s cold [M, `FINDINGS.md`]).

```bash
capxul world create town-1 --template town-of-four@m3 --clock frozen
capxul world create fast-1 --template empty --clock running --rate 20
capxul world list                      # name, kind, clock, rate, companies, epoch
capxul world show town-1               # companies and their URLs, parent snapshot, record head
capxul world clock town-1 warp 7d      # also: set --rate 4, freeze, resume
capxul world snapshot save town-1 month-3
capxul world snapshot restore town-1 month-3                      # in place, new epoch
capxul world snapshot restore town-1 month-3 --as town-2          # a separate world
capxul org create acme --world town-1
```

A **template** is a snapshot plus a manifest: chain state, one site backup per company, the people and keys, the clock's start, the stand-in scripts. [P] "A town of four companies at month three" is that, saved once. `world create --template` restores the chain, restores each site backup under the new hostname, and starts the clock. If the snapshot is missing, it is built from `from` plus `steps` (`worlds.ts:36-42`), as the eval worlds are today.

## 5. Populating a world

[M] I ran the old generators (offline, seeded). Each holds people, departments and budgets, a daily price series, a month-end answer key, expected books, and one row per business fact (date, kind, actor, counterparty, amount, the old Capxul action):

| Company | Facts | Via Capxul | Span |
|---|---|---|---|
| Bit Connect | 3,015 | 804 | Jan 2025 to Oct 2026 |
| Quillmesh | 6,275 | 4,683 | Jan 2025 to Oct 2026 |
| Kobina Ridge (mining) | 2,404 | about 1,930 | Jan 2025 to Oct 2026 |
| Tamu Orchards (farm) | 4,445 | 4,305 | Oct 2025 to Sep 2026 |

[P] To seed: an adapter turns each old action (`request issue`, `inbox pay`, `agreement collect`) into the new door's call (a Frappe invoice, a payment through the signer). Facts outside Capxul (bank, card, payroll, journal: 2,211 of Bit Connect's) go into the site through the same door, dated by the clock. After each month end, the site's books are checked against the answer key. Tamu starts nine months later than the others, so a town needs a per-company date shift. The old companies do not trade with each other today; that is optional later.

[P] Running forward: the old day loop `step(world, day, seed, decide)` (`old: bit-connect/rules.ts`, README) makes each day's outside facts; `decide` is the operator, and an agent can stand in. Agents then drive the companies through the CLI.

Time for 22 months (669 days):

| Clock | Wall time | Basis |
|---|---|---|
| Real speed | 22 months | arithmetic |
| Rate 4 | 167 days | arithmetic |
| Rate 60 (the ceiling) | 11 days | arithmetic |
| Frozen, scripted, about 1 s a command | Bit Connect 14 min, Quillmesh 78 min, Capxul rows only | [M] spike steps took 0.1 to 0.7 s; the 1 s is [P] |
| Frozen, agent decides, about 10 s a decision | 2 h and 13 h | [P] |

So "fast" worlds do days, not years. Years are frozen-and-stepped. Speed there means commands per minute, not clock rate.

## 6. The hard parts

**1. One clock for the chain and many sites.** Evidence: the book replaces `now_datetime`, which about 88 modules import by name, and rebinds a few direct host-clock reads; it rejects freezegun (`decisions.ts:1448`). The spike has no clock evidence. What follows: Frappe's Python dates, jobs, email, the chain's block time. What may not: database `NOW()`, Redis timeouts, session expiry, the browser's own "today" for a person watching [P, untested]. *Recommend:* make this the first spike (one site, set 1 January 2025, make an invoice, run the daily job, list every date that is real). Keep the fallback of one bench per world under libfaketime [P, untried].

**2. Several worlds at different speeds on one machine and bench.** Evidence: the supervisor, ports and `.localhost` names are singular (above). [B `:1448`] puts the world in each *site's* config, so one bench can serve sites of different worlds if the patch keys on the site. *Recommend:* one bench, one supervisor per world, a small registry.

**3. Worlds never see each other.** *Recommend:* a database, a chain, a sink and a secret per world (the spike has one shared secret, `INTERFACE.md:26-33`); hostnames carry the world; the service refuses a site not in its world. Write a cross-world test as an eval.

**4. Snapshot and restore as a separate world.** Rename: hostname of every site, `capxul_world` and secret in site config, sign-in redirect addresses, the org-to-site map, ports and token, mail addresses, database names, the record's world id. Keep the chain id and each site's encryption key. Grants stay outside (`decisions.ts:1509`). Backup and restore of a site is not yet measured. [P]

**5. The record as training data.** One entry holds [P]: world id, epoch, gap-free sequence, world time and real time with the clock's mode and rate; who (person or agent, hats worn, run id, model and policy version); surface; the command with arguments (redacted); the result or refusal code; what it returned; pointers (document name and hash, transaction hash, block); the cause (the entry or message that triggered it). Lineage: a world's `born` entry names (parent world, snapshot, sequence). An in-place restore appends `restore` and bumps the epoch; the abandoned branch stays, flagged. *Never record:* keys, seeds, grants, bearer or session tokens, sign-in codes, Frappe passwords, HMAC secrets, encryption keys; real customers' personal data without consent.

**6. Size** [estimates unless marked]. [M] The spike's idle bench: bench 363 MiB, MariaDB 424 MiB, Redis 22 MiB, four sites at about 60 MB each of database. Per world: chain, service, Postgres, supervisor, about 0.6 GiB. Per company: about 0.1 GiB working. A four-company world is about 1 GiB on a shared bench. On 16 GiB less 2 GiB system and 0.8 GiB shared, about 12 idle worlds; plan for 6 to 8 busy ones. A bench per world roughly doubles that cost. A snapshot is about 0.2 to 0.4 GiB.

## 7. What to decide

| # | Decision | Recommendation |
|---|---|---|
| 1 | Adopt the words: world = chain, companies, clock, record; eval "worlds" become templates | Yes |
| 2 | Keep the 1-to-60 rate ceiling; long histories by frozen stepping | Yes |
| 3 | Seasons: optional schedule on a world, later | Defer |
| 4 | One shared bench for all worlds, decided by the clock spike | Yes, with fallback |
| 5 | Separate-world restore keeps chain id, new Anvil | Yes |
| 6 | Record agent tool calls and replies always; hidden reasoning only by a run flag | Yes |
| 7 | A "viewer" grant that opens any company's site read-only in a world | Yes |
| 8 | First template: four old companies at month three, with date shifts | Yes |

**Build first, in this order** [P]: (a) the clock-follow spike and the record entry schema, in parallel; (b) the world registry and per-world supervisor with `world create --template empty`; (c) separate-world restore; (d) template from a snapshot; (e) the seed adapter for Bit Connect, months 1 to 3.
