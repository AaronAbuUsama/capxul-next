# Decisions the thin line and the spike's move are waiting on (11 November 2026)

**On the Questions page since 11 November 2026, 23:00 UTC** as decision records in `blueprint/shared/questions.ts`:
1 is `thin-line.bundler`, 2 is `books.founder-funding`, 3 was `devnet.core-service-home` (withdrawn unanswered on 12 November and replaced by `system.one-storage-design`), 4 is `devnet.cli-split`,
5 is `devnet.record-home`. Answer there; this note keeps the reasoning.

Written by the cloud thread on branch `claude/project-thread-mwv0z6` (PR #2) while binding the thin line's twelve tests
(`evals/thin-line.md`) and moving the spike into packages. Nothing here is decided or applied: each item is a question
for Aaron with the options and one recommendation. Where the blueprint already decides something, it is cited, not
asked again.

Thin line today: 10 of 12 primary tests are bound and pass (rows 1 to 5 and 8 to 12). The other two, rows 6 and 7,
are waiting on decisions 1 and 2 below.

## 1. Does the thin line's payment go through a real bundler? (row 6, `acc:payment.send/1`)

**The conflict.** Row 6 of `evals/thin-line.md` requires "exactly one real v4 UserOperation". Decision `devnet.lean-world`
(`blueprint/devnet/world-evidence.ts`) says simulated worlds run with no bundler, and keeps one real bundler world as a
canary. Today the payer's key sends `Budgets.spend` directly, so the money moves through the real contracts but not
through the EntryPoint.

| Option | What happens |
|---|---|
| **A. The thin line runs in the canary world** (recommended) | The devnet gets alto behind the mock paymaster (component `bundler-paymaster`), used by the thin line's world only. Row 6 stays as written. Cost: the bundler in `packages/devnet`, and its image must be reachable from where the worlds run. |
| B. Key-signed is enough in simulated worlds | Row 6 drops "UserOperation" and accepts the key-signed `Budgets.spend` plus `PaymentSent`. Cheap, but the EntryPoint path where money moves is not proven until staging. |
| C. A bundler in every world | Row 6 as written everywhere, against the lean world's cost (about 0.6 GiB a world instead of 0.15). |

**Why A:** it keeps the money path real on the one line that proves the product, and it matches the canary the
lean-world decision already planned.

## 2. How does the money that funds a Safe enter its books? (row 7, `acc:report.run/1`)

**The gap.** The claim is "the books agree with the chain": the General Ledger total for the Safe account equals the
Safe's balance on chain. A test company's Safe is funded by a transfer in that the books never see, so the two always
differ by the funding. Decision `books.party-lines` (current scope) says an unknown counterparty's row "remains
unmatched and visible" and archives the 6999 waiting account. So there is no rule today that books a transfer in from
outside.

| Option | What happens |
|---|---|
| **A. Funding at birth is the founder's capital** (recommended) | The transfer that funds a new company's Safe is booked as the founder's capital contribution: a Journal Entry that debits the Safe account and credits share capital, with the founder as the party. Any other unknown inflow stays unmatched, as `books.party-lines` says. |
| B. Every inflow posts, unknown ones to a visible waiting account | The books always match the chain. This reverses the archiving of 6999. |
| C. Compare only what the books know | The check excludes unmatched rows and shows them beside the total. This redefines "agree". |

**Why A:** it is how a founder's first deposit is really booked, it keeps `books.party-lines` as it is, and it makes
the claim true without a suspense account.

## 3. Where does the spike's Core service go? (`m2-graduate-spike`)

**The gap.** The blueprint has two homes, and the spike's Core fits neither as it stands:

- Component `backend`: one Effect 4 service on Postgres, with durable workflows (`blueprint/shared/foundation.ts`).
- Decision `devnet.lean-world`: one small service per simulated world, with one SQLite file, the chain reader folded in.

The spike's Core is JSON files and a hand-made outbox. It is the lean service's ancestor, but no package is named
for the lean service.

| Option | What happens |
|---|---|
| **A. The lean service is built in `packages/devnet`, with the spike as its reference** (recommended) | Rebuilt slice by slice on SQLite, each slice bound to the checks that already pass on the spike. The staging backend (`packages/backend`) is built separately when staging is on the path. |
| B. One codebase, two storage profiles | `packages/backend` is the lean service too, running on SQLite in worlds and Postgres in staging. One service to build, but the Effect/Postgres design has to bend to fit. |
| C. Move the stub as is, then convert | The stub moves into `packages/devnet` unchanged and is converted to SQLite afterwards. This is the fastest move, but it carries the JSON-file design into a package. |

**Why A:** the lean world is what the thin line runs on, and building it on SQLite from the start avoids porting a
store twice. The checks that pass on the spike become its acceptance.

## 4. Where does the spike's CLI go?

**The gap.** Component `cli` says each `capxul` command calls exactly one Core SDK method and holds no orchestration
(A4). The spike's CLI calls the chain, the Frappe scripts and Core directly. About half of its commands (`world`,
`world clock`, `world snapshot`, `record`) belong to the devnet supervisor, not to the product.

| Option | What happens |
|---|---|
| **A. Split it** (recommended) | The world, clock, snapshot and record commands become the devnet's CLI in `packages/devnet`. The product commands (`org`, `hat`, `doc`, `approval`) move to `packages/cli` one at a time, as their Core SDK methods exist. |
| B. Move it whole now | All of it goes into `packages/cli` and is refactored through the SDK later. This breaks A4 until then. |
| C. Leave it in the spike | Nothing moves until the SDK has every method the thin line uses. |

## 5. Where does the record live?

**The gap.** Decision `devnet.record-entry` (`blueprint/devnet/world-decisions.ts`) is refined by `devnet.record-readers` (`blueprint/devnet/world-evidence.ts`), which is open: "the file per world versus a
table is undecided (the book's table is the target, the file is the spike)".

| Option | What happens |
|---|---|
| **A. A table in the lean service's SQLite** (recommended) | It fits `devnet.lean-world`: a snapshot copies one database file, and the hash chain and redaction rules move unchanged. |
| B. Keep a JSONL file per world | As in the spike. Simple, but it is a second store beside the service's database. |

## Not a decision: the clock and the rest

- **The world clock** follows the service (decision 3): the site's half has already moved with `packages/frappe-app`,
  and `devnet.deterministic-worlds` already decides how eval worlds keep time.
- **Row 3, the Director proposal** (`acc:org.member.grant/1`) is done: the run's company is born with a second Director,
  a grant proposed with `hat grant --propose` waits until that Director approves (`org proposal approve`), and
  `org member get` reads the hat. Board actions without `--propose` still apply at once, every Director approving.
