# Books selected-stack checks

`bash run.sh --list` needs no fixture. Normal execution needs the supervisor's private `CAPXUL_WORLD_CONFIG`, the post-restore `CAPXUL_ACCEPTANCE_FIXTURE`, the harness-owned running `CAPXUL_EVAL_RUN_DIR` and `CAPXUL_ACCESS_ACTORS`. `door.ts` refuses anything but one fresh running receipt on `postgres-ponder-erpnext-v4` whose requested IDs equal the dynamically regenerated slice-0 selection, with the receipt commit equal to `HEAD` and the world's code version. It uses only the restricted `capxul_core` and `capxul_worker` roles, never migrates, provisions, restores or uses admin, and saves its sanitized reads under the run's `books/`. Any failed prerequisite fails every requested check; nothing is skipped or substituted.

`CAPXUL_ACCESS_ACTORS` is a private (0600) file that receipt-first public sign-in writes after restore: `{version:1, run:{id,at,commit}, world:{id,epoch}, actors:{ordinarySeat,books,outsider,person,agent}}`, each actor `{principalId,bearer,kind,safe}`. This runner never creates sessions. The producer is a cross-lane preparation contract that is not yet published.

What each check reads:
- Schema: live introspection compared with contracts declared independently from `blueprint/books/data.ts`, not parsed from the migration.
- Tenancy: a second real company against an actual persisted row.
- Writers: SQL writers are confined to the concept, plus the behaviour that writes. Facts also need restricted update and delete to be refused.
- Atomicity: reverse and re-record on the retained settlement inside one rolled-back caller transaction, then an inert committed replay. The original payment and GL are unchanged.
- Transitions: real public personal saves, read back as the persisted row and exactly one common-outbox event.
- Vendor budget and spans: twenty real public saves on separate chain-proven money, the native Account read and the retained RPC→provider spans.

`rpc:books.annotations.save/errors` stays a near-miss until the fixed Books-hat authority exists. `save.ts` fails closed (`FEATURE_NOT_AVAILABLE`) for Organization memo-only and new-account saves, and for native Party or allocated-document paths.
