# blueprint-check

`pnpm frappe:check-blueprint`: the site app and the blueprint must say the same thing. It compares the blueprint's
`doctype` and `role` records with the code and exits 1 on any difference; `pnpm test` runs it, so a difference fails
the merge.

- Every DocType under `capxul/capxul/doctype` against its `doctype` record (`blueprint/plugs/doctypes.ts`): its fields in
  order, each field's type, link, options, required, unique, read-only and default, its naming, single and child flags,
  and its permissions.
- `CUSTOM_FIELDS` in `capxul/setup.py` against the records of Frappe's and ERPNext's DocTypes.
- `DEFAULT_HAT_ROLES` in `capxul/setup.py` against the `role` records (`blueprint/plugs/hats.ts`).

`compare.ts` is pure and tested on fixtures (`check.test.ts`); `read_setup.py` reads `setup.py`'s literals without
importing Frappe. To change a DocType: change its record first (with a decision when it is a judgment), then the code.
