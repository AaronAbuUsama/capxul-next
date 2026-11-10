## Core half

Everything here is a STAND-IN: contracts are not Capxul's v4, the approve page is not the OpenFort pop-up, the
provider is not Capxul's auth. Proven by `core/bin/test-core.sh` (14 checks, ~15 s, own anvil/Core/fake-Frappe on
8546/8788/8899, never touches a running `up.sh`). Run it: `spikes/skeleton/core/bin/test-core.sh`.

### What a chain cannot tell Frappe (the contract in INTERFACE.md leaves these unsaid)

- **A revert leaves no log.** `payment_failed` is not chain truth; it is Core's own attestation, with an event_key
  Core mints (`approval:<id>:failed`). Core simulates the call first (`eth_call`), so a refused payment has no tx
  and no on-chain trace at all. Anyone auditing "who tried to pay" from the chain alone cannot see it. If that
  matters, broadcast the reverting tx with a fixed gas limit so a mined failed tx exists (still no log).
- **A log names an org only by hash** (`keccak256(slug)`). Core must have seen `OrgCreated` before it can map any
  later log to a site. I hit this: the admin's `HatGranted` precedes `OrgCreated` in the same tx. Core now reads
  org logs first within a batch. The real contracts must make the org→slug mapping recoverable from logs alone.
- **A log names people only by address.** Email and name come from Core's directory (people.json here). An address
  Core does not know arrives with `person_email: null`. `data` also carries `address` (an addition to the contract).
- **`PaymentSent` carries no signer.** `from` is the Safe. Frappe cannot say who signed unless the event adds it
  (`tx.from` here). The contract only has `requested_by`, which came from Frappe, not the chain.
- **The chain knows a document only as a hash.** Frappe must index `document_hash`. A payment with no Frappe
  document (the `pay direct` case) is just a hash Frappe has never seen: that is the unmatched-bank-line signal.
- **A department is not authority.** The stand-in hats carry it in the event only; the chain enforces one
  budget per org, not per department.
- **Refusal is only known at Sign.** `/prepare` cannot say whether the signer would be refused. A cheap
  `canPay(org, person)` view would let Frappe grey out Pay early.

### What the ordering guarantee really costs

- **Head-of-line blocking.** One undeliverable event (Frappe answers 500 for it for ever) stops every later event
  for that org, money included. The outbox retries with backoff and `events status` shows `pending` plus the last
  error, but nothing skips or dead-letters. The real design needs a deliberate poison-event policy.
- **seq is assigned by Core at enqueue, not by the chain.** Chain logs arrive in chain order, but a `payment_failed`
  is slotted in by arrival time, so seq order is not chain order for failures. Core is the single writer of seq.
- **Frappe's view wins on 409.** On `409 expected N` Core marks everything below N applied and everything from N
  pending again, including going backwards (tested: Frappe "restored from backup"). That means Core must keep
  every event for ever, or be able to rebuild them; chain events can be rebuilt from logs, `payment_failed` cannot.
- **Exactly once is at-least-once plus Frappe dedupe.** Core cannot know whether a lost response applied. Tested with
  hard kills (SIGKILL) of Core and of the fake: each event_key applied once, seq gap-free.
- **event_key `chainId:blockHash:logIndex` is not reorg-safe** (a reorg changes blockHash, so the same log would
  apply twice). Key on `chainId:txHash:logIndex` and deliver only after finality. Anvil never reorgs, so untested.
- **A chain reset is an epoch change the contract does not model.** After a stale anvil, Core's outbox is wiped but
  Frappe sites keep their old `last_seq`; Core then hits `409 expected > seq` and reports an error (by design,
  not auto-healed).
- **Held until the site exists.** An org's events queue but are not sent until `org create` has run the Frappe
  script and released the org. If the CLI dies in between the org stays held; re-running `org create` heals it
  (it reuses the Safe and runs the script again). `events resend` does not release a held org.

### Other things the contract got wrong or left unsaid

- The 409 body is read as `{"expected": n}` or `{"message": {"expected": n}}`; Frappe's exception handling may wrap it.
- `/prepare` is idempotent here: the same pending document, requester and hash returns the same approval.
  Approvals never expire. Not in the contract.
- The approve page does not authenticate anyone: whoever opens the link can press Sign and Core signs with
  `requested_by`'s key. The real pop-up must bind the passkey session to the signer, and the signer may differ from
  the requester.
- The OAuth stand-in accepts any `redirect_uri` and lists every person whatever the org. Real: exact registered
  redirect match, and membership-aware sign-in. Social Login Key needs the browser at `localhost:8787` and the
  container at `host.docker.internal:8787`: Core binds 0.0.0.0, and `/.well-known/openid-configuration` echoes the
  request Host, but a single Social Login Key may still need the split-URL fix on the Frappe side.
- HMAC covers the body only: no timestamp or nonce, so a captured `/prepare` or `chain_event` can be replayed.
  Harmless for chain_event (event_key), not for `/prepare`.
- A signing that is mid-flight when Core dies stays `signing` (no tx recorded in the approval) although the chain
  event still flows; Core does not recover that state.
- viem's receipt polling defaults to 4 s; set to 200 ms. With that, Sign returns in ~0.2 s and the event is applied
  ~70 ms later (watcher is poked after Sign); a hat grant made by the CLI is delivered within the 0.7 s poll tick.
- anvil `--state` persists only on a clean SIGTERM (down.sh); a hard kill loses the chain and `chain-up.sh` redeploys.


## Frappe half

Stand-ins: the Core stub, its sign-in and its approve page. Everything else is real Frappe **v16** (`version-16` exists
for frappe, erpnext and hrms; bench from the `frappe/bench` image, Python 3.14, Node 24, MariaDB 11.8, arm64).
**No fork of Frappe, ERPNext or HRMS was needed.** Proven by `frappe/bin/test-frappe.sh` (37 checks, fresh site,
about 4 minutes, uses a ten-line fake `/prepare`, on 8799 if Core already owns 8787). Start: `frappe/bin/up.sh`.

### Numbers measured (MacBook arm64, OrbStack)

| What | Time |
|---|---|
| first `up.sh` (image pulls, `bench init`, get-app erpnext + hrms, asset build) | about 13 min, once |
| `new-site.sh` for a new company: site + erpnext + hrms + capxul + wizard + company + Safe bank account + sign-in key | 143 s (site 30 s, erpnext 53 s, hrms 31 s, capxul 8 s, wizard + config the rest) |
| `new-site.sh` again for the same slug | 7 s |
| `hat_granted` answered (User created, roles added, before the 200) | 0.1 to 0.4 s |
| stop and start the stack | 24 s |

Per-company disk and memory were not measured.

### Roles follow hats

- **A hook can refuse every hand change, Administrator included.** `doc_events` on `User.validate` (compares roles before and
  after, ignoring the automatic ones) plus `Has Role` before_insert / on_trash. Refused: the User form, REST `PUT`, `add_roles`,
  `remove_roles`, a Role Profile assigned to a user (the profile copies roles in before our hook sees them), all as Administrator.
- **Cannot be locked** (measured by `testutil.bypass_attempts`): `doc.flags.ignore_validate = True` then `save()` (role added, hook
  skipped), raw SQL, `bench console` / `bench execute`, a patch, anything that sets `frappe.flags.capxul_applying`. So the lock stops
  people in the product; it does not stop the bench operator or the database. A database trigger or a nightly drift check
  (compare `Has Role` with the hat grants) is the only thing that would.
- **ERPNext strips the `Employee` role from any User without an Employee record** (`validate_employee_role`). The `member` hat
  therefore has to create an Employee first. Employee needs gender and date of birth, which the chain does not know: the skeleton
  puts placeholders in (`Prefer not to say`, 1990-01-01). The design needs to decide where HR facts come from.
- **Department-scoped User Permission works but is thin.** `Department` User Permission limits documents that have a `department`
  link (Employee, Expense Claim, Leave...). Payment Entry and Purchase Invoice have none, so it limits nothing on the money
  documents unless an Accounting Dimension for Department is switched on. A department is not budget authority (as the Core half says).
- A role two hats give stays while one remains: done by storing a `Capxul Hat Grant` per (person, hat, department) with the
  roles it added, and on revoke removing only roles no remaining grant gives. A role-map edit between grant and revoke is not replayed.
- The wizard makes whoever you give `email` a System Manager. `new-site.sh` passes no email so it never makes that second,
  un-chained path to a role.

### Paying a document

Routes tried for "Submit must not post the ledger":

1. **`before_submit` hook, alone.** Works as a *refusal*: REST `PUT docstatus=1`, `frappe.client.submit` and the UI all stop
   (417, nothing posted). It cannot also *record and call Core*: a throw rolls the whole transaction back. Measured
   (`rollback_experiment`): a request row inserted in the hook is gone after the throw. Only `frappe.db.commit()` before the throw
   would keep it; not used (commit inside a hook, exception as control flow).
2. **Override the form's submit action in the client** (`frm.savesubmit` replaced in `refresh` when `paid_from` is the Safe's
   ledger account, which the server puts in `frappe.boot`). It calls the whitelisted `capxul.api.request_payment`, which records a
   `Capxul Payment Request`, signs and calls Core `/prepare`, sets `Waiting for signature`, and the form opens the approval link with
   `window.open(..., "popup=yes,width=480,height=720")` and polls for the result. **This is what ships.** Checked in a real browser:
   Submit calls our method, not the native one; status shows and the pop-up URL opens. A browser may block `window.open` after the
   async call; the headline keeps an "open the approval" link as a fallback.
3. **Workflow** (state `Waiting` doc_status 0, state `Paid` doc_status 1 reachable only by a role `Capxul Chain`). Tried
   (`workflow_experiment`). Does not gate: **Administrator holds every role, including the new one**, so the transition is
   pressable by hand; it was only stopped by route 1. A Workflow would also replace the Submit button with its own actions. Rejected.
4. **GL Entry `before_insert` hook** as a backstop: no ledger credit to the Safe's account unless the chain handler set a flag.
   Works (a Journal Entry crediting the Safe is refused). It also blocks any legitimate non-chain outflow, which is the intent.

So the working design is route 2 for experience, route 1 + 4 for enforcement. Routes 1 and 4 are hooks; nothing needed a fork.
Cancel of a posted Safe payment is also refused (money cannot be un-sent). A refund has to be a chain event.

Other things Frappe did that the contract did not expect:

- **ERPNext demands `reference_no` and `reference_date` on a Bank-type payment even as a draft.** The tx hash only exists later.
  A `before_validate` hook writes `PENDING-CHAIN`; the `payment_sent` handler replaces it with `tx_hash` before submitting.
- **Bank Account has no field wide enough for a Safe address**: `bank_account_no` is 30 characters, `iban` 34, an address is 42.
  The address is stored in `integration_id` (unique, no length limit) and in Capxul Settings.
- **Currency.** The Safe holds USDC. Company currency is **USD** (country stays United Kingdom); the Safe's ledger account is a
  USD Bank account, so USDC is booked 1:1 as USD with no exchange rate. GBP books with a USD-denominated account were **not
  tried**: a Payment Entry from a USD account to a GBP invoice needs a rate in the entry (and in the hash). That is the open
  question for real UK customers: USDC-to-GBP revaluation.
- **Social Login Key**: one key holds both URLs (authorize `http://localhost:8787`, token and userinfo
  `http://host.docker.internal:8787`) because with `custom_base_url` off Frappe uses each URL as written. But **`base_url` must
  still be set or the login button is hidden**. Sign-in verified end to end against the real Core stub with curl (authorize,
  pick Hannah, callback, `user_id` cookie). Sign-up is Deny: only a person a hat created can sign in.
- **Core's outbox + our 500.** A handler that raises answers 500 and leaves the cursor where it was, with the event stored as
  `Failed` (retry reapplies it). One permanently failing event therefore blocks every later event for the site, exactly the
  head-of-line cost the Core half describes.
- `chain_event` is `allow_guest` and authenticated by the HMAC only; it then runs as Administrator. Wrong `org` is refused 403.
  Event 409 carries `expected` at the top level of the JSON (set in `frappe.local.response`), no `message` key.
- `bench get-app` needs a git remote; the app is a mounted directory installed editable instead. `bench init` refuses an
  existing directory, so the bench volume mounts one level up.

### Canonical JSON for `document_hash` (CANON v1, `capxul/canon.py`)

UTF-8, keys sorted, separators `,` and `:`, no spaces; hash is `0x` plus the sha-256 hex of those bytes.
Keys: `canon` (1), `doctype`, `name`, `company`, `payment_type`, `posting_date` (`YYYY-MM-DD`), `party_type`, `party`,
`paid_from` (the ledger account), `paid_amount` (string, 2 decimals), `asset`, `to_address` (lower case, from the party's
`Capxul Wallet Address`), `references` (sorted by doctype and name, each `{doctype, name, allocated}` with `allocated` a 2-decimal
string). Left out on purpose, because they change during signing: `reference_no`, `reference_date`, `docstatus`, `modified`,
the Capxul status fields. Editing the draft after `/prepare` changes the hash; the later `payment_sent` then does not match, the
request becomes `Mismatch` and the chain payment lands as an unreconciled Bank Transaction.

### Disagreements and gaps against INTERFACE.md

- None that block it. Additions: `requested_by` is the Frappe session user, which for the test is `Administrator`, not a person
  with a test key; Core must map a Frappe user to a signer. `department` in `/prepare` is the requester's department from his
  hat grants, else empty.
- `payment_sent.to` is recorded only in the Bank Transaction description; the match is by `document_hash`, then amount.
- Not done: Frappe stopped while the log lands (covered by the contract's outbox and by idempotency, checked in the test with
  repeated delivery only); Frappe CRM; reconciling a real Bank Transaction against a later-created document; Server Scripts
  (disabled by default, so not a bypass here, but an Administrator who enables them could set our flag).


## End to end

`run.sh [slug]` runs the four behaviours against the real halves together: 40 checks, 40 PASS, from a wiped chain, wiped Core
state and no site (cold: about 4 minutes, of which `org create` is 138 s). Re-run on an existing org it continues
idempotently. The Frappe and Core scripts still pass on their own (`test-core.sh` all checks, `test-frappe.sh` 37/37).

### What broke when the halves met

Less than expected: sign-in, roles, paying, the outbox and the Frappe-down case worked first time. What did not:

1. **The default hat map could not do the work.** `admin` could not create a Supplier (needs `Purchase Master Manager`), and
   `budget-holder` (Accounts User, Purchase User, Expense Approver) cannot create one either. The map is the Frappe half's, so
   every hat's roles must be checked against real tasks, not just against "the role exists".
2. **Re-creating a site for an org Core had already delivered to left the new site empty.** Core thought seq 1.. were applied
   and sent nothing until the next event, which then drew a 409 (it did recover, from seq 1). Nothing in the contract says
   what `org create` means for an org whose site was dropped.
3. **`requested_by` as the Frappe session user.** Administrator (and any Frappe user that is not a person) cannot map to a
   signer. Core answered 400, and the Frappe half called that "Core could not be reached". Misreported, reason lost.
4. **A person's roles and the chain's authority are independent.** `payroll-approver` can be given Frappe roles that submit a
   Payment Entry (a map edit on the site) while the chain gives that hat no payment authority. That is exactly case 4a; the
   chain, not the role, decided.
5. **A handler that raises: 500 for ever, head-of-line blocking.** Reproduced for real: a hat granted on the chain to an
   address Core has no email for arrives with `person_email: null`; the handler crashed on `None.strip()`; every later event
   for the org stopped. (The contract's `person_email` is not optional in its text; the Core half's `data` can make it null.)

### What I changed

| Half | Change | Why |
|---|---|---|
| Frappe | `setup.py`: `admin` hat also gets `Purchase Master Manager` | 1 |
| Frappe | `payments.request_payment`: a 4xx from `/prepare` is "Capxul did not accept this payment request: <Core's reason>", request stored `Failed: PREPARE_REFUSED: ...`; only a network error is "could not be reached" | 3 |
| Frappe | `api._process`: a handler failure is answered 500 twice (Core retries, `attempts` counted on `Capxul Chain Event`), the third time the event is **Parked** (status `Parked`, error kept), the cursor moves on, answer `200 {"applied": false, "parked": true}`; a parked `payment_sent` becomes an unreconciled Bank Transaction so the books still show the money left; a repeat of a parked event is answered like an applied one | 5 |
| Frappe | `hats.py`: a hat event without `person_email` raises a clear error; DocType `Capxul Chain Event` gets `attempts` and the `Parked` status | 5 |
| Core | `outbox.release`: offers every event again from seq 1 (Frappe answers "already applied" to what it has) | 2 |
| Core | `/admin/redeliver` + `events redeliver <slug> <seq>`: test seam to make Core deliver an applied event again (4b) | 4b needs Core to do it |
| Core | `/prepare` refusal text says a Frappe user is a person only if a hat created it | 3 |

No fork of Frappe, ERPNext or HRMS. INTERFACE.md untouched.

### Where the contract was wrong or silent

- `requested_by` is "the person"; the Frappe half sends the session user, which is an email only for users a hat created.
  Silent on every other user.
- Silent on what a 4xx from `/prepare` means for the person, and on a hat event whose person Core cannot name.
- Silent on what `org create` does for an org that already has events (a new site). Also silent on the poison event: "Core
  resends until applied" cannot hold for an event that never can be.
- `hat_granted` data carries `address` (added by Core); `person_email` and `person_name` can be null.
- `payment_failed` is Core's word, not the chain's (the Core half said so); here it is the only reason the person ever sees.
- The contract has no way for Frappe to say "applied but parked". I used `200` with `parked: true`; Core treats it as applied.
- Core's `payment_sent` carries no signer; Frappe cannot show "paid by".

### Measured (MacBook arm64, OrbStack, cold run)

| What | Time |
|---|---|
| `org create` (chain + Frappe site with ERPNext, HRMS, capxul + events) | 138 s (earlier run 135 s; 137 s on the first) |
| admin's User on the site after `org create` returns | 53 ms (first poll) |
| OAuth redirect chain to a logged-in session (curl, 4 requests) | 0.6 s |
| `hat grant` mined to roles present | 54 to 307 ms (measured from CLI return, polling every 150 ms) |
| `hat revoke` mined to roles gone | 467 to 478 ms |
| Sign (pop-up stand-in) to chain transaction mined | 88 to 283 ms |
| Sign returned to Payment Entry submitted | 533 to 728 ms |
| Frappe stack `down` then `up` | 11 s |
| After the stack answered, held payment posted (Core retry backoff up to 8 s) | 2.0 to 3.8 s |
| Poison event: from the chain to Core's outbox empty (3 attempts, then parked) | 2.5 to 2.6 s |

### What the design must now decide

1. **Who is a Frappe user on the chain?** Today the User id is the email and Core finds the signer by email. Administrator,
   any user created by hand elsewhere, and a person who changes email all fall outside it. Decide the key (address? a Capxul
   id stored on the User?) and whether a User can exist without a hat.
2. **What happens to the queue when one event cannot be applied?** I parked after 3 tries. Decide: who sees a Parked event,
   who retries it (there is no retry tool), whether money events may ever be parked (a parked `payment_sent` is shown as an
   unreconciled bank line), and whether transient and permanent errors must be told apart.
3. **Who keeps the history?** `release` replays from seq 1, 409 replays from Frappe's cursor, and `payment_failed` cannot be
   rebuilt from the chain. Decide where the log of record lives and what a new site for an old org receives.
4. **What does the person see while waiting?** Today: a status line, a pop-up that may be blocked, a 3 s poll. Nothing says
   whose signature is awaited if the signer differs from the requester, nor what happens if the pop-up is closed.
5. **What can Administrator still do?** It holds every role and can edit the hat map, but cannot edit a person's roles, cannot
   submit, cancel or credit the Safe's account, and cannot pay (no signer). It can still enable Server Scripts, use the bench
   and the database. Decide whether a site's Administrator is a Capxul operator, the org admin, or nobody.
6. **Is the hat map data or contract?** It is editable on the site, so a map edit can give a role chain authority never
   granted (4a shows the chain still refuses). Decide who may edit it and whether a map change replays to existing grants.
7. **Roles must be checked against real work.** The default map missed `Purchase Master Manager`; budget-holder cannot create
   a supplier, so someone else must. Decide the real map per hat, department included (a Department User Permission limits
   nothing on a Payment Entry).
8. **Refusal is learned only at Sign.** Frappe cannot grey out Submit for a person the chain would refuse; a cheap
   `canPay(org, person)` read would let it.


## CRM, WhatsApp and feature switches

Frappe half only (Core got `feature list|on|off`). Nothing forked: no change to Frappe, ERPNext, HRMS, CRM or the WhatsApp app. Everything
below is the `capxul` app (`features.py`, `brand.py`, `setup.py`, hooks), `frappe/bin/{add-app,feature,find-names}.sh` and Core's CLI.
Proven by `run.sh` (59 checks: the old 40, 18 in "Behaviour 5", 1 names crawl), `core/bin/test-core.sh` and `frappe/bin/test-frappe.sh`.

### What is installed

| App | Branch / version | Licence | Maintainer |
|---|---|---|---|
| Frappe CRM (`crm`) | `version-16`, 16.0.2 (released 5 Nov 2026) | AGPL-3.0 (`LICENSE`, `app_license = "AGPLv3"`) | Frappe Technologies (frappe/crm) |
| WhatsApp (`frappe_whatsapp`) | `master`, 1.0.12 | MIT (`license.txt` is one line, "License: MIT"; no copyright line; GitHub shows "other") | Shridhar Patil, an individual (shridarpatil/frappe_whatsapp, about 500 stars, last push 4 Aug 2026) |

- **Which CRM branch.** Read from the repository, not guessed: `main` is 1.92.0 and still declares Frappe `>=15,<17`; `develop` is 2.0.0-dev
  and `version-16-hotfix` is the line that feeds the release branch; **`version-16`** declares `frappe >=16.0.0,<17.0.0` and is the
  released one. Frappe CRM ran on this bench (Frappe 16.55.2, ERPNext 16.54.0, HRMS 16.53.1) with no patching.
- **Which WhatsApp app.** From CRM's own code, not from the name: `crm/api/whatsapp.py` (version-16) reads the doctypes `WhatsApp Message`,
  `WhatsApp Templates`, `WhatsApp Settings` and `WhatsApp Account`, checks `"frappe_whatsapp" in frappe.get_installed_apps()`, and the README
  says "Frappe WhatsApp (shridarpatil/frappe_whatsapp) is used for this integration". **But CRM `develop` (the next major) has already moved
  to a different app**: `crm/api/whatsapp.py` there reads `WA Account` and `WA Profile`, the doctypes of the official
  `github.com/frappe/whatsapp` (app `whatsapp`, MIT, Frappe Technologies, `main` 1.2.0, `requires-python >=3.14`). Installing the official one now would
  give a CRM v16 tab that finds nothing. So the third-party app is what CRM v16 uses today, and the integration will be replaced by a
  Frappe-maintained app when CRM v2 lands.
- The app is on the bench but not on a site until `feature on whatsapp`. `python-magic` (its only dependency) installed without extra libs.

### Measured

| What | Time |
|---|---|
| `bench get-app crm` (clone, pip, two `yarn install`, `vite build` of the front end, locale compile) | 145 s, once per bench |
| `bench get-app frappe_whatsapp` | 8 s, once per bench |
| `bench install-app crm` on a site | 8.8 s (acme), 8.0 s (beta) |
| `bench install-app frappe_whatsapp` on a site | about 4 s |
| `bench migrate` per site (new DocType `Capxul Feature`) | 6 to 7 s |
| `feature on|off` through Core (hat check on the chain, switch, caches, every user re-saved) | 4.5 to 6 s; `on whatsapp` with the install 7.6 s |
| `feature list` | 1.5 to 2 s (one `bench execute`) |
| `capxul.brand.apply` (names, about 57 Translation rows) | 4 s |
| restart of the bench container (new app or new hooks must be loaded) | 6 s |
| `find-names.sh` (3 sessions, about 300 files fetched) | 10 s |
| `test-frappe.sh` (fresh site with ERPNext, HRMS, CRM, names, then its 37 checks) | 186 s in all; `core/bin/test-core.sh` 15 s; `run.sh` on an existing org about 3 minutes |

Things the bench did that were not expected:

- **`bench get-app` rewrites `sites/apps.txt` and drops `capxul`** (it is a mounted directory, not a git checkout). The running server then
  lost the app's hooks until it was put back by hand. `frappe/bin/add-app.sh` re-adds it after every `get-app`; the entrypoint already did on start.
- **A fresh session that visits `/desk` or `/crm` gets a CSRF token**, after which a bare `curl -X POST` with its cookie is refused (400). `run.sh`
  keeps one session per person for REST and another for page loads.

### Roles: what CRM needs, and the hat that is missing

- Frappe CRM's own check (`crm.api.check_app_permission`, `ALLOWED_WHATSAPP_ROLES`) is: the module `FCRM` is allowed for the person **and** a role
  in {System Manager, Sales User, Sales Manager}. The WhatsApp tab and its API use the same three. Nothing else is needed to open it.
- The `admin` hat's default map gained `Sales Manager`, `Sales User` (CRM), and `Projects Manager`, `Stock Manager`, `Manufacturing Manager`
  (so the admin hat has a role in every part a switch can turn on). A site made before this keeps its map, so `setup.topup_hat_map` adds the missing
  roles to the existing `admin` map and **replays them to people already wearing the hat** (the earlier finding said a map edit is not replayed;
  here it is, for additions only). `member`, `budget-holder`, `payroll-approver` get no CRM role by design of this spike: a member-hat person
  gets 403 on `/crm` and on CRM's API (checked).
- **The skeleton's four hats have no sales hat.** Today only `admin` can use the CRM, and only because System Manager is in its map. A salesperson
  needs a hat (at least `sales`: Sales User; `sales-manager`: Sales Manager) and the design must say whether a department/territory scopes it
  (CRM has its own "org hierarchy" permission hooks for leads and deals).

### The link from a won deal to an ERPNext Customer (configuration only, no code of ours)

Two settings, written by `setup.configure_crm` (run when CRM is installed on a site, and by `new-site.sh`):

1. ERPNext `CRM Settings`: `enable_frappe_crm_data_synchronization = 1` (without it ERPNext's `create_customer` refuses).
2. CRM `ERPNext CRM Settings`: `enabled = 1`, `erpnext_company` = the site's Company, `create_customer_on_status_change = 1`, `deal_status = Won`,
   `sync_products = 0` (the default 1 starts a job that mirrors CRM Products and ERPNext Items; left off).

Checked end to end in `run.sh` (a person in the admin hat creates an organisation and a deal and sets it to Won):

- **Carries:** a Customer named after the deal's organisation (or, with no organisation, the primary contact's name as an Individual), type Company,
  `default_currency` from the deal (USD), `territory` and `industry` only if the deal has them and they exist in ERPNext, `website`, the organisation's
  address and the deal's contacts (as ERPNext Contact rows) **when the deal has them: not tested**, and a back reference both ways
  (`Customer.crm_deal`, `CRM Deal.erpnext_customer`).
- **Does not carry:** the deal value, products, notes, emails, calls, tasks, the deal owner (no Sales Person), `customer_group` (ERPNext's default),
  any Opportunity, Quotation or Sales Order. Quotations are made from a "Create Quotation" button on the deal, which opens an ERPNext form pre-filled.
- It fires on `CRM Deal.on_update` when the status equals `Won`; it is one-way and only that once. It finds an existing Customer **by name**, so two
  deals for the same organisation share one Customer, and the second `crm_deal` back reference is not written. When the person who sets Won lacks
  Customer create permission the insert is refused; CRM's helper swallows the error into the Error Log and the deal still saves with no customer.

### WhatsApp: what it needs from the owner, and what works without it

Nothing was entered, invented or looked for. The app is installed and **unconfigured**: `crm.api.whatsapp.is_whatsapp_installed` is true and
`is_whatsapp_enabled` is false (CRM only enables the tab for an Active default outgoing account).

Needs, from the app's README and doctypes:

| Where on the site | What | From Meta |
|---|---|---|
| `WhatsApp Account` (one per number) | `token` (Password) | a permanent access token of a **system user** (Business Settings > Users > System users) with `whatsapp_business_messaging` and `whatsapp_business_management`; the temporary token from API Setup lasts 24 hours |
| | `phone_id` | Phone Number ID of the WhatsApp number |
| | `business_id` | WhatsApp Business Account ID |
| | `app_id` | the Meta app's App ID |
| | `url` and `version` | `https://graph.facebook.com` and a Graph API version such as `v17.0` |
| | `webhook_verify_token` | a string we choose; Meta must be given the same one |
| | `status` Active, `is_default_outgoing` (and `is_default_incoming`) | nothing |
| `WhatsApp Settings` | `default_outgoing_account` (and incoming) | nothing: this is what CRM reads |

Meta side, outside the site: a Business portfolio (verified for anything beyond tests), a Meta app of type Business with the WhatsApp product, a
WhatsApp Business Account, a registered phone number with an approved display name, a webhook pointed at
`https://<site>/api/method/frappe_whatsapp.utils.webhook.webhook` subscribed to `messages` (the method is `allow_guest`: Meta calls it without a session,
and the site must therefore be reachable from the internet over https, which `<slug>.localhost` is not), and, to message anyone first,
templates approved by Meta (outside the 24-hour customer window only templates may be sent). While the app is in development mode Meta only
delivers to numbers listed under API Setup.

Works without any of it: the app and its doctypes are installed and switchable; `WhatsApp Templates` and `WhatsApp Notification` can be drafted in the
desk (not tried, and a template save may call Meta once an account exists); the CRM has no WhatsApp tab until an account is Active. Nothing can be sent or
received. **Not tested, because it needs credentials:** sending, receiving, template sync, the webhook.
Also noted: CRM's first-run screen "Set up Frappe CRM" has a pre-ticked "Share usage data" box and `www/crm.py` calls `frappe.utils.telemetry.capture`; the site
wizard turns telemetry off (`enable_telemetry 0`) so the capture does nothing here, but the box is the person's to see.

### Feature switches: what "off" is, and what each candidate closed

State: a `Capxul Feature` DocType, one row per feature (`enabled`), readable on the site (`GET /api/resource/Capxul Feature`, and
`capxul.features.status` for any signed-in person). A hand edit is refused (`guard_feature`, same pattern as the role lock; Administrator too).
New sites: accounts, people, payroll, projects, crm on; whatsapp, stock, manufacturing off. `whatsapp` needs `crm`: turning whatsapp on with crm off,
or crm off with whatsapp on, is refused with the reason before anything is installed. "On" for `crm` or `whatsapp` installs the app on that site first
(`bench install-app`, then `configure_crm` or the WhatsApp roles) and re-applies the names.

Every candidate was tried on `acme.localhost` against seven ways to reach Project (REST list, REST read, REST create, `frappe.client.get_list`,
`reportview.get`, `get_count`, `getdoctype`), as the admin-hat person (System Manager) and as Administrator:

| Candidate | Desk | REST / RPC | Verdict |
|---|---|---|---|
| **A. `User.block_modules`** (native; Block Module rows) | Projects gone from the person's desk (46 mentions to 15 in the boot data; module sidebar gone) | all seven answered 200 with the records | desk only. It also fails CRM's own `/crm` check (`FCRM` must be an allowed module), read from `crm/api/__init__.py`, not measured on its own |
| **B. Hide the Workspace** (`is_hidden`) | sidebar entry gone | all seven 200 | desk only, and the app's next `migrate` resets standard Workspaces |
| **C. Take the roles off the hat map** | not tried by editing: read from `DocPerm` | `Project` is readable by **`Desk User`, a role every System User has**, and by System Manager and Projects User/Manager; the admin hat's System Manager keeps it, and Administrator has everything | cannot close anything for the admin hat; only helps a part owned by one role nobody else holds |
| **D1. `has_permission` hook `"*"`** | none | a document read by the person is refused (`check_permission` raises); but **Administrator is skipped by Frappe before any hook**, and the hook is only asked about documents, so doctype-level calls (`frappe.has_permission("Project")`) stay true | closes documents for people, not lists, not Administrator |
| **D2. `permission_query_conditions` `"*"`** | none | lists return 0 rows (for the person **and** for Administrator) | hides rows, answers 200 with an empty list, so "off" looks like "empty" |
| **D3. `before_request` guard** | none | **403 "Projects is switched off for this company" on all seven routes, for the person and for Administrator** | the only one that refuses outright; keyed on the path (`/api/resource/<DocType>`, `/crm`), on `doctype`/`dt`/`doc` in the call, and on an app's method prefix |

What ships is A + D1 + D2 + D3 together, each doing what it does best: **A** removes the part from every person's desk, **D3** makes REST and RPC answer
403 whoever asks, **D1/D2** are the backstop for code paths that never go through a request (a whitelisted method that reads a document). The set of
DocTypes of a part is its Frappe modules plus every module of its app (`crm`, `frappe_whatsapp`), computed from `Module Def` and cached; a new
person's `block_modules` is set by a `User.validate` hook, and a switch re-saves every user.

**What "off" does not close** (all stated, none hidden):

- `bench console`, `bench execute`, raw SQL, a patch, a Server Script, a scheduled job and a document event still see the data and still run (the scheduler of
  an off app keeps running: the Stock or Manufacturing jobs are not stopped).
- The guard only recognises a doctype named in the path, in `doctype`, `dt`, `reference_doctype`, `parent` or a JSON `doc`. A whitelisted method that works on
  an off DocType without naming it, or sends it inside `docs`/`args` JSON (`run_doc_method`), passes the guard (D1 still stops a person, not Administrator).
  Whole-app method prefixes are guarded for `crm`, `whatsapp`, `projects`, `manufacturing`, `payroll`; **not** for `accounts`, `people`, `stock`, which share methods
  with the rest of ERPNext.
- A page already open in a browser keeps working until it reloads (the desk was loaded with the module).
- **ERPNext's parts are not separable.** `Item`, `UOM`, `Price List`, `Brand`, `Item Group`... live in the Stock module but a Purchase Invoice needs them, so
  `stock` off keeps a list of shared masters reachable (`features.SHARED_MASTERS`). With `stock` off by default, Warehouse, Stock Entry, Bin... are closed and
  an invoice with "Update Stock" would fail. `accounts` off would close the payment flow the chain posts into; `run.sh` never switches it.
- `crm` off closes `/crm`, `/crm-form`, every `crm.*` method and every CRM DocType; ERPNext's own older CRM module (Lead, Opportunity, Customer) is a
  different module and stays as it is.
- Turning `whatsapp` off leaves the app installed and its data; the webhook method `frappe_whatsapp.utils.webhook.webhook` is `allow_guest` and is closed by the
  method prefix only while the feature is off, so a Meta call would then get 403.

### Names only: the site says Capxul, not Frappe or ERPNext

Done through configuration and the `capxul` app (`brand.py`, run by `new-site.sh` and after every migrate); **no fork**.

What was renamed:

- System Settings app name and OTP issuer; Website Settings app name and the "Powered by" footer (login page and every web page): "Powered by Capxul".
- **The site language is English (UK) (`en-GB`) and Capxul's own `Translation` rows for it rewrite the strings.** Frappe never applies Translation rows to plain
  `en` (`get_all_translations` returns `{}` for it); `en-GB` has no catalogue of its own, so only our rows apply. People made by a hat start on `en-GB` (a
  `User.validate` hook), existing ones were moved. The rows are generated from what is installed: the `__()` literals in the JS bundles of Frappe, ERPNext, HRMS, CRM and
  the WhatsApp app, the `_()` messages in their Python, and the Workspace, Module Onboarding, Onboarding Step, Module Def, DocType, Report and Desktop Icon records
  (57 rows on acme). They rename: the apps screen tiles ("ERPNext" to "Capxul", "Frappe HR" to "Capxul HR", "Framework" to "System"; CRM's tile says "CRM"),
  the workspaces ("ERPNext Settings", "Frappe CRM"), the home onboarding ("Get to know ERPNext"), the help/about menu, the CRM screens ("Set up Frappe CRM", the
  integration settings text, the not-permitted page), and server errors ("You do not have permission to access Frappe CRM").
- The page `<title>` and PWA title written into templates (`Frappe`, `Frappe CRM`) are rewritten by an `after_request` hook, so the browser tab says Capxul and
  Capxul CRM. A cosmetic hook: it cannot break a page (it swallows its own errors).
- The Navbar's "Frappe Support" link (it pointed at frappe.io) is removed. The standard email footer ("Sent via ERPNext") is switched off and the footer is
  "Sent via Capxul" (checked by rendering `get_footer`).

What could not be renamed without a fork, and why:

- `manifest.webmanifest` of the CRM (`name` and `short_name` "Frappe CRM", the label when someone installs the CRM as a phone app) is a static file of the CRM
  app, served straight from `/assets` where no hook runs. (Production nginx could rewrite it; not tried.)
- Image marks: the apps-screen icons for ERPNext and Frappe HR are their own logo files; the CRM logo is CRM's. That is a logo, not a name, and is the later colour-and-logo job.
- Identifiers a person does not read as text but that carry the names: asset paths (`/assets/frappe/...`), module and app ids (`erpnext`, `frappe_whatsapp`), `X-Frappe-*`
  headers, page-source comments (`<!-- Built on Frappe -->`) and `<meta name="generator" content="frappe">`, and the doc links inside onboarding text (the link
  text is renamed, the address is `docs.frappe.io`). 250 distinct, listed by `find-names.sh` as `internal`.
- Anything that does not go through `__()`/`_()` cannot be translated: the crawler counts a string as replaced only when the person's own translation dictionary
  holds it, which assumes the page passes it through `__()`. Checked by eye for the apps screen, the tab titles, the login page, the CRM title and the member's 403 page;
  **not checked** for printed PDFs, emails other than the footer, the About dialog's version list, or the setup wizard (which no person sees: it is run by the script).
- Kept on purpose: the copyright notice "(c) Frappe Technologies Pvt. Ltd. and contributors" (the About dialog and the CRM footer), and the names of other
  companies' services inside the CRM ("Frappe Mail", "Frappe Cloud"). The About dialog (`Help > About`) is kept: it is where the licence and the copyright stay reachable.

**Measured with `frappe/bin/find-names.sh acme`** (signed in as the admin-hat person and the member-hat person, plus the signed-out pages; fetches 10 pages, the boot data
of the desk, 24 lists a person reads, the CRM page and all of its front-end files, the desk's JS bundles, the manifest): text a person reads that still says Frappe or ERPNext,
**76 distinct places before, 2 after** (both the CRM manifest). 52 more are replaced only through the person's translations (see the caveat), 9 are the kept
notices and third-party names, 250 are identifiers. The "before" was taken by undoing the settings, the language and the translation rows on acme, with the
`after_request` title rewrite still in place, so it understates the before a little (a few page titles). Still shown, in full:
`/assets/crm/frontend/manifest.webmanifest .name` and `.short_name`: "Frappe CRM"; and kept: "(c) Frappe Technologies Pvt. Ltd. and contributors" (CRM footer, desk bundle),
"Frappe Cloud" (two CRM dialog texts), "Frappe Mail" (five CRM mail-setup texts).

**What a lawyer should look at** (read from each app's own licence file on the bench, not from memory):

| App | Licence |
|---|---|
| Frappe (framework) | MIT (`LICENSE`, "Copyright (c) 2016-2021 Frappe Technologies Pvt. Ltd.") |
| ERPNext | GPL-3.0 (`license.txt`, `app_license`) |
| HRMS | GPL-3.0 (`license.txt`, `app_license`) |
| Frappe CRM | **AGPL-3.0** (`LICENSE`, `app_license = "AGPLv3"`); note `crm/www/crm.py` carries a header saying "GNU GPLv3 License", which disagrees with the repository licence |
| frappe_whatsapp | MIT (`license.txt` is a single line, no copyright holder named) |

- MIT asks for the copyright and permission notice to stay with copies; GPL-3.0 and AGPL-3.0 ask for notices to be kept, appropriate legal notices to remain
  in interactive interfaces that show them (GPL-3.0 section 5(d), the About dialog and copyright line are what we kept), and the source to be offered. **AGPL-3.0
  section 13 is the one that bites a hosted product**: users who interact with the CRM over a network must be offered its corresponding source, including any change
  Capxul makes to it. Capxul's own `capxul` app is not a modified CRM (it uses hooks), but the "no fork" rule is what keeps that argument simple; the lawyer should say
  whether the translation rows and the `after_request` title rewrite count as modifying the CRM, and whether hiding "Frappe" from the interface is compatible with
  GPL-3.0's trademark and notice terms (GPL-3.0 section 7(e) lets the author decline to grant trademark rights; the names "Frappe" and "ERPNext" are Frappe's marks).
- The logo files stay Frappe's; replacing them is a design job but not a licence one, the marks are not licensed by GPL or AGPL.
- Not a lawyer's opinion: this is a list of where to look.

### What the design must now decide

1. **Sales hat.** Which hat gives Sales User and Sales Manager, and does the chain know it? Until then only `admin` can open the CRM.
2. **Is a feature switch chain authority?** Core checks the admin hat on the chain stand-in and the site obeys a script; a site operator with `bench` can flip a
   feature with no chain event. Decide whether a switch is a chain event (like a hat) that the site mirrors, or a Core-owned setting.
3. **What does "off" promise?** Refusal everywhere a person or the API can reach, data kept. It does not stop the bench, jobs or Server Scripts, and ERPNext's
   shared masters (Item and others) cannot be switched with the part that owns them. Decide whether "stock off" means "no stock features" or "no Stock module".
4. **Where do apps live?** Adding CRM took 145 s on the bench and 9 s per site, WhatsApp 8 s and 4 s: all sites of a bench share the app versions, so a CRM upgrade
   is every company's upgrade. Decide the bench-per-cohort and upgrade policy; and who restarts the bench when an app is added (6 s here).
5. **WhatsApp ownership.** The tab depends on a one-person third-party app today and on the official Frappe app from CRM v2. Decide whether Capxul pins v16 and a migration, and
   who holds each company's Meta account and token (the company's, per site, in `WhatsApp Account`; the token is a stored password on the site) and its public webhook URL.
6. **Deal to customer.** Configuration carries a name and a back reference, not money. Decide what a Won deal must become (Customer only? Quotation, Sales Order, a budget?),
   and whether a customer or a Safe address appears from the deal (the `Capxul Wallet Address` custom field on Customer is not filled).
7. **Names.** Which parts of "Frappe" and "ERPNext" must go, which must stay for the licences, and whether the CRM manifest and logos justify a thin fork or a proxy rewrite.
   Decide the language rule: `en-GB` for everyone is what makes the strings change.
8. **AGPL.** Decide with a lawyer whether hosting the CRM for customers as part of a product obliges a source offer, and where it is published.
