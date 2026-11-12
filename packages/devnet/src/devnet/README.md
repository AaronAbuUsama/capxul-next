# Local-world supervisor

`packages/cli/src/devnet.ts` composes these host adapters behind the single `capxul world` CLI. It does not use the spike's JSON Core or snapshot registry. Prepare tools/images with `.agents/setup`; **do not start `capxul-stack` or run `amp orb services ensure` alongside this production-shaped layout**.

## Commands

```bash
source packages/devnet/orb/env.sh
pnpm capxul world init slicezero --config var/worlds/slicezero/config.json
pnpm capxul world create --config var/worlds/slicezero/config.json
pnpm capxul world provision harbourline --config var/worlds/slicezero/config.json
pnpm capxul world inspect --config var/worlds/slicezero/config.json --json
pnpm capxul world snapshot save checkpoint --config var/worlds/slicezero/config.json
pnpm capxul world snapshot read checkpoint --config var/worlds/slicezero/config.json
pnpm capxul world snapshot restore checkpoint --config var/worlds/slicezero/config.json
pnpm capxul world stop --config var/worlds/slicezero/config.json
pnpm capxul world up --config var/worlds/slicezero/config.json
pnpm capxul world run slice-zero --slug harbourline --config var/worlds/slicezero/config.json --json
```

`init` creates a mode-0600 configuration and fresh MariaDB/site-service credentials. It needs the four development database URLs from `orb/env.sh`; runtime children never receive `PG_ADMIN_URL` or the operator's signing key. Every world uses a separate database, bench Compose project, directories and ten consecutive loopback ports (default 18000; `CAPXUL_WORLD_PORT_BASE` chooses another range before init). One Postgres 17 container is shared per host. Existing foundation containers must not already occupy that Postgres port. Secrets, cookie jars and raw failed-command output remain under the private `var/worlds/<id>` directory, not in receipts or git.

`create` alone creates/migrates the database and binds the indexer views. It copies the native seeded Anvil state, deploys test currency, writes the static deployment manifest and prepares historical blocks before installing the stopped authority clock. It then starts the real services. `up` and all restore paths **never migrate**. A creation or restore pending marker fails closed. Unknown payment outcomes require inspecting the existing approval; the CLI does not create a replacement spend.

The configuration and process receipts pin the checkout commit. Commands other than `stop` refuse a different checkout, and startup refuses to reuse a process from another build. Use the matching checkout for a retained world or snapshot; do not relabel an old running process as evidence for newer source. Stop remains available when the checkout changes.

Startup is backing databases/Redis and production bench → Anvil → ready Ponder → optional bundler → site service → paused Core → authenticated Core resume/ready → ingress. Amp owns foreground service lifetimes as `world-<id>-<component>`. A successful `up` exits while these supervised services continue. `stop` closes/drains ingress, pauses Core and gracefully stops every world writer; MariaDB/Redis/Postgres data remain. Bench containers use init with process-group signal forwarding rather than relying on PID 1's default signal handling. A failed component stop does not skip the others. PID birth-time and clean-exit receipts prevent a forced-killed Anvil process from being called a safe snapshot cut.

Private service ports must never get portals. Only the fenced ingress ports (`publicCore`, `publicBench`, `publicRpc`, optional `publicBundler`) may be exposed to trusted local-world users. Core `/admin/*` is not forwarded. The HTTP gateway drains mutations, drops WebSockets and closes all entrances together during recovery. This is a trusted-host local development supervisor, not a production network-security boundary.

## Recovery

Save/read/restore delegate to `devnet/door.ts`, `composeBench` and `localRuntime`. Recovery stops all bench writers and performs native encrypted backups/restores offline, while MariaDB/Redis remain up. It snapshots the real Postgres template, native Anvil history, deployment, sites and site-service intents. The store adapter restores authority `clock.json` and closes restricted pools before database cloning. Source `CAPXUL_SECRET` and site encryption keys are preserved; clone MariaDB credentials are fresh. Offline callbacks set the target site's public origin and rebase saved approval links to the target public Core origin in both stores, without restoring legacy server-to-Core wiring. No implicit rekey or schema migration occurs. Only a stopped authority clock is supported here; no running-clock pump is claimed.

For a clone, initialize a different id/port range, then use:

```bash
CAPXUL_WORLD_PORT_BASE=18100 pnpm capxul world init clone --config var/worlds/clone/config.json
pnpm capxul world snapshot restore checkpoint --as var/worlds/clone/config.json --config var/worlds/slicezero/config.json
```

The target must share the source snapshot root, code version and Postgres host. World ids, database names, ports, site names and state directories remain distinct. Snapshots are host-local database templates, not portable exports. A failed restore stays fenced with its marker and abandoned database retained for inspection; there is no automatic destructive reset.

## Slice-zero execution and supplied bundler

Provisioning births/installs the company on v4, grants the founder's personal Safe the shipped admin hat and registers one directory row containing both signing EOA `address` and `personalSafe`. The public signed `org site provision` command then creates/releases the site. Independent bench reads verify Company, Safe-linked Account/Bank Account and the first acknowledged stream/hat user; provision success alone is not readiness.

The config's optional `bundler` is supplied, not invented: `{argv:[executable,...args],url:"http://127.0.0.1:<port>",env:{...},paymaster:"0x..."}`. The command must run in the foreground. Readiness requires `eth_supportedEntryPoints` to include v0.7. The deployed/funded paymaster and alto version/config/start recipe belong to Aaron; missing inputs fail before fixture creation. Slice execution uses the existing Claude `payByUserOp`/`viaBundler` exports directly. `viaBundler` takes a signed PackedUserOperation, not a Core approval. The adapter maps the real collected approval into `payByUserOp`, and requires both the mined transaction hash and a successful real UserOperation hash. It never calls `pay` or `viaEntryPoint` as a substitute.

`world run slice-zero` makes a real submitted invoice/draft payment, requests it as the indexed hat user, waits for Core's asynchronous approval, submits via the supplied bundler, checks posting/reconciliation, then saves/reads/restores through native recovery. It mints a native one-time Frappe login for that non-Administrator user after restore. The generated acceptance fixture includes real snapshot/read+replay and reversible Ponder, >300-second delivery and parked-money fault commands. Faults leave the accepted payment untouched; parked-money repair targets the same retained event key.

The gate regenerates `blueprint:slices --journey thin_line --json` and selects **all** `.slices.find(s => s.id === 'slice-0').required`, never the 13-claim floor or a copied ID list. It delegates once to `pnpm evals -- <IDs> --world slice-zero --environment <metadata.json> --json`. Success requires `passed:true`, a complete matching-environment receipt, fresh same-run verdicts for every requested ID, no `fail`/`not_run`, and source-equality captures for all four screens. The eval runner alone writes receipts/scoreboard. Missing bundler inputs, unsupported world bindings, failed preflight or incomplete evidence are not slice success.

The internal `world fixture load|seed|repair` commands are for that disposable acceptance run. Load requires the committed resend baseline to include a payment event, then waits for every same event key/sequence to gain another attempt, a new applied timestamp and an ACK-backed applied state without error. It does not restore again or replace the selected payment. A private operation lock serializes recovery and the gate; only its token-bearing nested fixture and inspection commands may enter while the gate owns it. Raw failed subprocess output, when present, is in `last-error.log`; runtime logs are `amp orb service logs world-<id>-<component>`.

## Concept-runner inputs

Every selected concept runner receives `CAPXUL_WORLD_CONFIG` (the absolute private config path), `CAPXUL_ACCEPTANCE_FIXTURE` (the absolute post-restore fixture path), `CAPXUL_SECRET` (Core's diagnostic signing secret), `CAPXUL_WORLD_RUN_TOKEN` (the private nested-command token) and the harness's `CAPXUL_EVAL_RUN_DIR`. The acceptance fixture follows `packages/evals/src/modules/acceptance/fixture.ts`; the real config and cookie jar stay private and must not be copied into evidence. Runtime and fixture identities, rather than separate component-proof files, are the assertion inputs.

`world inspect --config "$CAPXUL_WORLD_CONFIG" --json` is read-only and fails unless the pinned foreground processes, public Core readiness, actual database/world/epoch/clock, public Anvil chain and six production bench processes agree. Its JSON has `version`, `observedAt`, `codeVersion`, `stack`, `world:{id,epoch,kind,database,sites}`, `clock`, `lineage`, `records:{seq,head}`, `components:{<name>:{pid,birth,codeVersion}}`, `core` (the actual readiness response), `chain:{chainId,blockNumber,blockHash}`, `bench:[{service,image,running,health}]` and `bundlerConfigured`. The chain number is a decimal string. These are live sequential observations, not an atomic recovery cut, per-eval pass or completed journey receipt. An absent bundler remains explicitly absent.

Trusted bench execution uses argv `['docker','compose',...config.bench.composeArgs,'run','--rm','-T','--no-deps','site-admin','bench','--site',site,'execute',method,'--kwargs',JSON.stringify(kwargs)]`, working directory `config.root`. The explicit private Compose env file is already in `composeArgs`; never serialize credentials as argv. `bench()` and `asPerson()` in `fixture.ts` expose the same native/admin-read and signed hat-user boundaries. Chain identity registration uses private authenticated `POST /admin/org` with the fixture company/Safe/token, named hats and people containing both EOA `address` and `personalSafe`; public provisioning is then the signed `org site provision` CLI.

No new public `doc create`, `doc submit` or `report run` door is provided here. Bench fixture creation cannot prove those CLI claims. The current payment/recovery preparation precedes the running eval receipt; there is no same-run journey proof file to credit for `jrn:thin_line` or `fun:thin_line`. Those claims remain unproved until their owner supplies actual same-run assertions. The eval runner's `receipt.json`, sibling `status.json` and retained per-concept evidence under `CAPXUL_EVAL_RUN_DIR` remain the only composed scoring contract.
