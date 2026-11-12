# The thin line: one company, one ordered run

Book: `journey:thin_line` in `blueprint/sites/thin-line.ts`; decision `sites.thin-line-tests`.
This is the g8 scenario, not a claim that the spike already proves g8.

## Run contract

Start from an empty **full simulated world** (never production), once on a laptop and once
on the sites machine. Use the same company, member, supplier, payment id and trace throughout.
Use funded test keys only, never a production key. Keep the world id in every command.
A hosted run must show the service and chain on the sites machine, not a tunnel to a laptop;
the company's hostname must answer there. Inspect the deployed v4 contract code, not only a
nonempty address. World creation is one command; company creation follows it.

The numbered rows below match the journey's steps exactly. Each row names **one primary test**:
an existing acceptance eval, with its whole claim unchanged. Extra end-to-end assertions in the
row belong to `jrn:thin_line`. A step is not passed merely because a command exits zero.
The primary test's current binding (or near-miss) is in the named JSON file. Near-misses never
score. `fun:thin_line` separately requires the proving outcomes once, in step order; the spike
does not inspect that funnel.

| # | Operation / primary test | Assertion for this run | Spike evidence / binding file |
|---|---|---|---|
| 1 | `world.create` / `acc:world.create/2` | Create the full world with a frozen clock; wait for running; read its clock, epoch and birth record. Check the hosted placement and v4 code as above. | Bound and passing (run-20261111182634): `TL.world-create-runs-frozen`, `TL.world-frozen-clock-holds`, `TL.world-record-begins-with-birth`; `thin-line.json`. |
| 2 | `org.create` / `acc:org.create/6` | The minted company Safe has the founder's personal Safe and predicted address. Wait for the company's site; its Company, Safe bank account and sign-in must agree with the chain. | Bound and passing (run-20261111182634): `B1.org-create`, `B1.safe-on-chain-is-the-sites-safe`, `B1.company-safe-minted-for-founder`, `B1.org-show-prints-the-safe`; `thin-line.json`. |
| 3 | `org.member.grant` / `acc:org.member.grant/1` | The Director proposal waits, a second Director approves, the member wears the hat and the change is applied. Its mapped roles reach the site. | Bound and passing (run-20261111182634): `TL.grant-proposal-waits-for-second-director`, `TL.grant-proposal-non-director-refused`, `TL.grant-proposal-applied-after-second-director`, `TL.grant-proposal-roles-reach-site`; `thin-line.json`. |
| 4 | `doc.create` / `acc:doc.create/1` | As the hat holder, create a supplier invoice and Safe Payment Entry through the door. Read both back as drafts; record their ids and document hash. Frappe validation still applies. | Bound and passing (run-20261111182634): `B6.created-document-is-draft`, `B7.closed-month-invoice-refused`; `sites.json`. |
| 5 | `doc.submit` / `acc:doc.submit/2` | Submit the Safe Payment Entry through the door. It waits, names its signer and approval, remains draft and posts no ledger rows before signing. | Bound and passing (run-20261111182634): `TL.doc-submit-safe-payment-held-signer-named`, `TL.held-payment-posts-no-ledger-line`, `TL.signed-payment-posts-once`; `sites.json`. |
| 6 | `payment.send` / `acc:payment.send/1` | Sign the held payment with the hat holder's test key. Exactly one real v4 UserOperation and PaymentSent carry its id; payment list reads settled. Supplier increases and Safe decreases by 125.50; the entry carries its transaction hash, posts once and the invoice has zero outstanding. | Near-miss, does not score: `B3.sign-sends-chain-transaction`, `B3.chain-moved-the-money`, `B3.payment-entry-submitted`, `B3.entry-carries-transaction-hash`, `B3.ledger-posted`, `B3.invoice-nothing-outstanding`; `thin-line.json`. Waits on a decision in `docs/mission/decisions-2026-11-11.md`. |
| 7 | `report.run` / `acc:report.run/1` | Run General Ledger and Trial Balance as the caller, and compare the Safe account and paid invoice with chain balances. | Bound: `B6.reports-run`, `TL.books-agree-with-chain`, `B6.off-part-report-refused`; `sites.json`. The funding at birth is booked as the founder's capital (`books.founder-funding`). |
| 8 | `world.clock.warp` / `acc:world.clock.warp/1` | Advance the world through the month. Every site and the chain agree; due jobs actually execute. Payments' blocks, ledger posting dates and reference dates follow world time. | Bound and passing (run-20261111182634): `TL.warp-moves-chain-and-every-site-a-week-on`, `TL.warp-ran-daily-job-once-each-day`, `TL.warp-backwards-refused`, `B7.clock-set-in-the-past-chain-and-sites-follow`, `B7.world-at-31-march-all-agree`; `devnet.json`. |
| 9 | `record.export` / `acc:record.export/1` | Export one readable file with lineage and every entry once. Follow the signing trace from command to transaction, ledger and timeline; no secrets in evidence. | Bound and passing (run-20261111182634): `TL.export-prints-lines-and-lineage`, `TL.export-lineage-first-then-every-entry-once-in-order`; `devnet.json`. |
| 10 | `world.snapshot.save` / `acc:world.snapshot.save/1` | Save chain, service, all sites, clock and record position. Compare before/after: saving leaves the running world untouched apart from its save record. | Bound and passing (run-20261111182634): `TL.snapshot-save-prints-epoch-and-record-seq`, `TL.snapshot-save-leaves-world-untouched`, `TL.snapshot-save-record-gains-only-the-save`, `B9.snapshot-saved`, `B9.new-world-same-documents-ledger-hats-features`; `devnet.json`. |
| 11 | `world.snapshot.restore` / `acc:world.snapshot.restore/2` | Restore into a second world, with its own addresses and chain instance. Documents, balances, hats, features and clock match the save. Pay in each world and prove neither affects the other. | Bound and passing (run-20261111182634): `B9.restore-into-new-world`, `B9.new-world-payment-not-in-old`, `B9.old-world-payment-not-in-new`; `devnet.json`. |
| 12 | `world.show` / `acc:world.show/1` | Read the restored world's parent world, snapshot and sequence through world show; export its record and verify the saved prefix followed by its birth lineage. | Bound and passing (run-20261111182634): `TL.world-show-names-parent`; `devnet.json`. |

## Commands and truthful scoring

- `pnpm evals -- check` validates the mapping against current eval ids and the script's `--list`.
- `pnpm evals -- --journey thin_line` selects the journey plus its operations' acceptance,
  return, refusal and event evals. This intentionally includes more than the twelve primary tests;
  unbound claims stay `not_run`. A partial check cannot pass a primary test.
- `spikes/skeleton/run.sh <fresh-company>` runs the existing end-to-end script directly.
  `--only B9` brings along B1/B2/B3/B5/B6/B7/B8 dependencies, but omits the B4 failure matrix;
  a full run also exercises B4, names and privacy. The runner consumes stable `@check` lines,
  folds repeated names by all-pass, and writes evidence through the status recorder.

The spike's B4 revert, duplicate, outage and poison-event checks remain mapped to
`stays_true_when_broken` and delivery evals in `plugs.json`; B5 feature switches to `sites.json`.
They complement, not replace, this ordered happy path. No existing binding is moved or weakened.
There is no hosted-world check in the spike yet: adding a hosted world name to `worlds` would
not make its hard-coded localhost URLs or its `main` world remote-capable. The same **target
tests above** must be implemented against both placements before g8 can pass. Until then the
aggregate near-miss explicitly prevents a green spike being reported as a passing thin line.
