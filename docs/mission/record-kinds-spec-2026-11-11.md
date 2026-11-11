# New record kinds: a specification

11 November 2026. Written for the engine work in the "Move the blueprint into infrastructure" thread (branch
`claude/project-thread-1qyi8y`), which adds the kinds to `packages/blueprint-engine`. Once the kinds land, the records under
`blueprint/` are written on top of them. This document changes no code.

**Why.** Aaron ruled at 18:49 UTC: "Everything should be a record. So if we have under specified, then we need to fully
specify as well." Product analytics, logs, alerts and dashboards become records. At 18:49:46 he added screens: they are in
the fan-out, starting with the Frappe screens, because they are where he sees the data and the evidence.

**Where the material comes from.** The old repository is a reference for behaviour, not for code. Its observability
package (`packages/observability/src/catalog`) and its analytics sync (`packages/tools/src/modules/analytics`) hold:
- 88 product event names;
- 6 launch journeys and 9 catalogue funnels;
- about 45 insights;
- 2 owned dashboards (`product_pulse`, `bank_payouts`);
- reliability, silence and host alerts;
- one wide log row per backend operation (`capxul_backend_operation`);
- expected-outcome twins of `$exception`.

None of it is ported. It shows what the rebuild has to say about itself. The producers change, because the target runs on
Frappe sites and the Core service.

## Rules every new kind follows

These come from the engine's own lessons.

- **Ids are named, never positional.** An eval id is built from names (`alr:payout_stuck/fires`), never from the place
  of a line in a list. This is the positional-id fix, applied from the start.
- **Links go down.** A new kind names what it reads or shows. The build works out who reads it.
- **Each claim derives an eval, and each silence is a gap.** A record that nothing reads, or a failure that nothing watches,
  is a gap with a rule id, so the portal can count it.
- **Evidence is kept.** An eval on a screen or a dashboard keeps a screenshot or the rows it returned, under
  `status/runs/<run>/evidence/`, just as checks keep text today.

## 1. Product analytics events: extend `event`, don't add a parallel kind

Today `event` holds only state-machine events (`<machine>_transitioned`, one per machine, policy P7). Product analytics needs
the other events too: point observations, failures and operator signals (for example `bank_deposit_returned`,
`ui_route_wait_observed` and `indexer_drift_corrected`).

The proposal is one event kind with a purpose, so there is one catalogue:

| Field | Holds |
|---|---|
| `purpose` | `transition` (the current events), `product` (a funnel or behaviour signal), `failure` (an expected failure the product watches) or `operator` (a health signal, which no funnel reads) |
| `producer` | the record that sends it: a transition (already), an rpc, flow, workflow, procedure, integration call or **screen** |
| `properties` | an Effect Schema, merged with the shared **envelope** (see below) |
| `pii` | the property names that hold personal data; anything else must be free of PII |
| `groups` | the analytics groups it attaches to (person, organization) |

The **envelope** is one record per system, of kind `envelope` or a field on `system`. It holds the properties every event
carries: `capxul_env`, `trace_id`, producer, world id, org id. The old system made `capxul_env` required and treated
`unknown` as a defect. Keep that.

**Build rules:**
- A problem when an event has no producer, or a producer that does not exist.
- A gap `unread-event` when no journey, insight or alert reads a product event.
- A gap `unwatched-failure` when no alert reads a failure event, unless a decision states why.

**Evals:**
- `evt:<op>/<event>` stays as it is.
- New, per event:
  - `ana:<event>/schema`: sent with its properties and the envelope, valid against both;
  - `ana:<event>/pii`: no personal data outside the declared fields.

**Journeys and funnels.** No new kind is needed. Add two fields to `journey`:
- `finish`: the outcome in plain words;
- `variants`: the breakdown properties. The old catalogue had them, and `journeys.variants` already decided which survive.

The existing `fun:` eval then covers the funnel, and a dashboard tile can name the journey.

## 2. `log`: log rows and their fields

| Field | Holds |
|---|---|
| `id` | for example `operation_row`, the wide row every operation writes |
| `service` | the component that writes it (Core service, a site, the CLI, the indexer) |
| `level` | info, warn or error |
| `per` | `rpc`, `workflow`, `procedure`, `call` or `once`: the engine derives a row for every record of that kind |
| `attributes` | an Effect Schema: ids, outcome, durations, failure row |
| `redact` | the attributes that are masked |

**Build rules:**
- A problem when an attribute named by an insight is not in the schema.
- A gap `unlogged-operation` when an rpc or workflow writes no row.

**Evals:**
- `log:<id>/<record>/written`: the row is written once per call, with every attribute;
- `log:<id>/redacted`: no masked value appears.

**`metric`** goes with it: counters, gauges and histograms. Its fields are name, unit, instrument, attributes, the producer
and the service. Host gauges such as CPU belong to `environment`. The eval is `met:<id>/emitted`.

## 3. `insight`: a question asked of the telemetry

| Field | Holds |
|---|---|
| `reads` | the events, logs and metrics it queries (links) |
| `query` | the query text, with `<env>` as a parameter, or a structured funnel or trend |
| `display` | number, line, table or funnel |
| `env` | the environments it is meant for |

**Build rule.** A problem when the query names an event, log or attribute it does not list in `reads`, or one that does not
exist. This is the old sync's drift check, done at build time instead of in production.

**Evals:**
- `ins:<id>/runs`: on a seeded world, it returns rows of the declared shape;
- `ins:<id>/answers`: on the thin-line world, its value equals the known answer (for example, one payment settled).

## 4. `dashboard`

| Field | Holds |
|---|---|
| `audience` | Aaron, an operator, or a company (a Frappe workspace) |
| `where` | PostHog, a Frappe workspace, or the portal |
| `tiles` | insights or journeys, in order |

**Evals:**
- `dsh:<id>/synced`: the live dashboard equals the record. This is the old `analytics sync --check`.
- `dsh:<id>/shows`: opened, every tile renders a value, and a screenshot is kept.

## 5. `alert`

| Field | Holds |
|---|---|
| `insight` | what it evaluates |
| `condition` | a bound or threshold, with its window (for example 5 starts and a failure rate of 20% or more) |
| `cadence` | how often it is evaluated |
| `severity` | page, notify or log |
| `route` | who is told and how: Aaron, an operator, or a company's Director |
| `runbook` | what to do: an operation, or text |
| `silence` | when not to fire: a world being restored, the sandbox |

**Build rules:**
- A problem when an alert has no runbook or no route.
- `unwatched-failure` (above) is the coverage rule.

**Evals:**
- `alr:<id>/fires`: a world with the fault seeded (from `stays_true_when_broken`) fires it exactly once, to the route;
- `alr:<id>/quiet`: a healthy world under load does not fire it;
- `alr:<id>/clears`: when the fault is repaired, the alert clears.

## 6. `screen`: what a person sees

Frappe Desk comes first. The web app uses the same kind later, with a different `surface`.

| Field | Holds |
|---|---|
| `surface` | `frappe-desk`, `frappe-portal` or `web` |
| `kind` | form, list, report, workspace, page or print format |
| `doctype` | the Frappe DocType or table it is about (see "Other gaps") |
| `shows` | each value it shows and where that value comes from: a table field, a chain function or event, a ledger account, or an insight |
| `actions` | buttons and what they run: an operation, a door call or a Frappe workflow action |
| `who` | the roles or hats that can open it; everyone else is refused |
| `states` | for a record with a state machine, what the screen shows and allows in each state |
| `feature` | the part (feature switch) it belongs to: when the part is off, the screen is closed |

**Build rules:**
- A problem when an action names nothing declared, or a value has no source.
- A gap `unseen-table` when a table a person owns has no screen, unless a decision says it is internal.

**Evals:**
- `scr:<id>/shows`: opened as a role in `who` on the thin-line world, every value equals its source (for example, the
  Payment Entry shows the transaction hash that is on chain), with a screenshot kept;
- `scr:<id>/refuses`: a person outside `who` cannot open it;
- `scr:<id>/action/<name>`: the button runs its operation and the screen then shows the new state;
- `scr:<id>/off`: with its part switched off, it is closed.

**Journeys** gain an optional `seen` on each step: the screen where the person sees the result. `jrn:` then also keeps
those screenshots, so a passing journey can be watched as a sequence of pictures.

## 7. Live checks, which give the portal's "done" a meaning

The portal's stand says "done" only when an operation's `live:` evals hold, but no `live:` eval is derived, so nothing can
reach done. Alerts and insights close this.

The proposal: derive `live:<alert>:<op>` for every alert whose insight reads an event or log the operation sends, evaluated
on the shared world on the machine. An operation is then done when:
- every one of its L1 evals passes;
- its alerts are quiet on the shared world;
- each of its alerts has fired at least once on a seeded fault.

**This is Aaron's to confirm**, because it defines "done".

## 8. Other gaps found on the way

These are the same kind of under-specification. They are listed so they get a kind or a stated reason, not built here.

| Not yet a record | Today | Suggested |
|---|---|---|
| Frappe DocTypes (Capxul's 7 custom ones, and the ERPNext ones it relies on: Payment Entry, Purchase Invoice, GL Entry, Company) | Code in `packages/frappe-app`; the door reads them at run time | `table` with a `store: frappe` field, or a `doctype` kind, so screens and rpcs link to them |
| Roles and permissions (hat to Frappe role) | The `capxul_hat_role` and `capxul_hat_map` DocTypes | A `role` kind that screens' `who` and tables' admissions name |
| Feature switches ("parts") | The `capxul_feature` DocType, plus decisions | A `feature` kind that screens, rpcs and DocTypes belong to |
| Messages sent to people (email, WhatsApp, notices) | The `notices` concept has tables, but no templates | A `message` kind: channel, template, trigger, recipients; evals that it is sent once and renders |
| Settings and secrets a site needs | `capxul_settings`; environment files | A `setting` kind: who sets it, its default, whether it is a secret; an eval that no secret leaks into evidence |
| Expected-outcome and exception events | The old system's `$exception` twins | Covered by `event` with purpose `failure`, plus a `log` row |

## 9. Order

1. `event` purpose and envelope, `log` and `metric`. Everything else reads them.
2. `insight`, `alert` and `dashboard`.
3. `screen`, with the Frappe DocType question settled first. A screen needs something to link to.
4. Live checks, once Aaron confirms what "done" means.

Then the records for the thin line first, so every new kind is proven once end to end on the 12 tests before the fan-out
copies the pattern.
