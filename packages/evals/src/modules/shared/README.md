# Shared integrations

`run.sh` proves the Shared integrations' failure modes (`int:<integration>.<call>/<CODE>`) inside a selected-stack run;
`evals/bindings/shared.json` binds its checks. It implements the runner's `--list` and `@check` protocol.

Every check first passes the same guard as the devnet runner: a private world configuration, the harness's running
`receipt.json` for `postgres-ponder-erpnext-v4`, the acceptance fixture for that concrete world, and a fresh live
`capxul world inspect`. Without them every check fails; no component run or older receipt counts.

The adapter under test is always the production one (`ChainRpc` from the backend's shared door, the bundler
provider from `packages/devnet/src/modules/bundler`). It talks to the selected world's own processes: its Anvil, its
supplied Alto, and the selected payment's real transaction and the UserOperation its paying Safe sent. Each check also makes a control call
that must succeed against the real process.

Provider failures come from `fault-gate.ts`, a run-local switch in front of one real endpoint: `pass` forwards the
exact request, `down` drops the connection, `timeout` holds it past the call's timeout, `throttle` answers 429,
`answer` replies without forwarding and `rewrite` alters the real process's answer. The gate counts what it received
and what it forwarded, so a check can prove attempt counts and that a send was never repeated. The bundler's
`TRANSACTION_FAILED` comes from the real Alto's own validation, not from the gate.

Per-check observations are written to `$CAPXUL_EVAL_RUN_DIR/shared/checks/<check>.json`. `shared.test.ts` checks the
retry policy and the gate without a world; it is not eval evidence.

Not here yet: the sponsor calls (Sponsorship's adapter), indexer, Mail, service-signer, devnet-control, FDE host,
Openfort, the two alerts, and every `/conformance` eval, which also needs the real service's credentials.
