# Worlds as a hosted platform

Written 10 November 2026. This is the whole design in one place. The records behind it are in the design book (the Worlds page on the portal lists them). Nothing here has run on the hosted machine yet.

Every number is tagged **(measured)** or **(estimate)**. A measured number came from the walking skeleton on a laptop. An estimate is arithmetic or a guess, and the test that settles it is named in the book's decision `devnet.world-capacity`.

## Why

The owner asked for worlds as a hosted thing you connect to. They must be easy to make, easy to put people into, and cheap enough to run in the hundreds. Beta testers and agents will cycle through scenarios. The data they leave must be clean enough to train on. Reinforcement learning needs the same worlds as environments.

**His ruling on sign-in (10 November 2026, `aaron.sign-in-is-core`).** Signing in and signing transactions belong to Capxul Core. The obvious path is a pop-up that shows what is being signed, lets a person sign it and proves who they are. It is designed later and is on the critical path before people use a world's screens. For now the focus is the agent side. So this design is built for agents first. Everything for people is specified and marked **waiting on Core's sign-in**.

## The words

- **World.** One chain, every company on it, one clock, one record. Never one company.
- **Kind.** `local` (a laptop), `simulated` (the worlds machine), `staging`, `production`.
- **Profile.** `core` or `full`. Chosen when the world is made.
- **Company.** One organisation in a world. In a `full` world it also has a Frappe site.
- **Key.** What a person or agent signs with. One key, in every world.
- **Grant.** A key's right to be in a world: organiser, player or viewer.
- **Seat.** A role in a company that a person or agent plays, wearing a hat there.
- **Template.** A saved world that new worlds are copied from.
- **Scenario.** A template plus everything a run needs. A versioned file.
- **Run.** One world made from one scenario for a set of participants. A run is a world: it has the same id.
- **Cohort.** A group of participants moved through many runs.
- **Record.** The append-only log of everything that happens in a world.
- **Dataset.** A closed run's record, packaged and checked.

## What runs where

```
        you, an agent, a learner                   (one CLI, many worlds)
                    |  key-signed requests
                    v
   https://core-<world>.worlds.capxul.com        the world's service
        |  chain (one per world)   clock   record   stand-ins
        |                                              (mail, bank, prices)
        |  calls the site, never the reverse
        v
   https://<company>-<world>.worlds.capxul.com   each company's Frappe site
        |                                          (full profile only)
        v
   ONE shared Frappe bench + MariaDB + Redis     on the worlds machine
```

The worlds machine is one AWS Lightsail server: 4 CPUs, 16 GiB, 320 GB, $84 a month. One wildcard certificate covers every name. A new world needs no new DNS, route or certificate. A laptop's devnet runs only the Capxul part and uses this bench for its sites, or runs `core` alone with no network.

## Two profiles

| | `core` | `full` |
|---|---|---|
| Has | chain, lean service, record | the same, plus a Frappe site per company |
| For | money and authority, tests, most machine runs | business flows, anything a person looks at |
| Memory per active world | about 0.15 GiB (estimate) | about 0.15 GiB plus 0.1 GiB per busy company (estimate) |

A sandbox never carries its own bench. The bench alone is 0.85 GiB (measured), so it is shared.

```
capxul world create town --profile core --clock frozen
capxul world create town4 --profile full --template town-of-four@m3
```

## Making, parking, ending

```
capxul world list                    capxul world show town4
capxul world pause town4             # stopped in place, nothing lost
capxul world park town4              # storage only; sites backed up and dropped
capxul world resume town4            # or any call to its address wakes it
capxul world destroy town4           # the record stays
```

A parked world costs disk only. Waking a `full` world takes about 33 seconds per company (measured). Waking a `core` world takes seconds (estimate). The machine refuses a world it has no room for with `CAPACITY_REACHED`.

## Connecting

A **connection** is three things: the world's address, the caller's key, and a grant.

```
capxul world use r00042              # sign a challenge, check the grant, store the connection
capxul world current                 # which world, which key, which role, and why
capxul record list --world town      # a flag beats the variable CAPXUL_WORLD, which beats `world use`
```

The key is never stored in the connection, only a reference to it. A local devnet is a world whose address is on the laptop.

## Getting in

**Identity travels with the key.** Joining a world creates exactly this, and nothing else:

1. a grant (role, seat);
2. Capxul Core's account for the key's address in that world, with no email;
3. the key's Safe at an address that follows from the key and the world, so the same key has a different Safe in each world;
4. the consent record and a `join` entry in the record;
5. then the seat's hats and starting test funds, from the scenario, through the normal doors.

No balance, hat, session or membership comes from another world.

**If they already have keys, it is one command each.**

```
# organiser: make a link bound to that key
capxul world invite create r00042 --role player --seat bc-finance --key 0x70997970…
# participant: join
capxul world join capxul://join/r00042/Zq3-m8Vd1fT7 --consent train
```

An open link (no `--key`) works for its first few holders. Codes are shown once and stored as hashes. Links expire in 24 hours. `world grant revoke` ends a grant at once, on the service and on every company's address. A restore never re-admits a revoked key, because grants sit outside snapshots. A person with no key adds `--new-key`: a test key is made on their machine and a recovery phrase is shown once. It holds test money only.

**Agents first.** An agent joins the same way. **Waiting on Core's sign-in:** a person joining to play through the screens, and `world viewer link`. Until the pop-up exists, both are refused with `CAPABILITY_UNAVAILABLE`, and nothing is opened to the internet (the machine's firewall admits only the operator). A person's key and account in a world are the same as an agent's, and the signer is the one place a transaction is approved, so the pop-up changes how a signature is made, not the design.

## Scenarios

A scenario is what a world is made from and run under: the **template** (a snapshot, its companies, their sites' data), the **seats** (which are people, which agents, what each may read, the default agent policy), the **script** of outside events (customers, bank, suppliers, calendar, drawn from a seed), the **clock plan** (stepped, real speed or faster), **scoring** (the book's evals, plus measures with a direction and a weight) and **the end**. A version never changes.

Two worked examples, from the old product's scenario companies:

- `solo-bit-connect@1`. One company, one seat, one month. `core`. The cheapest place to learn the loop.
- `town-of-four@1`. Bit Connect, Quillmesh, Kobina Ridge and Tamu Orchards at month three. Four seats. `full`. Tamu starts nine months after the others, so it has a date shift. Scored on whether the books agree with the chain, whether any payment was unauthorised, and invoices collected.

The old generators produced 3,015, 6,275, 2,404 and 4,445 business facts for the four companies (measured). Each company's jurisdiction is a property of its template and is left open.

```
capxul scenario check --manifest scenarios/town-of-four.json
capxul scenario save  --manifest scenarios/town-of-four.json
```

## Cohorts and runs

For a hundred or two hundred participants an organiser plans a cohort:

```
capxul cohort create beta-1 --scenario town-of-four@1 --participants beta-1.csv \
   --per-run 4 --at-once 20 --start 2026-12-01T09:00Z --on-drop agent
capxul cohort show beta-1        # each run: state, seats filled, world time, entries, refusals
capxul run seat assign r00042 bc-director --agent --key 0x… --policy ledger-agent@1
```

The file holds keys, not names. The cohort makes the runs, binds each key to a seat and opens runs in waves, never more at once than the machine has room for. **A drop-out** is `run seat drop`. The scenario says what follows: an agent takes the seat and the record gets a `handover` entry, or the run pauses. A run then goes: `open`, `live`, `closed`, `accepted` or `rejected`, `archived`.

**How many at once** (all estimates, on 13 GiB usable): about 85 `core` worlds; about 20 `full` worlds of four companies; some hundreds parked. 200 participants at four seats is 50 runs: all at once on `core`, three waves on `full`. A second machine doubles every figure.

## Clean data

The record is the product of a run.

**The entry** is the record's own line (schema 1, from the spike): sequence and the hash of the previous line, trace id, the command and arguments, the actor and the hats read from the chain, world, company, site, world time and real time, duration, outcome and error, a result, and the transactions sent. Designed in, not yet built: run id, the agent's model and policy version, the surface, the cause. A real one:

```json
{"seq":851,"prev":"7933dedd…","command":"approval sign","actor":{"email":"marcus@acme.test","hats":["budget-holder"]},
 "world":"main","world_time":"2026-11-10T10:29:55Z","duration_ms":588,"outcome":"ok",
 "changes":{"tx":[{"hash":"0x8f215e1c…","fn":"send"}]}}
```

**The episode** is a run. Its **manifest** says what produced it: scenario and version and hash, template snapshot id, seed, clock plan, each seat's occupant (human or agent, a pseudonym, the agent's model and policy version, the consent version), software versions, lineage across restored worlds, start and end.

**One dataset** is one folder: `manifest.json`, `entries.jsonl`, `scores.jsonl` (the rewards), `checks.json`, `ledgers/`. Schema version `dataset/1`.

**Quality, before acceptance** (`run check`): the sequence has no gap and the hash chain verifies; the books agree with the chain; no secret is in the data, searched by value; the manifest is complete; the clock plan was kept; consent is complete; the lineage resolves. All pass, or the run is rejected (kept, marked, not used).

**Reproducible:** a scripted run on a stepped clock with seeded stand-ins and the template snapshot should replay to the same state (estimate: the double-run test settles it). **Not reproducible:** people, agent sampling, any run on a running clock, and the 86 places the site still reads the host's time (measured).

**People.** Testers are real people. Joining needs consent: `run` (recorded, for evaluation) or `train` (usable for training). The export uses a pseudonym and removes emails, phone numbers and, without `train`, free text. A dataset is training-ready only if every human seat chose `train`. `run redact` withdraws a participant. Never in any record or export: keys, seeds, tokens, codes, passwords, secrets. Today only secrets are redacted; personal data in results is not (specified, not built).

## As a reinforcement-learning environment

| Usual term | Here |
|---|---|
| reset | `env reset <scenario> --seed N` makes a run |
| step | `env step --command …`: one command through the door; `wait 1d` moves the clock |
| observation | what the command returned, plus what the seat may read |
| reward | the change in the scenario's weighted measures, as deltas |
| done | the scenario's end |
| info | the record entries the step produced, and any refusal code |

What it costs: a step is 0.1 to 0.7 seconds (measured). A `full` reset is 34 to 42 seconds for one company and 80 for four (measured). A ten-day advance is 33 to 41 seconds for four companies (measured); about a minute for six (the coordinator's figure). A `core` reset is 1 to 3 seconds from a 5.5 MB state (estimate). The whole machine does perhaps 10 to 30 steps a second (estimate), tens of thousands an hour.

So: many parallel `core` worlds to learn on money and authority. `full` worlds for evaluation and human runs, not millions of steps. **To go faster:** the lean service (an in-process EVM, indexer folded in, in-process signer; about ten times, estimate, needs the differential replay), a pool of warm worlds, batching a day's steps, more machines, and only if Frappe is the limit, the Capxul part as a Cloudflare Durable Object per world.

## Seeing it

People watch a `full` world through its Frappe screens. A viewer can read and never save. The link is minted for a key with a grant, expires in five minutes and works once. **This is waiting on Core's sign-in.** The spike's stand-in lets anyone become any test person, so nothing is opened to the internet before the real one exists.

## Staging and production

They are worlds, made by the same commands with `--kind`. They have a public chain, real time, real services, always the `full` profile, and no snapshot, clock, pause, scenario or env verbs. Creating or destroying production always needs the owner: `world approve` mints a single-use, 15-minute approval, which `world create` and `world destroy` take as `--owner-approval`.

## The journeys

1. **An organiser runs a cohort:** scenario check, save, cohort create, watch, handle drop-outs.
2. **An agent plays a seat:** invite, join, `world use`, work through the CLI, every command recorded.
3. **A tester with a key plays through the screens:** join, viewer link, sign in the pop-up. *Waiting on Core's sign-in.*
4. **A run closes:** close, check, export, accept, archive.
5. **A learner uses a `core` world:** reset, step, state, close.
6. **A world parks and wakes.**

## What is built, what is specified, what is neither

**Built (in the spike, on a laptop, with stand-in contracts):** several worlds side by side, each with its own chain, service, clock and record; the clock moving every site of a world; snapshot and restore in place and into a separate world; a company from a template; the record, with no secret in it; the signed door to each site.

**Specified (in the book, with examples and acceptance claims, none run):** everything in this document beyond that. All 38 new operations, the tables for grants, invitations, members, scenarios, runs, seats, cohorts and datasets, the two processes, six journeys and 17 decisions.

**Neither (nobody has run it, or nobody has designed it):**
- The hosted machine has a certificate and nothing else: no bench, no service, no world.
- The lean service. All capacity figures for it.
- Park and wake as a whole; the park-idle time.
- Real contracts under the worlds: the Safe address from key and world.
- Replay equality; the quality checks; the redaction of personal data.
- The scenario seed adapter and the script of outside events.
- People's sign-in and the signing pop-up: Core's to design, milestone not chosen.
- Whether a data-protection review is needed before the first human tester: the first jurisdiction is open.
