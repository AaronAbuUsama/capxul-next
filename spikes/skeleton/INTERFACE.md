# Walking skeleton: the contract between its two halves

**This is a spike. It is throwaway.** It exists to answer questions a record cannot: can a real Frappe site be
created by a command, sign in through Capxul, take its roles from hats, and post a payment to its books only when a
chain says the money moved. Nothing here is product code, nothing here is ported into the product, and the book's
rules (`system.layout`, the six slots) do not apply inside `spikes/`. What the spike must leave behind is
`FINDINGS.md`: every place real Frappe forced the design.

Aaron's direction, 10 November 2026, which the skeleton tests:

- Capxul hosts a Frappe site per company. People work in it the normal Frappe way, money included.
- The chain owns authority and money. Frappe reflects it; Frappe never grants authority and never marks money moved
  until the chain says so.
- Capxul is the sign-in, the signer and the bank inside that Frappe.
- The CLI is the one door: an org, and its site, are created from it.

## Layout and owners

| Path | Owner | What |
|---|---|---|
| `spikes/skeleton/INTERFACE.md` | coordinator | this file; neither half edits it, both report disagreements |
| `spikes/skeleton/frappe/**` | Frappe half | compose file, bench, the `capxul` Frappe app, `bin/new-site.sh` |
| `spikes/skeleton/core/**` | Core half | stand-in contracts, the Core stub service, the CLI |
| `spikes/skeleton/FINDINGS.md` | both | one section each: `## Frappe half`, `## Core half` |

## Addresses (all local, dev only)

| What | Where |
|---|---|
| Frappe | `http://127.0.0.1:8000`, one site per company named `<slug>.localhost` |
| a company's site in a browser | `http://<slug>.localhost:8000` |
| local chain (anvil) | `http://127.0.0.1:8545`, chain id 31337 |
| Core stub | `http://127.0.0.1:8787` (from the bench container: `http://host.docker.internal:8787`) |
| shared dev secret | `SKELETON_SECRET` in `spikes/skeleton/.env`, value `skeleton-dev-secret`; dev only, never a real key |

Core reaches a site with `X-Frappe-Site-Name: <slug>.localhost` on `http://127.0.0.1:8000`, so nothing depends on
how the host resolves `*.localhost`.

Every call between the halves carries `X-Capxul-Signature: <hex hmac-sha256(SKELETON_SECRET, raw body)>`. A call
without a valid signature is refused with 401.

## Hats (the only four the skeleton knows)

`admin`, `budget-holder` (may carry a department), `payroll-approver`, `member`. On the stand-in chain a payment
reverts unless the signer wears `admin` or `budget-holder` in that org and the budget has room. The Frappe half owns
the map from hat to Frappe roles (a DocType, so it can be read and changed on the site).

## Core → Frappe: one endpoint

`POST /api/method/capxul.api.chain_event`

```jsonc
{
  "event_key": "31337:0xblockhash:3",   // unique for ever; a repeat is answered 200 and changes nothing
  "seq": 7,                             // per org, gap-free from 1
  "org": "acme",
  "kind": "hat_granted",                // hat_granted | hat_revoked | payment_sent | payment_failed
  "data": { }
}
```

`data` by kind:

```jsonc
// hat_granted, hat_revoked
{ "hat": "budget-holder", "person_email": "hannah@acme.test", "person_name": "Hannah Okafor", "department": "Finance" }

// payment_sent (a real log on the chain)
{ "payment_id": "0x…", "document_hash": "0x…", "from_safe": "0x…", "to": "0x…",
  "amount": "125.50", "asset": "USDC", "tx_hash": "0x…", "block_time": "2026-11-10T12:00:00Z" }

// payment_failed (no log exists: Core reports that a signed attempt reverted or was refused)
// its event_key is "approval:<approval_id>:failed"
{ "approval_id": "apr_…", "document_hash": "0x…", "reason": "NOT_AUTHORISED", "detail": "…" }
// reason: NOT_AUTHORISED | OVER_BUDGET | REVERTED
```

Answers (Frappe wraps a method's return in `message`):

- `200 {"message": {"applied": true, "last_seq": 7}}`
- `200 {"message": {"applied": false, "last_seq": 7}}` for a repeated `event_key`
- `409 {"expected": 6}` when `seq` is ahead: Core resends from `expected`, in order
- `401` for a bad signature

Core keeps every event in its own outbox and resends until it is applied, so Frappe being down loses nothing.

## Frappe → Core

`POST /prepare` — a person asked, inside Frappe, to pay a document from the Safe-backed bank account.

```jsonc
{ "org": "acme", "site": "acme.localhost", "doctype": "Payment Entry", "name": "ACC-PAY-2026-00001",
  "document_hash": "0x…",            // sha-256 over the document's canonical JSON; the Frappe half defines the canon
  "requested_by": "hannah@acme.test",
  "to_party": "Brightside Cleaning Ltd", "to_address": "0x…",
  "amount": "125.50", "asset": "USDC", "department": "Finance" }
```

Answer: `200 {"approval_id": "apr_…", "approval_url": "http://localhost:8787/approve/apr_…"}`

`GET /approve/<id>` is the stand-in for the Capxul pop-up: it shows the payment and a Sign button.
`POST /approve/<id>/sign` sends the transaction as `requested_by`'s test key. The result reaches Frappe only through
`chain_event` (`payment_sent` from the log, or `payment_failed`).

## Sign-in (stand-in for Capxul's own sign-in)

Core serves a minimal OAuth2 / OpenID provider:

- `GET /oauth/authorize` shows a list of the test people to pick from (stand-in for the passkey)
- `POST /oauth/token`
- `GET /oauth/userinfo` → `{ "sub", "email", "name", "given_name", "family_name" }`

Client id `capxul-skeleton`, client secret `SKELETON_SECRET`. The Frappe half configures a Social Login Key for it
on each site. The browser reaches Core at `localhost:8787`; the bench container reaches it at
`host.docker.internal:8787`. If one Social Login Key cannot hold both, say so in FINDINGS and pick the smallest fix.

Test people live in `core/people.json`: `email`, `name`, and the anvil account each signs with.

## Creating an org (the one door)

```bash
node --experimental-strip-types spikes/skeleton/core/src/main.ts org create acme "Acme Trading Ltd" --admin hannah@acme.test
```

Core, in order: registers the org on the stand-in chain (which gives it a Safe stand-in holding test USDC and gives
the admin the `admin` hat); runs the Frappe half's script; then delivers the org's events from `seq` 1.

```bash
spikes/skeleton/frappe/bin/new-site.sh <slug> "<company name>" <safe address> <admin email>
# exit 0, last line of stdout: {"site":"acme.localhost","url":"http://acme.localhost:8000"}
```

The script creates the site with ERPNext, HR and the `capxul` app, the Company, a bank account that stands for the
Safe, the sign-in key and the app's settings. It must be safe to run again for the same slug.

Other CLI commands the Core half provides: `hat grant <slug> <hat> <email> [--department <name>]`,
`hat revoke …`, `events status <slug>`, `events resend <slug>`.

## Turning parts of the product on and off (added 10 November, Aaron)

Aaron: the opinionated product has the full CRM (Frappe CRM, with its WhatsApp integration), and what is turned on
for a company "should be programmatic also. This should be something that you do through the CLI as well."

```bash
node --experimental-strip-types spikes/skeleton/core/src/main.ts feature list <slug>
node --experimental-strip-types spikes/skeleton/core/src/main.ts feature on  <slug> <feature> --as <email>
node --experimental-strip-types spikes/skeleton/core/src/main.ts feature off <slug> <feature> --as <email>
```

- Features the skeleton knows: `accounts`, `people` (HR), `payroll`, `projects`, `crm`, `whatsapp`, `stock`,
  `manufacturing`. `whatsapp` needs `crm`.
- Only a wearer of the `admin` hat in that org may turn a feature on or off. Core checks the hat on the chain
  stand-in before it does anything; anyone else is refused with a reason.
- Core calls the Frappe half's script, the stand-in for the site service:

```bash
spikes/skeleton/frappe/bin/feature.sh <slug> list
spikes/skeleton/frappe/bin/feature.sh <slug> on|off <feature>
# exit 0, last line of stdout: {"site":"acme.localhost","features":{"accounts":"on","crm":"off", ...}}
```

- **Off never destroys data.** Off means nobody on the site can see or reach that part; turning it on again shows
  everything that was there. Uninstalling an app is not "off".
- On installs what is missing on that site (an app, its setup) and makes the part visible to the people whose hats
  give them a role in it.
- A new site starts with `accounts`, `people`, `payroll`, `projects` and `crm` on; `whatsapp`, `stock` and
  `manufacturing` off.

## The behaviours the skeleton must show

These become the first evals. Each is run by a script and prints pass or fail.

1. **An org is one command.** After `org create`, the site answers, the company and the Safe bank account exist, and
   the admin can sign in through the stand-in.
2. **Roles follow hats.** Granting a hat gives the person the mapped Frappe roles (and the department limit) within
   seconds; revoking removes them. Changing a person's roles by hand on the site is refused.
3. **Paying a document is the normal Frappe flow.** A Purchase Invoice, then a Payment Entry from the Safe bank
   account. The person submits (or presses Pay); it shows as waiting for a signature; they sign in the stand-in
   pop-up; the chain log lands; the Payment Entry is submitted, the ledger is posted, the invoice shows nothing
   outstanding and the entry carries the transaction hash.
4. **It stays true when broken.**
   - the signer lacks the hat: the chain reverts, the entry is not posted and shows why;
   - the same event delivered twice posts once;
   - Frappe is stopped when the log lands: after it starts again the entry posts once;
   - submitting a Safe-backed Payment Entry without the chain is refused;
   - a payment made on the chain with no Frappe document appears as an unmatched bank line (stretch).

## Rules for both halves

- No fork of Frappe, ERPNext or HR unless a hook cannot do it. If you fork, write exactly what and why in FINDINGS.
- Stand-ins are labelled as stand-ins in code and in FINDINGS: the contracts are not Capxul's v4, the pop-up is not
  the OpenFort iframe, the provider is not Capxul's auth.
- No real key, token or personal data anywhere. Anvil's published test keys only.
- Do not commit. Do not touch anything outside `spikes/skeleton/` (the Frappe half may add ignore lines for its own
  generated files to the repository `.gitignore`).
- FINDINGS is the deliverable: what worked through a hook, what needed a workaround, what would need a fork, what
  Frappe does that the design did not expect, and every number you measured (how long a site takes to create, how
  long a role takes to follow).
