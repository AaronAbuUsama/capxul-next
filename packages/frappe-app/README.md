# frappe-app

The Capxul app that lives on every hosted Frappe site (component `frappe-app`, `blueprint/shared/foundation.ts`). A Frappe
v16 app named `capxul`: no fork of Frappe, ERPNext, Frappe HR or Frappe CRM, every join is a hook.

Moved here from `spikes/skeleton/frappe/capxul` (plan task `m2-graduate-spike`, first slice) without a change of
behaviour; its Python import path and whitelisted method names are the same (`capxul.api.chain_event`, `capxul.door.*`).
The test stack mounts it from here (`spikes/skeleton/frappe/compose.yml`); the production image copies it
(`packages/bench-image`).

| Module | What it does |
|---|---|
| `capxul/setup.py` | install and site-creation setup: the wizard, the Safe's bank account, the sign-in key, the hat map, the CRM link |
| `capxul/api.py` | `chain_event`: applies Core's ordered chain events once each (hats, payments) |
| `capxul/hats.py` | hat events create and change Users and their roles; a hand edit of a role is refused |
| `capxul/payments.py` | a Payment Entry from the Safe is held until the chain confirms; ledger hooks refuse any other credit to the Safe |
| `capxul/door.py` | the door: whitelisted methods that run a call as the calling person |
| `capxul/features.py` | feature switches (Capxul Feature rows) and the request guard that answers 403 for a part that is off |
| `capxul/brand.py`, `capxul/privacy.py` | the names-only rename and nothing reporting usage outward; run after every migrate once setup is complete |
| `capxul/clock.py`, `capxul/world.py` | the world clock on the site, and a site's names in a restored world |

Spike leftovers still here: `testutil.py` (helpers for `spikes/skeleton/frappe/bin/test-frappe.sh`) and
`feature_experiments.py` (the trials behind the feature switches). What is still the spike's and not this package's: the hat-to-role map is a DocType a site can edit (the blueprint says
it ships inside the app and is not editable on a site), and the site is created by `spikes/skeleton/frappe/bin/new-site.sh`
(the site service, `component site-service`, is not built yet).

Proven by the end-to-end script `spikes/skeleton/run.sh` and the evals bound to it (`evals/bindings/sites.json`).
