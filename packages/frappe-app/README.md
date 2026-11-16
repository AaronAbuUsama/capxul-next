# frappe-app

The Capxul app that lives on every company's Frappe site: a Frappe v16 app named `capxul`. No fork of Frappe,
ERPNext, Frappe HR or Frappe CRM; every join is a hook (`capxul/hooks.py`). The bench image copies it
(`packages/bench-image`).

Each module of [`capxul/`](capxul) says what it does in its docstring. What the api (`packages/core`) asks of a
company's site, through the bench's site service, is in `capxul/core_api.py`; the site API is `capxul/door.py`.

Names Capxul shares with the blueprint (the daily job, the site's vocabulary) are generated into `capxul/generated/`
by `pnpm generate`; never edit them.

`testutil.py` and `feature_experiments.py` are spike helpers run with `bench execute`, not part of the product.

## Checks

`tests/` holds fast unit tests that need no site: `frappe` is replaced by a small in-memory fake
(`tests/frappe_fake.py`). `pnpm frappe:test` runs them, and `pnpm test`, the unit-test rung, runs it.
