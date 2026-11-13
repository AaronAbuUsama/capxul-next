# The thin line: twelve operations, as the old blueprint records them

This page is the input for roadmap step 1.1 ([docs/roadmap.md](../roadmap.md)): declaring the thin line as an Effect contract.
It is extracted, not designed. Every statement comes from a file named under **Source**. Claims and refusals are quoted word for word.
It was read from `master` at commit `92ac4f2`, with the old blueprint built by `pnpm blueprint`. The same content, for a program to read, is in [operations.json](operations.json).

## How to read it

- The twelve operations are in the journey's order (`journey:thin_line` in `blueprint/sites/thin-line.ts`; one test per step in `evals/thin-line.md`).
- **Payload** lists every input. The first column is the field of the record's input; the second is how the command line spells it. `unknown` means no record, example or text states it.
- **Refusals** are the errors the operation record gives a starting world and a `when`. **Other declared errors** are codes the operation or what implements it lists without either.
- **Claims** are the acceptance lines. The one marked *thin line* is the step's primary test in `evals/thin-line.md`.
- **Events** are the events reached through `implementedBy`: its own, those of the transitions it drives, of the procedures it invokes and of its steps' rpcs. This is the rule the old engine used (`packages/blueprint-engine/src/evals.ts:34`).
- **Budget** is system time for the whole command. The old engine excludes a person's wait and chain confirmation by span name (`packages/blueprint-engine/src/records/base.ts:117`).
- **Touches** says which parts of a world must exist for the call to run: the database, the chain, the index, a Frappe site, the clock, a snapshot store. A seventh row, signing, is added because three operations cannot run without a signature that is sponsored and sent to the chain.
- **Doubts** are places where the old record is contradictory, stale against the roadmap's decisions, or silent.

For every operation the old engine also derived these checks (`packages/blueprint-engine/src/evals.ts:49`):

- ret: a success prints exactly the returns schema with --json
- ref (one per refusal): from <starting world>, it refuses with <error>, its exit code and shape, and changes nothing
- evt (one per event): it sends <event>, valid against its schema, carrying trace_id
- spn: one trace from the CLI command through the SDK to the server, with every declared span
- bud: end to end, p95 ≤ <p95> ms and p50 ≤ <p50> ms over N warm runs

## Doubts that apply to all twelve

1. The old error codes are one shared list of upper-case codes, each with a CLI exit code (`blueprint/shared/vocabulary.ts`). The spike contract declares a typed refusal per operation with its own fields (`DuplicateEntry { key }` in `spikes/pipeline/contract/record.ts`). The old records do not say which fields a refusal carries: only some examples show a `details` object.
2. The old events are state-change events (`<thing>_transitioned` with `from`, `to`, `transition` and ids). The spike contract says a successful call emits each declared event exactly once, and that what it carries is a pure function of the payload and the result (`spikes/pipeline/contract/operation.ts`). Several old events carry values that are in neither (for example `epoch`, `kind`, `person_id`, `nonce`), and several are sent only on one branch of the operation.
3. Every refusal names a starting world (`given`). In the old blueprint these are named snapshots built by a local supervisor's builder script (`blueprint/devnet/worlds.ts`). The roadmap makes a world an Alchemy deployment with a Neon branch, and step 0.9 speaks of a template world. Five of the 20 starting worlds the twelve name are not in the old catalog at all (see the list near the end).
4. The old records speak of two places a world runs: a local devnet on one machine ("anyone on the machine") and a hosted service. Roadmap rule 5 says a world never lives on the agent's own machine, and the roadmap names three grades (private, shared, real) where the old `kind` is local, simulated, staging or production.
5. The twelve steps do not include the operations that make their own starting state: signing in, claiming a personal Safe, inviting and seating a member, seating a second Director, approving a proposal. `evals/thin-line.md` says the run starts from an empty world.
6. `CLI_USAGE` is listed as a refusal or an error of every one of the twelve. It is a fault of the command line, raised by the CLI before any call reaches the door.
7. The old budgets are a pair (p50, p95) per class, measured end to end at the CLI (`packages/blueprint-engine/src/budgets.ts`). The spike contract holds one number, `budgetMs`, measured on the server.
8. The door's operations (`doc.*`, `report.*`) and `org.member.grant` do not say how the world is named on the command line. `evals/thin-line.md` says to keep the world id in every command. Only the `world ...` and `record ...` commands take a world, and `org create` by a decision that no record carries out.

## 1. `world.create`

### Operation

- Operation: `world.create` (Make a whole world)
- CLI command today: `capxul world create`
- Concept that owns it: devnet (the old record's area: devnet)
- Who may call it: "The world's owner: on a local devnet anyone on the machine; on a hosted world the holder of an organiser grant."
- What it changes: "One world, creating; its creation process makes the chain, service, clock, record and stand-ins and the world becomes running."
- Implemented by: rpc devnet.worlds.create
- In the journey: step 1, run as operator; primary test `acc:world.create/c-52e22ec1e2a6c1cc`

### Payload

Read from: The `about` of the operation record, the rpc input `devnet.worlds.create`, the examples and the first acceptance line.

| Input | On the command line | Type | Required | Note |
|---|---|---|---|---|
| worldId | `<world>` (the word after `world create`) | string: lower-case letters and digits, no hyphen, at most 12 characters | yes | Examples: `town`, `town2`. The length and the hyphen rule are in the INVALID_INPUT refusal and the file header. |
| name | unknown | string | yes in the rpc input | No example or text shows a flag for it. The examples' result of `world show` has `name` equal to `worldId`. |
| kind | `--kind local\|simulated\|staging\|production` | one of those four | no at the CLI (default `simulated` on the hosted service, `local` on a laptop); required in the rpc input |  |
| profile | `--profile core\|full` | one of those two | no at the CLI (default `core`); required in the rpc input |  |
| template | `--template <name>` | string or null | no | Examples: `empty`, `town-of-four@m3`. |
| clock | `--clock frozen\|running` | one of those two | required in the rpc input; the CLI default is unknown |  |
| rate | `--rate <1 to 60>` | number | required in the rpc input; the CLI default is unknown |  |
| startAt | `--start-at <date>` | string (a date; the claim uses `2020-01-01T00:00:00Z`) | no |  |
| ownerApproval | unknown | string or null | only for `--kind production` | The claim says "with the owner's one-time approval it is accepted"; no flag is shown. |
| json | `--json` | boolean | no | Global flag of the old CLI (`blueprint/baseline/flags.ts`, globalFlags): "Print a versioned JSON result". Every example passes it. |

The input of rpc devnet.worlds.create, as the record declares it:

```
{ worldId: string, name: string, kind: "local" | "simulated" | "staging" | "production", profile: "core" | "full", template: string | null, clock: "frozen" | "running", rate: number, startAt?: string, ownerApproval: string | null }
```

Example commands in the record:

- `capxul world create town --template empty --clock frozen --json` (succeeds; "Make the world town with a frozen clock")
- `capxul world create town2 --profile full --template town-of-four@m3 --clock frozen --json` (succeeds; "A full world with its companies' sites")
- `capxul world create town3 --profile full --clock frozen --json` (refused: CAPACITY_REACHED, exit 6; "The machine has no room for another full world")
- `capxul world create live --kind production --profile full --json` (refused: ROLE_PERMISSION_DENIED, exit 4; "Production without the owner's approval")
- `capxul world create town-1 --template empty --clock frozen --json` (refused: INVALID_INPUT, exit 2; "The world name has a hyphen")
- `capxul world create town --template empty --clock frozen --json` (refused: NOT_AUTHENTICATED, exit 3; "Signed out")

### Result

What a success prints with `--json`:

- `worldId`: string
- `state`: "creating"

### Refusals

1. `NOT_AUTHENTICATED` (exit 3), from the starting world `signed-out`:
   > No one is signed in on this machine (a hosted world needs a grant).
2. `INVALID_INPUT` (exit 2), from the starting world `empty-devnet`:
   > The id has a hyphen or a capital, is longer than 12 characters, or is taken; or the template is not saved here.
3. `CAPACITY_REACHED` (exit 6), from the starting world `empty-devnet`:
   > The worlds machine has no room for another world of this profile.
4. `ROLE_PERMISSION_DENIED` (exit 4), from the starting world `org-with-member`:
   > Production was asked for without the platform owner's approval; nothing is made.

Other declared errors, with no starting world and no `when`:

- `CLI_USAGE` (exit 2): declared by the operation's own `errors` (raised by the CLI)
- `WRONG_ENVIRONMENT` (exit 2): declared by rpc devnet.worlds.create
- `PROVIDER_ERROR` (exit 5): declared by rpc devnet.worlds.create

### Claims

1. "A fresh world can begin before host time, but an existing world's time cannot be reset."
   - Observes: "cli: `world create past1 --clock frozen --start-at 2020-01-01T00:00:00Z`; `world show past1` prints that worldNow, matching its chain head. Repeating creation with past1 exits INVALID_INPUT and leaves its clock unchanged."
   - Test id: `acc:world.create/c-fc7bfdea5dd33f3e`
2. *(thin line)* "A new world runs with its clock and a record that begins with its birth."
   - Observes: "cli: from `empty-devnet`, `world create town1 --template empty --clock frozen --json` prints creating; `world show town1` then prints running, clockMode frozen, epoch 1 and recordHead 1; `record list --world town1` lists one `born` entry."
   - Test id: `acc:world.create/c-52e22ec1e2a6c1cc`
3. "A `full` world gives each company a site on its own address and a `core` world gives none."
   - Observes: "cli: from `empty-devnet`, `world create core1 --profile core` then `world show core1` lists no company site; `world create full1 --profile full --template town-of-four@m3` then `world show full1` lists four sites at `<company>-full1.<base>`, each answering."
   - Test id: `acc:world.create/c-51839d5bf812fa32`
4. "Production is never made without the platform owner's approval."
   - Observes: "cli: `world create live --kind production --profile full --json` exits ROLE_PERMISSION_DENIED and makes nothing; with the owner's one-time approval it is accepted."
   - Test id: `acc:world.create/c-4ee06f2f1dd89e20`
5. "A world made from a template starts with the template's companies on their own addresses."
   - Observes: "cli: `world create town2 --template town-of-four@m3 --clock frozen`; `world show town2` lists the four companies at `<company>-town2.<base>`, each answering; the born entry names no parent."
   - Test id: `acc:world.create/c-43a66f24b447122c`

### Events

| Event | Transition | Sent by |
|---|---|---|
| `world_transitioned` | `world.create` (birth to creating) | rpc devnet.worlds.create |

What each event carries:

- `world_transitioned`: `{ from: "creating" | "running" | "stopped" | "restoring" | "parked" | "closed" | null, to: "creating" | "running" | "stopped" | "restoring" | "parked" | "closed", transition: "create" | "start" | "stop" | "resume" | "restore" | "restored" | "park" | "close", world_id: string, kind: "local" | "simulated" | "staging" | "production", epoch: number }`

The call drives one transition, `world.create`. The world becomes running later, in the background process, which drives `world.start`.

Started by this operation and running after it answers (their events are not part of the call):

- process `devnet.worlds.create` ("Bring a new world up: chain, service, clock, record, stand-ins"), started after rpc devnet.worlds.create; it drives `world.start`, sending `world_transitioned`

### Budget

- The operation: class `background`, p50 2,000 ms, p95 15,000 ms
- The rpc devnet.worlds.create it runs: class `write`, p50 700 ms, p95 1,500 ms

### Touches

| Part of a world | Needed |
|---|---|
| database | yes: it writes the `worlds` row and the record's `born` entry (`command-records`) |
| chain | yes: its background process makes the chain, deploys the contracts or restores a template's chain state |
| index | not named: the record says "the service" |
| Frappe site | only with `--profile full` and a template that has companies |
| clock | yes: `--clock`, `--rate`, `--start-at`; the first claim reads the clock back |
| snapshot store | only with a `--template` saved from a snapshot |
| signing | no |
| also | The stand-ins (mail sink, Bridge, prices) and the people's and agents' keys, made by the background process `devnet.worlds.create`. |
| must exist first | Nothing. It is the first step. |

- Tables read: worlds (devnet)
- Tables written: worlds (devnet), command-records (devnet)
- Outside calls: none
- Contract functions named: none

### Source

- `blueprint/devnet/world-ops.ts:20`: the operation record
- `blueprint/devnet/world-rpcs.ts:42`: implemented by rpc devnet.worlds.create
- `blueprint/devnet/world-rpcs.ts:41`: the rpc: input, output, tables, transition
- `blueprint/devnet/world-processes.ts:12`: the background process that brings the world up
- `blueprint/devnet/world-data.ts:125`: the world's states and transitions
- `blueprint/devnet/world-examples.ts:68`: examples
- `blueprint/devnet/world-data.ts:113`: event world_transitioned
- `evals/thin-line.md:24`: the journey step and its primary test
- `blueprint/sites/thin-line.ts:11`: the journey record

### Doubts

1. The roadmap says `capxul world create` is a deploy of one Alchemy stack per world, with a Neon branch for its database. The old record asks a supervisor on a machine to make the world, and returns `creating` at once while a background process (timeout 180 s) brings it up. Whether the new operation answers before the world runs is not settled by either text.
2. Roadmap rule 2 says every world has an owner and an expiry. The old payload has neither.
3. The refusal CAPACITY_REACHED is about one machine having no room ("The worlds machine has no room for another world of this profile"). The roadmap gives each world its own stack on Cloudflare and Neon, and names a site quota per world, not a machine's room.
4. `kind` (local, simulated, staging, production) and `profile` (core, full) do not match the roadmap's three grades (private, shared, real). The roadmap also says a world whose change touches the Frappe app brings its own bench, and that each world holds a token for site creation: the old payload and result carry none of this.
5. Two of the five claims need a template and company sites (`town-of-four@m3`, sites at `<company>-<world>.<base>`), and one is about production. The thin line's own claim is the second one only.
6. The rpc input requires `name`, but no CLI flag for it is written down.
7. The operation's budget (p95 15,000 ms, class background) covers the call that answers `creating`. The record gives no budget for the time until the world is running.

## 2. `org.create`

### Operation

- Operation: `org.create` (Create an Organization)
- CLI command today: `capxul org create`
- Concept that owns it: organizations (the old record's area: organizations)
- Who may call it: "A signed-in person whose own Capxul account is set up."
- What it changes: "It creates the Organization and its Safe, and you sign the founder authorization in your browser."
- Implemented by: flow client.onboarding.begin-organization
- In the journey: step 2, run as founder; primary test `acc:org.create/c-37a24168b5b82483`

### Payload

Read from: The frozen flag book (`blueprint/baseline/flags.ts`), the flow input `client.onboarding.begin-organization`, and decision `devnet.org-create-names-its-world`.

| Input | On the command line | Type | Required | Note |
|---|---|---|---|---|
| name | `--name <text>` | string | yes |  |
| handle | `--handle <handle>` | string, written without the @ sign | yes |  |
| country | `--country <code>` | string, a two-letter code like GB | yes |  |
| bio | `--bio <text>` | string, at most 280 characters | no |  |
| size | `--size <text>` | string | no |  |
| (none: the signed-in person) | `--email <email>` | string | no | "the signed-in person to use, when this machine has several" |
| (none: the CLI's own check) | `--confirm` | boolean | yes in a script or with `--json` | Without it a script run is refused CLI_USAGE. |
| timeoutSeconds | `--timeout-seconds <n>` | integer, 1 to 3600 | no (default 120) |  |
| fde | `--no-fde` | boolean | no | Named in the flow's `about`. Not in the frozen flag book. |
| logoFileId | unknown | string | no |  |
| currency | unknown | string | no |  |
| timeZone | unknown | string | no |  |
| fiscalYearStart | unknown | string (`MM-DD`) | no |  |
| apps | unknown | array of string | no |  |
| world (not in the flow or rpc input) | `--world <world>` | string | unknown | Decision `devnet.org-create-names-its-world`: "Without `--world` a local devnet's one world is meant." |
| json | `--json` | boolean | no | Global flag of the old CLI (`blueprint/baseline/flags.ts`, globalFlags): "Print a versioned JSON result". Every example passes it. |

The input of flow client.onboarding.begin-organization, as the record declares it:

```
{ name: string, handle: string, country: string, bio?: string, size?: string, logoFileId?: string, currency?: string, timeZone?: string, fiscalYearStart?: string, apps?: array of string, fde?: boolean, timeoutSeconds?: number }
```

Example commands in the record:

- `capxul org create --name "Northwind Trading" --handle northwind --country NL --confirm --json` (succeeds; "Create Northwind and follow its setup to ready")
- `capxul org create --name "Northwind Trading" --handle northwind --country NL --json` (refused: CLI_USAGE, exit 2; "A script run without --confirm")
- `capxul org create --name "Northwind Traders" --handle northwind --country NL --confirm --json` (refused: INVALID_INPUT, exit 2; "The handle is already taken")
- `capxul org create --name "Northwind Trading" --handle northwind --country NL --confirm --json` (refused: FEATURE_NOT_AVAILABLE, exit 6; "Still on the beta waitlist")

### Result

What a success prints with `--json`:

- `organizationId`: string
- `lifecycle`: object
  - `orgId`: string
  - `safe`: string
  - `setup`: "processing" | "awaiting_authorization" | "needs_attention" | "ready" | "failed"
  - `steps`: array of "safe_minted" | "money_deployed" | "installed"
  - `issue`: object | null
    - `reason`: "provider_unavailable" | "mint_reverted" | "safe_owner_mismatch" | "deploy_reverted" | "install_refused" | "approval_expired" | "approval_declined" | "approval_displaced" | "install_reverted" | "provider_answer_invalid"
    - `code`: string
    - `at`: number
  - `recovery`: "authorize" | "checkAgain" | "none"
  - `approvalId`: string | null
  - `checkedAt`: number
  - `board`: object | null
    - `directors`: number
    - `threshold`: number
    - `nonce`: number
    - `waitingProposals`: number
  - `fde`: object | null
    - `partyId`: string
    - `safe`: string

### Refusals

1. `CLI_USAGE` (exit 2), from the starting world `person-ready`:
   > A script or `--json` run without `--confirm`. Nothing happens.
2. `INVALID_INPUT` (exit 2), from the starting world `two-founders`:
   > The handle is taken or malformed, or the bio is too long. No Organization is created.
3. `WRONG_STATE` (exit 2), from the starting world `person-unclaimed`:
   > Your account is not deployed and claimed yet, or an earlier create on this machine for another handle is unfinished, or the same handle was begun with a different intent.
4. `NOT_AUTHENTICATED` (exit 3), from the starting world `signed-out`:
   > No valid sign-in on this machine.
5. `FEATURE_NOT_AVAILABLE` (exit 6), from the starting world `person-on-waitlist`:
   > You are still on the beta waitlist. Nothing is created until an operator admits you.

Other declared errors, with no starting world and no `when`:

- `CLI_DEADLINE` (exit 5): declared by the operation's own `errors` (raised by the CLI)
- `CANCELLED` (exit 130): declared by the operation's own `errors` (raised by the CLI)
- `CLI_STORAGE` (exit 2): declared by the operation's own `errors` (raised by the CLI)
- `ROLE_PERMISSION_DENIED` (exit 4): declared by rpc organizations.setups.get

### Claims

1. "It needs the founder's deployed, claimed account before the first write."
   - Observes: "cli: from person-unclaimed it exits WRONG_STATE. world: no Organization, setup or Party is added."
   - Test id: `acc:org.create/c-313abdcaa41f9df9`
2. "A founder on the beta waitlist is refused until an operator admits them."
   - Observes: "cli: from person-on-waitlist it exits FEATURE_NOT_AVAILABLE; after the operator admits them the same command succeeds. world: nothing is added before."
   - Test id: `acc:org.create/c-fae49b69ef6deed4`
3. "The same intent resumes the same Organization; a changed intent or another founder refuses."
   - Observes: "cli: the same command twice prints the same Organization ID; a changed name or bio under the same handle exits WRONG_STATE; another founder's handle exits INVALID_INPUT. read: `org list` shows one Organization."
   - Test id: `acc:org.create/c-f18049cd600668af`
4. "An invalid logo is refused and leaves no Organization and no setup, and its handle stays free."
   - Observes: "cli: INVALID_INPUT. read: `org list` shows no Organization and no unfinished setup. world: no diff; the same handle with a valid logo then succeeds."
   - Test id: `acc:org.create/c-e74f131ab3816a02`
5. "Bio and size are stored trimmed, and an over-long bio is refused."
   - Observes: "world: the Organization's bio and size are the given text trimmed. cli: a bio of 281 characters exits INVALID_INPUT."
   - Test id: `acc:org.create/c-38c97cf2c6a5056c`
6. *(thin line)* "The Organization's Safe is Companies House's company Safe for this founder."
   - Observes: "chain: CompanySafeMinted names the Organization's Safe with the founder's personal Safe as founderSafe, at the minter's companySafeAddressFor. read: `org show` prints that Safe."
   - Test id: `acc:org.create/c-37a24168b5b82483`
7. "It prints and saves the exact ID before authorization, then stops at a truthful deadline."
   - Observes: "cli: the Organization ID is printed before the approval page opens; with `--timeout-seconds 1` it exits CLI_DEADLINE and `org show` later reads the setup still moving."
   - Test id: `acc:org.create/c-f76d985ce2889eda`

### Events

| Event | Transition | Sent by |
|---|---|---|
| `org_setup_transitioned` | `org-setup.begin` (birth to processing) | rpc organizations.setups.begin |
| `org_app_transitioned` | `org-app.install_native` (birth to installed) | rpc organizations.setups.begin |
| `org_app_transitioned` | `org-app.want` (birth to wanted) | rpc organizations.setups.begin |
| `party_transitioned` | `party.register` (birth to pending) | procedure parties.register |

What each event carries:

- `org_setup_transitioned`: `{ from: string | null, to: string, transition: string, org_id: string, person_id: string, issue_reason: string | null }`
- `org_app_transitioned`: `{ from: string | null, to: string, transition: string, org_id: string, app: string, native: boolean }`
- `party_transitioned`: `{ from: "provisional" | "outside" | "pending" | "active" | "released" | null, to: "provisional" | "outside" | "pending" | "active" | "released", transition: "name_person" | "name_address" | "adopt_mailbox" | "onboard" | "claim" | "register" | "activate" | "release", party_id: string, kind: "person" | "agent" | "organization" | "address", owner_kind: "person" | "organization" | null, owner_id: string | null }`

All four are sent by the first step (`begin`), in one transaction. `org_app_transitioned` is sent once per app: `install_native` for each fundamental app, `want` for each app asked for. The setup then moves in a background process.

Started by this operation and running after it answers (their events are not part of the call):

- process `organizations.setups.set-up` ("One Organization's setup: mint the Safe, deploy, install, ready"), started by the transition org-setup.begin; it drives `org-setup.request_authorization`, `org-setup.authorize`, `org-setup.complete`, `org-setup.stall`, `org-setup.fail`, `org-member.seat`, `org-fde.provision`, sending `org_setup_transitioned`, `org_member_transitioned`, `org_fde_transitioned`

### Budget

- The operation: class `chain-submit`, p50 4,000 ms, p95 8,000 ms. Why: "two service-key sends (the mint and deployMoney) and the install's sponsorship run in series before the founder signs"
- The flow client.onboarding.begin-organization it runs: class `write`, p50 700 ms, p95 1,500 ms

### Touches

| Part of a world | Needed |
|---|---|
| database | yes: organizations, org-setups, org-apps, parties |
| chain | yes: the setup process mints the company Safe and deploys; the thin line's claim reads `CompanySafeMinted` |
| index | yes: once ready, `board` in the result comes from the indexed Safe owners and approvals |
| Frappe site | not in this record. `evals/thin-line.md` step 2 also waits for the company's site |
| clock | no |
| snapshot store | no |
| signing | yes: the founder signs the install approval, which is sponsored and sent to the chain |
| must exist first | A signed-in person, admitted from the waitlist, whose personal Safe is claimed (the starting world `person-ready`). |

- Tables read: principals (access), admissions (accounts), personal-safes (accounts), parties (parties), files (media), organizations (organizations), org-setups (organizations), org-members (organizations), safe-owners (indexing), safe-approvals (indexing), approvals (approvals)
- Tables written: organizations (organizations), org-setups (organizations), org-apps (organizations), parties (parties)
- Outside calls: none
- Contract functions named: company-safe-minter.companySafeAddressFor
- Steps the client does itself: save (cache), await-authorization (wait), sign (sign), await-ready (wait)

### Source

- `blueprint/organizations/operations.ts:79`: the operation record
- `blueprint/organizations/flows.ts:36`: implemented by flow client.onboarding.begin-organization
- `blueprint/baseline/operations.ts:11118`: the frozen text: title, about, who, claims, refusals
- `blueprint/baseline/flags.ts:1528`: the old CLI's flags
- `blueprint/organizations/setups.ts:68`: the rpc of the first step
- `blueprint/organizations/examples.ts:88`: examples
- `blueprint/devnet/world-decisions.ts:82`: the decision that adds `--world`
- `blueprint/organizations/data.ts:741`: event org_setup_transitioned
- `blueprint/organizations/data.ts:1042`: event org_app_transitioned
- `blueprint/parties/data.ts:154`: event party_transitioned
- `evals/thin-line.md:25`: the journey step and its primary test
- `blueprint/sites/thin-line.ts:11`: the journey record

### Doubts

1. The flow has the founder sign the install approval in a browser with Openfort. Decision `plugs.no-openfort` says every signature is made with a key, by an agent or by code. The record was not changed to match.
2. Decision `devnet.org-create-names-its-world` adds `--world`, but the flow input and the rpc input have no world field, and no example passes it. One claim elsewhere writes `org create acme --world town1` with the name as a bare word; the frozen command takes `--name`.
3. The thin line's claim for this step is the sixth (the company Safe). Its assertion in `evals/thin-line.md` also asks for the company's site, bank account and sign-in to agree with the chain. Nothing in this record makes a site; the roadmap's step 1.4 covers the site.
4. The refusal FEATURE_NOT_AVAILABLE (the beta waitlist) and the claims about the waitlist and the logo need accounts, admissions and media, which are outside the thin line.
5. The result follows the setup to `ready`, which takes a person's signature and the chain. The budget (p95 8,000 ms) lists no excluded waits, though the engine's rule says a person's wait and chain confirmation are excluded.
6. The operation's `errors` add CLI_DEADLINE, CANCELLED and CLI_STORAGE (this machine could not save the Organization's id). These are the CLI's own; they have no starting world.

## 3. `org.member.grant`

### Operation

- Operation: `org.member.grant` (Grant a permission)
- CLI command today: `capxul org member grant`
- Concept that owns it: board (the old record's area: governance)
- Who may call it: "A Director of the Organization."
- What it changes: "It opens a proposal at the Safe's next nonce and changes nothing until enough Directors approve."
- Implemented by: flow client.org.members.grant
- In the journey: step 3, run as director, seen on screen `hat-grants`; primary test `acc:org.member.grant/c-6412f20281167621`

### Payload

Read from: The frozen flag book (`blueprint/baseline/flags.ts`) and the flow input `client.org.members.grant`.

| Input | On the command line | Type | Required | Note |
|---|---|---|---|---|
| member | `<email>` (argument) | string | yes | "The Seat's email". The rpc's text also allows an agent's Seat by its `@handle`. |
| permission | `--permission manage-books\|issue-invoices\|manage-people` | one of those three | yes |  |
| note | `--note <text>` | string or null | no | "what the Directors read on the approval page" |
| noWait | `--no-wait` | boolean | no | "return as soon as your approval is open" |
| timeoutSeconds | `--timeout-seconds <n>` | integer or null | no (default: until the approval lapses) |  |
| (none: the signed-in person) | `--email <email>` | string | no |  |
| orgId | unknown for this command | string | yes in the flow input | The old CLI has a global `--org <handle>` flag ("act as this organization for one command", `blueprint/baseline/flags.ts`, globalFlags). No example of this command passes it. |
| json | `--json` | boolean | no | Global flag of the old CLI (`blueprint/baseline/flags.ts`, globalFlags): "Print a versioned JSON result". Every example passes it. |

The input of flow client.org.members.grant, as the record declares it:

```
{ orgId: string, member: string, permission: "manage-books" | "issue-invoices" | "manage-people", note: string | null, noWait: boolean, timeoutSeconds: integer | null }
```

Example commands in the record:

- `capxul org member grant marcus.lindqvist@northwind.test --permission manage-books --note "Marcus keeps the Finance books" --no-wait --json` (succeeds; "Hannah gives Marcus the Manage books permission")
- `capxul org member grant stranger@northwind.test --permission manage-books --json` (refused: INVALID_INPUT, exit 2; "The email is not a current member")
- `capxul org member grant marcus.lindqvist@northwind.test --permission manage-books --json` (refused: WRONG_STATE, exit 2; "Marcus already holds that permission")
- `capxul org member grant priya.raman@northwind.test --permission issue-invoices --json` (refused: FEATURE_NOT_AVAILABLE, exit 6; "The proposals gate is off for the organization")

### Result

What a success prints with `--json`:

- `change`: object
  - `changeId`: string
  - `change`: "grant" | "revoke"
  - `permission`: "manage-books" | "issue-invoices" | "manage-people"
  - `email`: string | null
  - `name`: string | null
  - `state`: "proposed" | "applied" | "ended"
- `proposal`: object
  - `proposalId`: string
  - `nonce`: integer
  - `status`: "awaiting_approvals" | "executed" | "failed" | "rejected" | "replaced"
  - `threshold`: integer
  - `approvals`: array of string
  - `note`: string
  - `approvalId`: string
  - `url`: string

### Refusals

1. `ROLE_PERMISSION_DENIED` (exit 4), from the starting world `org-with-founder-board`:
   > Your personal Safe is not one of the Organization Safe's owners. Nothing was signed.
2. `INVALID_INPUT` (exit 2), from the starting world `org-with-founder-board`:
   > The email is not a current member of the Organization. Invite them first with `capxul org member invite`.
3. `WRONG_STATE` (exit 2), from the starting world `org-with-waiting-proposals`:
   > The member already holds that permission (on a v4 company, their personal Safe already wears its officer hat), or a change to the same member's permission is still waiting for the Directors.
4. `WRONG_STATE` (exit 2), from the starting world `org-with-founder-board`:
   > On a v4 company, the member has no claimed personal Safe yet, so there is nothing to give the hat to.
5. `FEATURE_NOT_AVAILABLE` (exit 6), from the starting world `org-with-proposals-gate-off`:
   > The `owner-safe-proposals` gate is off for the Organization, or for Manage books the `books` gate. Nothing is proposed.
6. `ROLE_CONFLICT` (exit 6), from the starting world `org-with-budget-tree`:
   > Manage people for a member who holds a department's or team's office: one person cannot hold both (ADR-0040). Nothing is proposed.
7. `NOT_AUTHENTICATED` (exit 3), from the starting world `cli-signed-out`:
   > No valid sign-in on this machine.

Other declared errors, with no starting world and no `when`:

- `CLI_USAGE` (exit 2): declared by the operation's own `errors` (raised by the CLI)
- `CANCELLED` (exit 130): declared by flow client.org.members.grant
- `PROVIDER_ERROR` (exit 5): declared by rpc board.officers.grant
- `PROVIDER_RESPONSE_INVALID` (exit 5): declared by rpc board.officers.grant

### Claims

1. *(thin line)* "A grant is a Director proposal, applied once it executes."
   - Observes: "read: `org proposal get` shows the grant's proposal waiting; after the second Director approves, `org member get` shows the member wearing the hat and the change reads `applied`"
   - Test id: `acc:org.member.grant/c-6412f20281167621`
2. "A caller who is not a Director, an email that is not a current Seat, and a grant of what the Seat holds are each refused."
   - Observes: "cli: ROLE_PERMISSION_DENIED for a member who is not a Director, INVALID_INPUT for the outsider's email, WRONG_STATE for the member already wearing the Books hat; world: the snapshot diff shows no officer change, proposal or approval row"
   - Test id: `acc:org.member.grant/c-ed5a48c2e1b12719`
3. "A second change is refused while one waits."
   - Observes: "cli: a second grant of Invoicing to the member whose grant waits is WRONG_STATE; world: the snapshot diff shows no officer change, proposal or approval row"
   - Test id: `acc:org.member.grant/c-3e81e998390a6602`
4. "With the Director proposals gate off it is refused, and Manage books needs the books gate too."
   - Observes: "cli: FEATURE_NOT_AVAILABLE with `owner-safe-proposals` off, and for Manage books with `books` off; world: the snapshot diff shows no officer change, proposal or approval row"
   - Test id: `acc:org.member.grant/c-6fd22fa2a0774ed8`
5. "It reports one `officer_change_transitioned` (`propose`) for the proposing Director, carrying neither the Seat nor the note."
   - Observes: "trace: exactly one officer_change_transitioned with transition propose, its actor the proposing Director and no member id, email or note in its properties"
   - Test id: `acc:org.member.grant/c-b8a4adcbed22e66d`
6. "The proposal mints the officer hat to the Seat's Safe, and takes one more seat first when every seat is worn."
   - Observes: "chain: the executed batch is `Hats.mintHat(hat, memberSafe)`, preceded by `changeHatMaxSupply(hat, supply + 1)` when every seat is worn"
   - Test id: `acc:org.member.grant/c-3254ec4a40c86a97`
7. "A Seat whose Safe already wears the hat, and a Seat with no personal Safe, are each refused before anything is proposed."
   - Observes: "cli: WRONG_STATE for each; world: the snapshot diff shows no officer change, proposal or approval row"
   - Test id: `acc:org.member.grant/c-7db203df47b9ca84`
8. "Manage people is the People hat."
   - Observes: "chain: a granted `manage-people` mints the deployment's People hat; read: `org member get` shows it"
   - Test id: `acc:org.member.grant/c-640d6eb596538a6f`

### Events

| Event | Transition | Sent by |
|---|---|---|
| `officer_change_transitioned` | `officer-change.propose` (birth to proposed) | rpc board.officers.grant |
| `proposal_transitioned` | `proposal.propose` (birth to awaiting_approvals) | procedure board.propose |
| `approval_transitioned` | `approval.open` (birth to sponsoring) | procedure approvals.open |
| `approval_transitioned` | `approval.sign` (pending to signed) | rpc approvals.signing.sign |

What each event carries:

- `officer_change_transitioned`: `{ from: "proposed" | "applied" | "ended" | null, to: "proposed" | "applied" | "ended", transition: "propose" | "apply" | "end", change_id: string, org_id: string, change: "grant" | "revoke", permission: "manage-books" | "issue-invoices" | "manage-people", proposal_id: string }`
- `proposal_transitioned`: `{ from: "awaiting_approvals" | "executed" | "failed" | "rejected" | "replaced" | null, to: "awaiting_approvals" | "executed" | "failed" | "rejected" | "replaced", transition: "propose" | "execute" | "fail" | "reject" | "replace", proposal_id: string, org_id: string, kind: "transaction" | "rejection" | "scheduled_payment", nonce: integer, opener: "board" | "agents" | "budgets" | "payments" | "payroll" | "equity", subject_kind: string, subject_id: string }`
- `approval_transitioned`: `{ from: "sponsoring" | "pending" | "signed" | "sending" | "sent" | "landed" | "reverted" | "displaced" | "expired" | "declined" | "refused" | "withdrawn" | null, to: "sponsoring" | "pending" | "signed" | "sending" | "sent" | "landed" | "reverted" | "displaced" | "expired" | "declined" | "refused" | "withdrawn", transition: "open" | "sponsor" | "refuse" | "sign" | "decline" | "withdraw" | "claim_send" | "accept" | "bounce" | "land" | "revert" | "displace" | "expire", approval_id: string, person_id: string, org_id: string | null, opener: "accounts" | "organizations" | "board" | "agents" | "budgets" | "payments" | "payroll" | "equity", subject_kind: string, subject_id: string }`

The first three are sent together when the proposal is born (step `prepare`). `approval_transitioned` with `sign` is sent when the caller's signature is given through the rpc; a person's signature is given by the approval page instead. The change is applied later by the proposal's background process.

Started by this operation and running after it answers (their events are not part of the call):

- process `approvals.lifecycle.carry` ("Carry one approval from sponsorship to chain proof"), started by the transition approval.open; it drives `approval.sponsor`, `approval.refuse`, `approval.claim_send`, `approval.accept`, `approval.bounce`, `approval.land`, `approval.revert`, `approval.displace`, `approval.expire`, sending `approval_transitioned`
- process `board.proposals.carry` ("One Board proposal, from birth to the transaction at its nonce"), started by the transition proposal.propose; it drives `proposal.execute`, `proposal.fail`, `proposal.reject`, `proposal.replace`, `officer-change.apply`, `officer-change.end`, sending `proposal_transitioned`, `officer_change_transitioned`
- process `notices.board.proposal-waiting` ("Tell the Directors a Board proposal waits for their approval"), started by the transition proposal.propose; it drives `notice.send`, `notice.hold`, `notice.refuse`, sending `notice_transitioned`

### Budget

- The operation: class `chain-submit`, p50 2,000 ms, p95 4,000 ms, excluding `wait.person` and `chain.confirm`
- The flow client.org.members.grant it runs: class `chain-submit`, p50 2,000 ms, p95 4,000 ms, excluding `wait.person` and `chain.confirm`

### Touches

| Part of a world | Needed |
|---|---|
| database | yes: officer-changes, board-proposals, proposal-approvals, approvals |
| chain | yes: live reads of Hats, the Safe and the signer gate before proposing; the proposal executes on the chain |
| index | yes: it reads the indexed Safe owners, hat wearers, hats and budgets |
| Frappe site | not in this record. `evals/thin-line.md` step 3 also asks that the mapped roles reach the site |
| clock | no |
| snapshot store | no |
| signing | yes: the caller signs their own approval of the proposal, which is sponsored and sent to the chain |
| must exist first | A company that is set up, the caller a Director, and the member a current member with a claimed personal Safe. |

- Tables read: organizations (organizations), org-deployments (organizations), org-members (organizations), principals (access), parties (parties), feature-flags (access), safe-owners (indexing), hat-wearers (indexing), officer-changes (board), chain-hats (indexing), chain-budgets (indexing), safe-approvals (indexing), board-proposals (board), proposal-approvals (board), approvals (approvals)
- Tables written: officer-changes (board), board-proposals (board), proposal-approvals (board), approvals (approvals)
- Outside calls: chain-rpc.readContract
- Contract functions named: hats.isWearerOfHat, hats.changeHatMaxSupply, hats.mintHat, safe.getOwners, safe.getThreshold, hats-signer-gate.isValidSigner, hats-signer-gate.thresholdConfig
- Steps the client does itself: check-calls (build), sign (sign), approval (wait)

### Source

- `blueprint/board/operations.ts:530`: the operation record
- `blueprint/board/flows.ts:304`: implemented by flow client.org.members.grant
- `blueprint/baseline/operations.ts:14703`: the frozen text
- `blueprint/baseline/flags.ts:1947`: the old CLI's flags
- `blueprint/board/officers.ts:109`: the rpc of the first step
- `blueprint/board/data.ts:483`: event officer_change_transitioned
- `blueprint/board/data.ts:334`: event proposal_transitioned
- `blueprint/approvals/data.ts:184`: event approval_transitioned
- `evals/thin-line.md:26`: the journey step and its primary test
- `blueprint/sites/thin-line.ts:11`: the journey record

### Doubts

1. The thin line's claim (the first) needs a second Director to approve, and `evals/thin-line.md` says so. No step of the thin line seats a second Director or approves a proposal. The refusals' starting world `org-with-founder-board` has one Director (1 of 1).
2. The member must already be a member with a claimed personal Safe. No step of the thin line invites or seats a member.
3. The result with `--no-wait` reads `proposed`; without it the command waits for a person and the chain. The record does not say which of the two is the operation's success.
4. The refusal FEATURE_NOT_AVAILABLE depends on feature gates (`owner-safe-proposals`, `books`), and ROLE_CONFLICT on budgets' office hats. Both are outside the thin line.
5. The old record's area is `governance`; the owning concept is board. The flow has a person sign on an approval page the CLI opens; decision `plugs.no-openfort` says every signature is made with a key.
6. The fifth claim is about what the event must not carry ("neither the Seat nor the note"). The spike contract declares only what an event carries.

## 4. `doc.create`

### Operation

- Operation: `doc.create` (Create a document as a draft)
- CLI command today: `capxul doc create`
- Concept that owns it: sites (the old record's area: sites)
- Who may call it: "A person or an agent whose Frappe user a hat created."
- What it changes: "One draft document on the site."
- Implemented by: rpc sites.door.create
- In the journey: step 4, run as office-holder, seen on screen `payment-entry`; primary test `acc:doc.create/c-4a88a94b435451b9`

### Payload

Read from: The rpc input `sites.door.create`, the examples and the header of `blueprint/sites/examples.ts`.

| Input | On the command line | Type | Required | Note |
|---|---|---|---|---|
| doctype | `<doctype>` (argument) | string | yes | Example: `Supplier`. |
| fields | `--field <name>=<value>`, repeated | record of string to any value | yes in the rpc input | Example: `--field supplier_name="Brightside Cleaning"`. |
| orgId | unknown for this command | string | yes in the rpc input | The old CLI has a global `--org <handle>` flag ("act as this organization for one command", `blueprint/baseline/flags.ts`, globalFlags). No door example passes it. |
| callId | unknown | string | yes in the rpc input | `blueprint/sites/door.ts`: "Idempotency by call id was not tried: the first door eval proves it." |
| json | `--json` | boolean | no | Global flag of the old CLI (`blueprint/baseline/flags.ts`, globalFlags): "Print a versioned JSON result". Every example passes it. |

The input of rpc sites.door.create, as the record declares it:

```
{ orgId: string, doctype: string, fields: record of string to any value, callId: string }
```

Example commands in the record:

- `capxul doc create Supplier --field supplier_name="Brightside Cleaning" --json` (succeeds; "Hannah adds Brightside as a supplier")
- `capxul doc create Supplier --json` (refused: INVALID_INPUT, exit 2; "A required field is missing")
- `capxul doc create Supplier --field supplier_name="Brightside Cleaning" --json` (refused: ROLE_PERMISSION_DENIED, exit 4; "A caller with no site user, because no hat created one")

### Result

What a success prints with `--json`:

- `doctype`: string
- `name`: string
- `docstatus`: number
- `fields`: record of string to any value

### Refusals

1. `NOT_AUTHENTICATED` (exit 3), from the starting world `signed-out`:
   > No one is signed in on this machine.
2. `ROLE_PERMISSION_DENIED` (exit 4), from the starting world `org-with-member`:
   > The caller has no site user in this Organization (no hat created one): the door never runs a call as another user.
3. `FEATURE_NOT_AVAILABLE` (exit 6), from the starting world `org-with-site-features`:
   > The call reaches a document of a part that is switched off for this company; the site refuses and nothing changes.
4. `PROVIDER_ERROR` (exit 5), from the starting world `org-with-site-down`:
   > The site's bench is stopped.
5. `INVALID_INPUT` (exit 2), from the starting world `org-with-site`:
   > A required field is missing or a link does not resolve.

Other declared errors, with no starting world and no `when`:

- `CLI_USAGE` (exit 2): declared by the operation's own `errors` (raised by the CLI)
- `PROVIDER_RESPONSE_INVALID` (exit 5): declared by rpc sites.door.create

### Claims

1. *(thin line)* "A document is created as a draft and Frappe's validations apply."
   - Observes: "cli: in `org-with-hats-on-site`, the Director's `doc create Supplier --field supplier_name="Brightside Cleaning Ltd"` prints the new name; a member without the role exits ROLE_PERMISSION_DENIED and nothing is made."
   - Test id: `acc:doc.create/c-4a88a94b435451b9`

### Events

None found. What implements it drives no transition, invokes no procedure and declares no event.

### Budget

- The operation: class `write`, p50 700 ms, p95 1,500 ms
- The rpc sites.door.create it runs: class `write`, p50 700 ms, p95 1,500 ms

### Touches

| Part of a world | Needed |
|---|---|
| database | yes: it reads sites, site-users and site-features and writes door-calls |
| chain | no |
| index | no |
| Frappe site | yes: the call runs on the company's site as the caller's Frappe user |
| clock | no |
| snapshot store | no |
| signing | no |
| must exist first | A company with a ready site, and a caller whose Frappe user a hat created (so hats must have reached the site first). |

- Tables read: sites (sites), site-users (plugs), site-features (sites)
- Tables written: door-calls (sites)
- Outside calls: frappe-site.doorCall
- Contract functions named: none

### Source

- `blueprint/sites/operations.ts:135`: the operation record
- `blueprint/sites/door.ts:65`: implemented by rpc sites.door.create
- `blueprint/sites/operations.ts:113`: the helper that fills who, the four shared refusals and the errors
- `blueprint/sites/door.ts:64`: the rpc
- `blueprint/sites/examples.ts:152`: examples
- `blueprint/plugs/kit.ts:54`: the default budget (write)
- `evals/thin-line.md:27`: the journey step and its primary test
- `blueprint/sites/thin-line.ts:11`: the journey record

### Doubts

1. `evals/thin-line.md` step 4 asks to record the documents' ids and document hash. The result has no hash field.
2. The record declares no event, though the call writes a `door-calls` row and the world's record. The roadmap's runner checks declared events on every run; from this record the list is empty.
3. The budget is the helper's default (class write, p95 1,500 ms) for a call that goes to a Frappe site. The record gives no measurement.
4. The claim says a member without the role exits ROLE_PERMISSION_DENIED. The refusal list has ROLE_PERMISSION_DENIED only for a caller with no site user at all.
5. PROVIDER_ERROR is a refusal here ("The site's bench is stopped"). The roadmap puts a world's sites on a shared bench reached with a per-world token, or on the world's own bench; the old refusal knows one bench.

## 5. `doc.submit`

### Operation

- Operation: `doc.submit` (Submit a document; a Safe payment is held for the signer)
- CLI command today: `capxul doc submit`
- Concept that owns it: sites (the old record's area: sites)
- Who may call it: "A person or an agent whose Frappe user a hat created."
- What it changes: "The document is submitted, or a held payment is waiting for its signature."
- Implemented by: rpc sites.door.submit
- In the journey: step 5, run as office-holder, seen on screen `payment-entry`; primary test `acc:doc.submit/c-df3c0c51cdf3899b`

### Payload

Read from: The rpc input `sites.door.submit` and the examples.

| Input | On the command line | Type | Required | Note |
|---|---|---|---|---|
| doctype | `<doctype>` (argument) | string | yes | Examples: `"Purchase Invoice"`, `"Payment Entry"`. |
| name | `<name>` (argument) | string | yes | Example: `ACC-PAY-2026-00001`. |
| orgId | unknown for this command | string | yes in the rpc input | The old CLI has a global `--org <handle>` flag ("act as this organization for one command", `blueprint/baseline/flags.ts`, globalFlags). No door example passes it. |
| callId | unknown | string | yes in the rpc input |  |
| json | `--json` | boolean | no | Global flag of the old CLI (`blueprint/baseline/flags.ts`, globalFlags): "Print a versioned JSON result". Every example passes it. |

The input of rpc sites.door.submit, as the record declares it:

```
{ orgId: string, doctype: string, name: string, callId: string }
```

Example commands in the record:

- `capxul doc submit "Purchase Invoice" ACC-PINV-2026-00001 --json` (succeeds; "Submit the invoice: Frappe posts it")
- `capxul doc submit "Payment Entry" ACC-PAY-2026-00001 --json` (succeeds; "Submit the payment: it is held for the signer")
- `capxul doc submit "Purchase Invoice" ACC-PINV-2026-00002 --json` (refused: WRONG_STATE, exit 2; "The document is not a draft")

### Result

What a success prints with `--json`:

One of 2 shapes:

- shape 1: object
  - `doctype`: string
  - `name`: string
  - `docstatus`: number
  - `fields`: record of string to any value
- shape 2: object
  - `held`: true
  - `requestId`: string
  - `approvalId`: string
  - `awaiting`: string

### Refusals

1. `NOT_AUTHENTICATED` (exit 3), from the starting world `signed-out`:
   > No one is signed in on this machine.
2. `ROLE_PERMISSION_DENIED` (exit 4), from the starting world `org-with-member`:
   > The caller has no site user in this Organization (no hat created one): the door never runs a call as another user.
3. `FEATURE_NOT_AVAILABLE` (exit 6), from the starting world `org-with-site-features`:
   > The call reaches a document of a part that is switched off for this company; the site refuses and nothing changes.
4. `PROVIDER_ERROR` (exit 5), from the starting world `org-with-site-down`:
   > The site's bench is stopped.
5. `WRONG_STATE` (exit 2), from the starting world `org-with-site`:
   > The document is not a draft.

Other declared errors, with no starting world and no `when`:

- `CLI_USAGE` (exit 2): declared by the operation's own `errors` (raised by the CLI)
- `INVALID_INPUT` (exit 2): declared by rpc sites.door.submit; procedure plugs.payments.hold; procedure payments.prepare-command; procedure approvals.open
- `PROVIDER_RESPONSE_INVALID` (exit 5): declared by rpc sites.door.submit
- `AUTHORISED_EXCEEDED` (exit 2): declared by procedure plugs.payments.hold
- `INSUFFICIENT_BALANCE` (exit 2): declared by procedure plugs.payments.hold; procedure payments.prepare-command
- `INVALID_RECIPIENT` (exit 2): declared by procedure payments.prepare-command
- `PAYROLL_BUDGET_EXCEEDED` (exit 2): declared by procedure payments.prepare-command

### Claims

1. "An ordinary document posts to the ledger when submitted."
   - Observes: "cli: `doc submit "Purchase Invoice" ACC-PINV-2026-00001` prints docstatus 1; read: `report run "General Ledger"` shows its lines."
   - Test id: `acc:doc.submit/c-74a45893884b5bef`
2. *(thin line)* "A Payment Entry from the Safe is held, not posted, and the signer is named."
   - Observes: "cli: in `org-with-held-payment`, `doc submit "Payment Entry" ACC-PAY-2026-00001 --json` prints held true, an approvalId and `awaiting`; read: no ledger line yet; after the signature lands it posts once."
   - Test id: `acc:doc.submit/c-df3c0c51cdf3899b`

### Events

| Event | Transition | Sent by |
|---|---|---|
| `payment_request_transitioned` | `payment-request.prepare` (birth to waiting) | procedure plugs.payments.hold |
| `payment_transitioned` | `payment.open` (birth to prepared) | procedure payments.prepare-command |
| `payment_transitioned` | `payment.retry` (needs_retry to prepared) | procedure payments.prepare-command |
| `approval_transitioned` | `approval.open` (birth to sponsoring) | procedure approvals.open |

What each event carries:

- `payment_request_transitioned`: `{ from: "waiting" | "sent" | "failed" | "mismatch" | "abandoned" | "reversed" | null, to: "waiting" | "sent" | "failed" | "mismatch" | "abandoned" | "reversed", transition: "prepare" | "land" | "fail" | "mismatch" | "abandon" | "reverse", org_id: string, request_id: string, doctype: string }`
- `payment_transitioned`: `{ from: "prepared" | "scheduled" | "due" | "escrowed" | "submitted" | "needs_retry" | "settled" | "mismatched" | "cancelled" | null, to: "prepared" | "scheduled" | "due" | "escrowed" | "submitted" | "needs_retry" | "settled" | "mismatched" | "cancelled", transition: string, payment_id: string, owner_kind: "person" | "organization", owner_id: string, command_id: string | null, route: "personal" | "budget" | "board" | "claim_escrow" | "chain", outcome: "declined" | "refused" | "rejected" | "expired" | "displaced" | "reverted" | "window_closed" | "voided" | "budget_cancelled" | "refunded" | "withdrawn" | null }`
- `approval_transitioned`: `{ from: "sponsoring" | "pending" | "signed" | "sending" | "sent" | "landed" | "reverted" | "displaced" | "expired" | "declined" | "refused" | "withdrawn" | null, to: "sponsoring" | "pending" | "signed" | "sending" | "sent" | "landed" | "reverted" | "displaced" | "expired" | "declined" | "refused" | "withdrawn", transition: "open" | "sponsor" | "refuse" | "sign" | "decline" | "withdraw" | "claim_send" | "accept" | "bounce" | "land" | "revert" | "displace" | "expire", approval_id: string, person_id: string, org_id: string | null, opener: "accounts" | "organizations" | "board" | "agents" | "budgets" | "payments" | "payroll" | "equity", subject_kind: string, subject_id: string }`

All three are sent only when the document is a Payment Entry from the Safe (the held path). An ordinary document's submit sends none. Of the two `payment_transitioned` transitions, `open` is the birth; `retry` applies to a payment that needed a retry.

Started by this operation and running after it answers (their events are not part of the call):

- process `approvals.lifecycle.carry` ("Carry one approval from sponsorship to chain proof"), started by the transition approval.open; it drives `approval.sponsor`, `approval.refuse`, `approval.claim_send`, `approval.accept`, `approval.bounce`, `approval.land`, `approval.revert`, `approval.displace`, `approval.expire`, sending `approval_transitioned`
- process `payments.lifecycle.payment` ("Carry one Payment from its birth to settled or cancelled"), started by the transition payment.open; it drives `payment.schedule`, `payment.come_due`, `payment.escrow`, `payment.submit`, `payment.settle`, `payment.mismatch`, `payment.unsettle`, `payment.lapse`, `payment.cancel`, sending `payment_transitioned`
- process `activity.changes.note-payment-open` ("A Payment was born: note it in its feeds"), started by the transition payment.open; it drives no transition
- process `activity.changes.note-payment-retry` ("A Payment was retried: note it in its feeds"), started by the transition payment.retry; it drives no transition

### Budget

- The operation: class `write`, p50 700 ms, p95 1,500 ms
- The rpc sites.door.submit it runs: class `write`, p50 700 ms, p95 1,500 ms

### Touches

| Part of a world | Needed |
|---|---|
| database | yes: door-calls, and for a held payment payment-requests, payment-commands, payments and approvals |
| chain | not for the call. The claim's last part ("after the signature lands it posts once") needs the chain |
| index | yes for a held payment: the hold reads the indexed hat wearers |
| Frappe site | yes |
| clock | no |
| snapshot store | no |
| signing | not for the call: the hold opens an approval that the signer signs later |
| must exist first | A draft document on the site. For the thin line: a draft Payment Entry from the Safe's account, and a signer who wears a hat that may pay. |

- Tables read: sites (sites), site-users (plugs), site-features (sites), hat-wearers (indexing), org-deployments (organizations), payment-requests (plugs), payment-commands (payments), payments (payments), parties (parties), approvals (approvals), principals (access)
- Tables written: door-calls (sites), payment-requests (plugs), payment-commands (payments), payments (payments), approvals (approvals)
- Outside calls: frappe-site.doorCall
- Contract functions named: none

### Source

- `blueprint/sites/operations.ts:144`: the operation record
- `blueprint/sites/door.ts:88`: implemented by rpc sites.door.submit
- `blueprint/sites/operations.ts:113`: the helper that fills who, the four shared refusals and the errors
- `blueprint/sites/door.ts:87`: the rpc
- `blueprint/plugs/signer.ts:26`: the hold it invokes for a Safe payment
- `blueprint/sites/examples.ts:176`: examples
- `blueprint/plugs/kit.ts:54`: the default budget (write)
- `blueprint/plugs/data.ts:329`: event payment_request_transitioned
- `blueprint/payments/data.ts:346`: event payment_transitioned
- `blueprint/approvals/data.ts:184`: event approval_transitioned
- `evals/thin-line.md:28`: the journey step and its primary test
- `blueprint/sites/thin-line.ts:11`: the journey record

### Doubts

1. The result is one of two shapes and the events are sent on one of them only. The spike contract declares one success schema, and events that every successful call emits exactly once.
2. The hold needs the payee, the payee's address, the amount, the asset, the document hash and the signer. The door's input carries only orgId, doctype, name and callId, and the record does not say where the rest is read from.
3. The procedures the held path invokes declare errors that this operation does not list as refusals and its rpc does not list as errors: AUTHORISED_EXCEEDED and INSUFFICIENT_BALANCE (`plugs.payments.hold`), and more from `payments.prepare-command` (see the other declared errors above).
4. A document that does not exist is not a listed refusal here. INVALID_INPUT is in the rpc's error list, and `doc.get` gives it a refusal, but `doc.submit` does not.
5. The first claim (an ordinary document posts to the ledger) is checked with `report run`. The thin line's claim is the second.
6. The budget is the helper's default (class write, p95 1,500 ms). The record gives no measurement for a submit that also holds a payment.

## 6. `payment.send`

### Operation

- Operation: `payment.send` (Send a payment)
- CLI command today: `capxul payment send`
- Concept that owns it: payments (the old record's area: payments)
- Who may call it: "A signed-in person. With `--org`, the wearer of the budget's hat or of a budget above it. With `--as-directors`, a Director."
- What it changes: "You sign the payment on the approval page, and the money moves once it settles. With `--as-directors`, it opens a proposal at the Safe's next nonce and nothing moves until enough Directors approve."
- Implemented by: flow client.payments.pay
- In the journey: step 6, run as office-holder, seen on screen `payment-requests`; primary test `acc:payment.send/c-c9400dfaeba081e7`

### Payload

Read from: The frozen flag book (`blueprint/baseline/flags.ts`) and the flow input `client.payments.pay`.

| Input | On the command line | Type | Required | Note |
|---|---|---|---|---|
| to | `<to>` (argument) | string: an email, a @handle or an 0x address | yes, unless `--input` is given |  |
| amount | `<amount>` (argument) | string, like 50 or 12.5 | yes, unless `--input` is given |  |
| asset | `--asset <symbol>` | string or null | no (default USDC) |  |
| org | `--org <handle>` (global flag) | string or null | no |  |
| from | `--from <allowance>` | string or null | no | "the spending allowance an Organization payment spends from: its name or ID" |
| as_directors | `--as-directors` | boolean | no |  |
| note | `--note <text>` | string or null | no |  |
| account | `--account <code>` | string or null | no |  |
| suggest | `--suggest <name>` | string or null | no |  |
| pay_at | `--on <day>` or `--at <time>` | string or null | no | Not both. |
| request_key | `--request-key <key>` | string | no at the CLI; required in the flow input |  |
| (the SDK payment JSON) | `--input <file or ->` | string | no |  |
| document | `--document <file>` | object or null: { kind: "receipt", media_type, bytes, filename } | no | Named in the flow's first step. Not in the frozen flag book. |
| department | unknown | string or null | no |  |
| kind | unknown | "bill" \| "one-off" \| "reimbursement" \| "transfer" \| null | no |  |
| timeout_seconds | `--timeout-seconds <n>` | integer or null, 1 to 3600 | no (default: until the approval lapses) |  |
| (none: the signed-in person) | `--email <email>` | string | no |  |
| json | `--json` | boolean | no | Global flag of the old CLI (`blueprint/baseline/flags.ts`, globalFlags): "Print a versioned JSON result". Every example passes it. |

The input of flow client.payments.pay, as the record declares it:

```
{ to: string, amount: string, asset: string | null, org: string | null, from: string | null, department: string | null, kind: "bill" | "one-off" | "reimbursement" | "transfer" | null, pay_at: string | null, note: string | null, document: { kind: "receipt", media_type: "application/json" | "application/pdf" | "image/png" | "image/jpeg", bytes: string, filename: string | null } | null, account: string | null, suggest: string | null, request_key: string, as_directors: boolean, timeout_seconds: integer | null, json: boolean }
```

Example commands in the record:

- `capxul payment send accounts@brightside.test 1250.00 --org northwind --from finance --json` (succeeds; "Marcus pays Brightside's invoice from the Finance budget; the approval link comes back at once")
- `capxul payment send accounts@brightside.test 1250.00 --org northwind --from finance --request-key brightside-2026-01 --json` (succeeds; "The same send repeated with its request key reports where the first approval ended")
- `capxul payment send accounts@brightside.test 1250.00 --org northwind --from finance --on 2026-03-02 --json` (succeeds; "A dated payment: sent on a day instead of now")
- `capxul payment send accounts@brightside.test 1250.00 --org northwind --from finance --json` (refused: INSUFFICIENT_BALANCE, exit 2; "The Finance budget holds less than the amount")
- `capxul payment send brightside 1250.00 --json` (refused: INVALID_RECIPIENT, exit 2; "A recipient that is not an email, a handle or an address")
- `capxul payment send accounts@brightside.test 1250.00 --org northwind --from finance --json` (refused: ROLE_PERMISSION_DENIED, exit 4; "Priya holds no hat on the Finance budget")
- `capxul payment send accounts@brightside.test 9000.00 --org northwind --from finance --json` (refused: PAYROLL_BUDGET_EXCEEDED, exit 2; "More than the Finance budget has left this month")

### Result

What a success prints with `--json`:

One of 2 shapes:

- shape 1: object
  - `status`: "awaiting_approval"
  - `approvalId`: string
  - `approvalUrl`: string
  - `paymentIds`: array of string
  - `expiresAt`: string
  - `next`: string
- shape 2: object
  - `approval`: object
    - `id`: string
    - `state`: string
    - `refusal`: object | null
      - `code`: string
      - `reason`: string
  - `payments`: array of object
    - `id`: string
    - `status`: "prepared" | "scheduled" | "due" | "escrowed" | "submitted" | "needs_retry" | "settled" | "mismatched" | "cancelled"
    - `route`: "personal" | "budget" | "board" | "claim_escrow" | "chain"
    - `amount`: object
      - `asset`: string
      - `value`: string
    - `direction`: "out" | "in"
    - `counterparty`: string
    - `paymentId`: string
    - `payAt`: string | null
    - `receipt`: object | null
      - `chainId`: integer
      - `txHash`: string
    - `execution`: object
      - `approvalId`: string | null
      - `proposalId`: string | null
      - `outcome`: "declined" | "refused" | "rejected" | "expired" | "displaced" | "reverted" | "window_closed" | "voided" | "budget_cancelled" | "refunded" | "withdrawn" | null
      - `needsRetry`: boolean
    - `documents`: array of object
      - `documentId`: string
      - `documentHash`: string
      - `render`: string
    - `timing`: object
      - `createdAt`: string
      - `sentAt`: string | null
      - `settledAt`: string | null

### Refusals

1. `CLI_USAGE` (exit 2), from the starting world `person-with-funded-safe`:
   > `--as-directors` without `--org`, an asset you do not hold, or both `<to> <amount>` and `--input`, or both `--on` and `--at`.
2. `INVALID_RECIPIENT` (exit 2), from the starting world `person-with-funded-safe`:
   > The address is mistyped, or the recipient is nothing at all. The refusal names it. Also a mailbox with no account yet whose Safe could never be claimed (not ASCII), so no claim escrow can wait for it (payments.claim-escrow-routes).
3. `INVALID_INPUT` (exit 2), from the starting world `person-with-funded-safe`:
   > The signature does not recover the account's signer, or the execution is unknown; or `--on` or `--at` is not in the future, `--account` names no code of the payer's chart (an Organization's open ledger accounts, a person's fixed personal chart), or `--suggest` comes without `--account` 4999 or 6999.
4. `INSUFFICIENT_BALANCE` (exit 2), from the starting world `person-with-empty-safe`:
   > Your Safe, or the company Safe, holds less than the amount.
5. `ROLE_PERMISSION_DENIED` (exit 4), from the starting world `org-with-budgets`:
   > With `--org`, you wear no hat on this budget or above it (no spending allowance for the asset); with `--as-directors`, you are not a Director.
6. `PAYROLL_BUDGET_EXCEEDED` (exit 2), from the starting world `org-with-budgets`:
   > More than the budget has left this period, or over the token's Roles payout ceiling.
7. `WRONG_STATE` (exit 2), from the starting world `org-with-budgets`:
   > The budget or one above it is closed.
8. `SUPERSEDED` (exit 6), from the starting world `person-with-funded-safe`:
   > The sponsorship expired or the claim could not be observed, so the payment must be retried.
9. `NOT_AUTHENTICATED` (exit 3), from the starting world `signed-out`:
   > You are not signed in.

Other declared errors, with no starting world and no `when`:

- `CANCELLED` (exit 130): declared by flow client.payments.pay
- `TRANSACTION_FAILED` (exit 5): declared by flow client.payments.pay
- `PROVIDER_ERROR` (exit 5): declared by rpc payments.commands.prepare; rpc payments.commands.propose; rpc books.annotations.save
- `PROVIDER_RESPONSE_INVALID` (exit 5): declared by rpc payments.commands.prepare; rpc payments.commands.propose; rpc books.annotations.save
- `FEATURE_NOT_AVAILABLE` (exit 6): declared by procedure board.propose; rpc books.annotations.save; rpc approvals.signing.sign

### Claims

1. *(thin line)* "A signed personal payment is sent once and records its one Payment."
   - Observes: "chain: one UserOperation and one PaymentSent carry the payment id; read: `payment list` shows exactly one Payment for it, settled"
   - Test id: `acc:payment.send/c-c9400dfaeba081e7`
2. "A replay of the same signature answers with the same hash and sends nothing more."
   - Observes: "cli: the second signing answers the same UserOperation hash; chain: one UserOperationEvent, one PaymentSent"
   - Test id: `acc:payment.send/c-59edd1848ac75c56`
3. "A signature that does not recover the account's signer, an unknown execution and another person's execution are each refused and nothing is sent."
   - Observes: "cli: each is refused with its code; chain: no UserOperation from the Safe; read: the Payment still reads prepared"
   - Test id: `acc:payment.send/c-59a1c78521a27aca`
4. "An Organization payment uses the one spending allowance you hold for the asset, and with several asks which and takes `--from`."
   - Observes: "cli: with one allowance it is used unasked; with several the CLI asks which and `--from` names one"
   - Test id: `acc:payment.send/c-f0567d73a498e614`
5. "An expired approval is refused and names the wait command."
   - Observes: "cli: the refusal names `capxul payment wait` with the approval id"
   - Test id: `acc:payment.send/c-37ce3ad182b6ecb0`
6. "A mistyped address, and a recipient that is nothing, are refused naming it."
   - Observes: "cli: INVALID_RECIPIENT names the typed address or recipient; world: nothing written"
   - Test id: `acc:payment.send/c-fd8fc63a3750fb85`
7. "A payment from a spending allowance is one `Budgets.spend` from the wearer's Safe; before anyone signs, the route must name that allowance's own active budget, and a route to another budget, a pending allowance or an unreadable list is closed unsent."
   - Observes: "chain: the operation's calldata is one `Budgets.spend` on the allowance's own budget id; cli and world: another budget, a pending allowance or a failed read is refused with nothing sent"
   - Test id: `acc:payment.send/c-dd1de9fc08186cfb`
8. "A dated Director payment is one exact `Budgets.schedule` of the asked amount to the asked address on a v4 Budgets; another amount, recipient or contract is refused before anyone approves."
   - Observes: "chain: the proposal's calldata is one `Budgets.schedule` of the asked amount to the asked address on the v4 Budgets; cli: another is refused before any approval"
   - Test id: `acc:payment.send/c-88977816e3ab1aa9`
9. "Once its Board proposal executes, each item reads `scheduled` with the scheduled id of its own `Budgets.schedule`, never one on another budget, and it still does when a chain read fails once on the way."
   - Observes: "read: `payment get` shows each item scheduled with its id; chain: PaymentScheduled logs with the items' job nonces; world: the node's fault switch fails one read"
   - Test id: `acc:payment.send/c-e0782c0ab0380104`

### Events

| Event | Transition | Sent by |
|---|---|---|
| `payment_transitioned` | `payment.open` (birth to prepared) | rpc payments.commands.prepare |
| `party_transitioned` | `party.name_person` (birth to provisional) | procedure parties.resolve-recipient |
| `party_transitioned` | `party.name_address` (birth to outside) | procedure parties.resolve-recipient |
| `party_transitioned` | `party.adopt_mailbox` (outside to provisional) | procedure parties.resolve-recipient |
| `approval_transitioned` | `approval.open` (birth to sponsoring) | procedure approvals.open |
| `payment_transitioned` | `payment.open` (birth to prepared) | rpc payments.commands.propose |
| `proposal_transitioned` | `proposal.propose` (birth to awaiting_approvals) | procedure board.propose |
| `book_annotation_transitioned` | `book-annotation.queue` (birth to waiting) | rpc books.annotations.save |
| `book_annotation_transitioned` | `book-annotation.assign` (birth to decided) | rpc books.annotations.save |
| `book_annotation_transitioned` | `book-annotation.requeue` (waiting or decided to waiting) | rpc books.annotations.save |
| `book_annotation_transitioned` | `book-annotation.recategorize` (waiting or decided to decided) | rpc books.annotations.save |
| `approval_transitioned` | `approval.sign` (pending to signed) | rpc approvals.signing.sign |

What each event carries:

- `payment_transitioned`: `{ from: "prepared" | "scheduled" | "due" | "escrowed" | "submitted" | "needs_retry" | "settled" | "mismatched" | "cancelled" | null, to: "prepared" | "scheduled" | "due" | "escrowed" | "submitted" | "needs_retry" | "settled" | "mismatched" | "cancelled", transition: string, payment_id: string, owner_kind: "person" | "organization", owner_id: string, command_id: string | null, route: "personal" | "budget" | "board" | "claim_escrow" | "chain", outcome: "declined" | "refused" | "rejected" | "expired" | "displaced" | "reverted" | "window_closed" | "voided" | "budget_cancelled" | "refunded" | "withdrawn" | null }`
- `party_transitioned`: `{ from: "provisional" | "outside" | "pending" | "active" | "released" | null, to: "provisional" | "outside" | "pending" | "active" | "released", transition: "name_person" | "name_address" | "adopt_mailbox" | "onboard" | "claim" | "register" | "activate" | "release", party_id: string, kind: "person" | "agent" | "organization" | "address", owner_kind: "person" | "organization" | null, owner_id: string | null }`
- `approval_transitioned`: `{ from: "sponsoring" | "pending" | "signed" | "sending" | "sent" | "landed" | "reverted" | "displaced" | "expired" | "declined" | "refused" | "withdrawn" | null, to: "sponsoring" | "pending" | "signed" | "sending" | "sent" | "landed" | "reverted" | "displaced" | "expired" | "declined" | "refused" | "withdrawn", transition: "open" | "sponsor" | "refuse" | "sign" | "decline" | "withdraw" | "claim_send" | "accept" | "bounce" | "land" | "revert" | "displace" | "expire", approval_id: string, person_id: string, org_id: string | null, opener: "accounts" | "organizations" | "board" | "agents" | "budgets" | "payments" | "payroll" | "equity", subject_kind: string, subject_id: string }`
- `proposal_transitioned`: `{ from: "awaiting_approvals" | "executed" | "failed" | "rejected" | "replaced" | null, to: "awaiting_approvals" | "executed" | "failed" | "rejected" | "replaced", transition: "propose" | "execute" | "fail" | "reject" | "replace", proposal_id: string, org_id: string, kind: "transaction" | "rejection" | "scheduled_payment", nonce: integer, opener: "board" | "agents" | "budgets" | "payments" | "payroll" | "equity", subject_kind: string, subject_id: string }`
- `book_annotation_transitioned`: `{ from: string | null, to: string, transition: string, owner_kind: string, owner_id: string, reference_kind: string, reference_id: string, account: string | null }`

These are every event some branch of the flow can send, not one list for one call. A personal payment sends `payment_transitioned` (open), one `party_transitioned` only when the payee is new, `approval_transitioned` (open), and `approval_transitioned` (sign) when the signature is given through the rpc. `proposal_transitioned` is sent only with `--as-directors`. `book_annotation_transitioned` is sent only for a personal payment with `--account` or `--suggest`. The payment is submitted and settled later by background processes.

Started by this operation and running after it answers (their events are not part of the call):

- process `approvals.lifecycle.carry` ("Carry one approval from sponsorship to chain proof"), started by the transition approval.open; it drives `approval.sponsor`, `approval.refuse`, `approval.claim_send`, `approval.accept`, `approval.bounce`, `approval.land`, `approval.revert`, `approval.displace`, `approval.expire`, sending `approval_transitioned`
- process `board.proposals.carry` ("One Board proposal, from birth to the transaction at its nonce"), started by the transition proposal.propose; it drives `proposal.execute`, `proposal.fail`, `proposal.reject`, `proposal.replace`, `officer-change.apply`, `officer-change.end`, sending `proposal_transitioned`, `officer_change_transitioned`
- process `payments.lifecycle.payment` ("Carry one Payment from its birth to settled or cancelled"), started by the transition payment.open; it drives `payment.schedule`, `payment.come_due`, `payment.escrow`, `payment.submit`, `payment.settle`, `payment.mismatch`, `payment.unsettle`, `payment.lapse`, `payment.cancel`, sending `payment_transitioned`
- process `activity.changes.note-payment-open` ("A Payment was born: note it in its feeds"), started by the transition payment.open; it drives no transition
- process `notices.board.proposal-waiting` ("Tell the Directors a Board proposal waits for their approval"), started by the transition proposal.propose; it drives `notice.send`, `notice.hold`, `notice.refuse`, sending `notice_transitioned`

### Budget

- The operation: class `chain-submit`, p50 2,000 ms, p95 4,000 ms
- The flow client.payments.pay it runs: class `chain-submit`, p50 2,000 ms, p95 4,000 ms

### Touches

| Part of a world | Needed |
|---|---|
| database | yes: payment-commands, payments, parties, documents, approvals (and board and books tables on other branches) |
| chain | yes: balance and budget reads before, one UserOperation, and `PaymentSent` to settle |
| index | yes: the payment settles when `PaymentSent` is indexed; budget and hat reads come from the index |
| Frappe site | not for a plain send. `evals/thin-line.md` step 6 also asks that the Payment Entry posts once and the invoice has nothing outstanding |
| clock | no |
| snapshot store | no |
| signing | yes: the payer signs the approval; the claim counts one UserOperation |
| must exist first | A signed-in person with a funded Safe, or with `--org` a budget hat. For the thin line: the payment held by step 5. |

- Tables read: payment-commands (payments), payments (payments), parties (parties), organizations (organizations), org-members (organizations), budgets (budgets), documents (documents), approvals (approvals), principals (access), org-deployments (organizations), chain-budgets (indexing), hat-wearers (indexing), feature-flags (access), safe-owners (indexing), safe-approvals (indexing), board-proposals (board), proposal-approvals (board), book-feeds (books), book-annotations (books), book-facts (books)
- Tables written: payment-commands (payments), payments (payments), parties (parties), documents (documents), approvals (approvals), board-proposals (board), proposal-approvals (board), book-feeds (books), book-annotations (books), book-facts (books)
- Outside calls: openfort.signDigest, chain-rpc.readContract, chain-rpc.getCode, frappe-site.doorCall
- Contract functions named: erc20.balanceOf, budgets.leftOf, budgets.authorised, payments.paymentId, escrow-factory.predictPaymentId, escrow-factory.predictAddress, companies-house-claimer.safeAddressFor, erc20.approve, payments.send, payments.sendBatch, budgets.spend, budgets.schedule, escrow-factory.deploy
- Steps the client does itself: read-document (build), choose-budget (prompt), check (build), sign (sign), approval (wait), chain (wait)

### Source

- `blueprint/payments/operations.ts:136`: the operation record
- `blueprint/payments/flows.ts:78`: implemented by flow client.payments.pay
- `blueprint/baseline/operations.ts:18498`: the frozen text
- `blueprint/baseline/flags.ts:2408`: the old CLI's flags
- `blueprint/payments/commands.ts:106`: the rpc that prepares a payment
- `blueprint/payments/examples.ts:66`: examples
- `blueprint/sites/thin-line.ts:32`: the decision on how this step is tested
- `blueprint/plugs/decisions.ts:197`: signatures are made with a key
- `blueprint/payments/data.ts:346`: event payment_transitioned
- `blueprint/parties/data.ts:154`: event party_transitioned
- `blueprint/approvals/data.ts:184`: event approval_transitioned
- `blueprint/board/data.ts:334`: event proposal_transitioned
- `blueprint/books/data.ts:161`: event book_annotation_transitioned
- `evals/thin-line.md:29`: the journey step and its primary test
- `blueprint/sites/thin-line.ts:11`: the journey record

### Doubts

1. This is the largest gap. The thin line's step 6 is "Sign the held payment with the hat holder's test key", but `payment send` takes a payee and an amount and prepares a new payment. None of the twelve records has an input that signs an approval that already exists. `evals/thin-line.md` marks this step as a near-miss that does not score, and decision `sites.thin-line-tests` says the spike's approval sign "is evidence for the target payment send step, not a new target command".
2. The thin line's claim is the first: "A signed personal payment is sent once and records its one Payment." The thin line pays from the company's Safe as an office holder, not from a personal Safe.
3. The flow signs through Openfort in a browser (`openfort.signDigest`). Decision `plugs.no-openfort` says every signature is made with a key.
4. The CLI result (`returns`) is one of two shapes: the hand-over (`awaiting_approval`) with `--json`, or the ended approval with its payments. The flow's own output is a third, wider shape in snake_case. The records do not agree on one success shape.
5. Claims 4, 7, 8 and 9 are about spending allowances, dated Director payments and scheduling. Refusals PAYROLL_BUDGET_EXCEEDED and WRONG_STATE need a budget tree. None of this is in the thin line.
6. The budget (class chain-submit, p95 4,000 ms) lists no excluded waits, though the flow waits for a person and for the chain.
7. The flow's own errors SUPERSEDED, CANCELLED and TRANSACTION_FAILED come from the approval's end, after the first answer. Only SUPERSEDED is listed as a refusal with a starting world.

## 7. `report.run`

### Operation

- Operation: `report.run` (Run a report with filters)
- CLI command today: `capxul report run`
- Concept that owns it: sites (the old record's area: sites)
- Who may call it: "A person or an agent whose Frappe user a hat created."
- What it changes: "Nothing: it only reads."
- Implemented by: rpc sites.door.reports-run
- In the journey: step 7, run as office-holder, seen on screen `general-ledger`; primary test `acc:report.run/c-6c39c42c744b8c91`

### Payload

Read from: The rpc input `sites.door.reports-run` and the examples.

| Input | On the command line | Type | Required | Note |
|---|---|---|---|---|
| report | `<report>` (argument) | string | yes | Example: `"General Ledger"`. |
| filters | `--filter <name>=<value>`, repeated | record of string to any value, or null | no | Example: `--filter account="Capxul Safe"`. |
| orgId | unknown for this command | string | yes in the rpc input | The old CLI has a global `--org <handle>` flag ("act as this organization for one command", `blueprint/baseline/flags.ts`, globalFlags). No door example passes it. |
| json | `--json` | boolean | no | Global flag of the old CLI (`blueprint/baseline/flags.ts`, globalFlags): "Print a versioned JSON result". Every example passes it. |

The input of rpc sites.door.reports-run, as the record declares it:

```
{ orgId: string, report: string, filters: record of string to any value | null }
```

Example commands in the record:

- `capxul report run "General Ledger" --filter account="Capxul Safe" --json` (succeeds; "Run the General Ledger for the Safe's account")
- `capxul report run "Ledger of Everything" --json` (refused: INVALID_INPUT, exit 2; "No such report")

### Result

What a success prints with `--json`:

- `columns`: array of record of string to any value
- `rows`: array of record of string to any value

### Refusals

1. `NOT_AUTHENTICATED` (exit 3), from the starting world `signed-out`:
   > No one is signed in on this machine.
2. `ROLE_PERMISSION_DENIED` (exit 4), from the starting world `org-with-member`:
   > The caller has no site user in this Organization (no hat created one): the door never runs a call as another user.
3. `FEATURE_NOT_AVAILABLE` (exit 6), from the starting world `org-with-site-features`:
   > The call reaches a document of a part that is switched off for this company; the site refuses and nothing changes.
4. `PROVIDER_ERROR` (exit 5), from the starting world `org-with-site-down`:
   > The site's bench is stopped.
5. `INVALID_INPUT` (exit 2), from the starting world `org-with-site`:
   > No such report, or a filter it does not take.

Other declared errors, with no starting world and no `when`:

- `CLI_USAGE` (exit 2): declared by the operation's own `errors` (raised by the CLI)
- `PROVIDER_RESPONSE_INVALID` (exit 5): declared by rpc sites.door.reports-run

### Claims

1. *(thin line)* "A report runs as the caller and the books agree with the chain."
   - Observes: "cli: `report run "General Ledger" --filter account="Capxul Safe"` prints a ledger whose total equals the Safe's balance on chain at the world's now; a report of an off part exits FEATURE_NOT_AVAILABLE."
   - Test id: `acc:report.run/c-6c39c42c744b8c91`

### Events

None found. What implements it drives no transition, invokes no procedure and declares no event.

### Budget

- The operation: class `write`, p50 700 ms, p95 1,500 ms
- The rpc sites.door.reports-run it runs: class `vendor`, p50 1,500 ms, p95 8,000 ms. Why: "A report reads many rows on the site; the spike timed no report run, so this is an assumption the first report eval replaces with a measurement."

### Touches

| Part of a world | Needed |
|---|---|
| database | yes: it reads sites, site-users and site-features and writes door-calls |
| chain | not for the call. The claim compares the ledger with the Safe's balance on the chain |
| index | no |
| Frappe site | yes |
| clock | only for the claim: the balance is read "at the world's now" |
| snapshot store | no |
| signing | no |
| must exist first | A company with a ready site, a caller with a site user, and for the claim a posted payment. |

- Tables read: sites (sites), site-users (plugs), site-features (sites)
- Tables written: door-calls (sites)
- Outside calls: frappe-site.doorReport
- Contract functions named: none

### Source

- `blueprint/sites/operations.ts:163`: the operation record
- `blueprint/sites/door.ts:136`: implemented by rpc sites.door.reports-run
- `blueprint/sites/operations.ts:113`: the helper that fills who, the four shared refusals and the errors
- `blueprint/sites/door.ts:135`: the rpc and its own budget
- `blueprint/sites/examples.ts:226`: examples
- `blueprint/plugs/kit.ts:54`: the default budget (write)
- `evals/thin-line.md:30`: the journey step and its primary test
- `blueprint/sites/thin-line.ts:11`: the journey record

### Doubts

1. The operation's budget is the helper's default (class write, p95 1,500 ms). Its own rpc declares class vendor with p95 8,000 ms and says: "the spike timed no report run, so this is an assumption the first report eval replaces with a measurement". The two disagree.
2. The record says the rpc "reads only", yet the door's rpcs all list `door-calls` under writes.
3. The claim's second half (the books agree with the chain) needs a chain read the operation does not make: the claim's observation reads the Safe's balance on the chain itself.
4. The result's `columns` and `rows` are untyped records. The record gives no typed shape for the two reports the thin line runs (General Ledger and Trial Balance).

## 8. `world.clock.warp`

### Operation

- Operation: `world.clock.warp` (Move the world's clock forward)
- CLI command today: `capxul world clock warp`
- Concept that owns it: devnet (the old record's area: devnet)
- Who may call it: "The world's owner: on a local devnet anyone on the machine; on a hosted world the holder of an organiser grant."
- What it changes: "The world's clock; every follower, the company sites included, follows it."
- Implemented by: rpc devnet.worlds.clock-warp
- In the journey: step 8, run as operator; primary test `acc:world.clock.warp/c-2bceeaa41942995d`

### Payload

Read from: The rpc input `devnet.worlds.clock-warp`, the `about` and the examples.

| Input | On the command line | Type | Required | Note |
|---|---|---|---|---|
| world | `<world>` (argument) | string | yes |  |
| by | `--by <duration>` | string or null | one of `by` and `to` | Examples: `7d`; `-1d` is refused. |
| to | unknown | string or null (a date) | one of `by` and `to` | The text says "by a duration or to a date"; no example shows the flag. |
| json | `--json` | boolean | no | Global flag of the old CLI (`blueprint/baseline/flags.ts`, globalFlags): "Print a versioned JSON result". Every example passes it. |

The input of rpc devnet.worlds.clock-warp, as the record declares it:

```
{ world: string, by: string | null, to: string | null }
```

Example commands in the record:

- `capxul world clock warp town --by 7d --json` (succeeds; "Warp a week, to the next payroll run")
- `capxul world clock warp town --by -1d --json` (refused: INVALID_INPUT, exit 2; "A time before now")

### Result

What a success prints with `--json`:

- `worldId`: string
- `clockMode`: "frozen" | "running"
- `rate`: number
- `worldNow`: number

### Refusals

1. `NOT_AUTHENTICATED` (exit 3), from the starting world `signed-out`:
   > No one is signed in on this machine (a hosted world needs a grant).
2. `INVALID_INPUT` (exit 2), from the starting world `empty-devnet`:
   > No world has that name.
3. `ROLE_PERMISSION_DENIED` (exit 4), from the starting world `org-with-member`:
   > A player or viewer, not an owner, tries to move the clock; nothing changes.
4. `INVALID_INPUT` (exit 2), from the starting world `world-frozen`:
   > A time before now.

Other declared errors, with no starting world and no `when`:

- `CLI_USAGE` (exit 2): declared by the operation's own `errors` (raised by the CLI)
- `WRONG_ENVIRONMENT` (exit 2): declared by rpc devnet.worlds.clock-warp
- `PROVIDER_ERROR` (exit 5): declared by rpc devnet.worlds.clock-warp
- `WRONG_STATE` (exit 2): declared by rpc devnet.worlds.clock-warp
- `WORK_DIED` (exit 5): declared by rpc devnet.worlds.clock-warp

### Claims

1. *(thin line)* "A warp moves the chain and every site together and runs what fell due."
   - Observes: "cli: in `world-frozen`, `world clock warp town1 --by 7d` prints worldNow a week on; a company's site shows its scheduled job ran for each day; `--by -1d` exits INVALID_INPUT."
   - Test id: `acc:world.clock.warp/c-2bceeaa41942995d`

### Events

None found. What implements it drives no transition, invokes no procedure and declares no event.

### Budget

- The operation: class `write`, p50 700 ms, p95 1,500 ms
- The rpc devnet.worlds.clock-warp it runs: class `write`, p50 700 ms, p95 1,500 ms

### Touches

| Part of a world | Needed |
|---|---|
| database | yes: the `worlds` row and the record (`command-records`) |
| chain | yes: the chain's time moves and empty blocks are mined |
| index | not named |
| Frappe site | every site of a `full` world; none in a `core` world |
| clock | yes: this is the clock |
| snapshot store | no |
| signing | no |
| also | Due jobs run at every stop. The claim reads a site's scheduled job. |
| must exist first | A running world with a frozen clock (the starting world `world-frozen`). |

- Tables read: worlds (devnet)
- Tables written: worlds (devnet), command-records (devnet)
- Outside calls: devnet-control.timeFollow, devnet-control.timeWarp, site-service.setClock
- Contract functions named: none

### Source

- `blueprint/devnet/world-ops.ts:64`: the operation record
- `blueprint/devnet/world-ops.ts:53`: the helper that fills who, the shared refusals and the budget
- `blueprint/devnet/world-rpcs.ts:100`: the rpc's text and input
- `blueprint/devnet/world-rpcs.ts:83`: the helper that fills the rpc's output, tables and calls
- `blueprint/devnet/world-examples.ts:109`: examples
- `evals/thin-line.md:31`: the journey step and its primary test
- `blueprint/sites/thin-line.ts:11`: the journey record

### Doubts

1. The record declares no event for a warp. The rpc writes to the record (`command-records`, whose kinds include `clock`), but declares nothing a runner could check as an event.
2. The budget is class write (p95 1,500 ms) for a call that stops at every due instant, runs due jobs and waits for every site. The thin line warps a month. The record gives no reason for the number.
3. The rpc calls a supervisor (`devnet-control.timeFollow`, `timeWarp`) and the site service (`setClock`). Roadmap step 0.8 proved two worlds at different clocks on one bench and lists four gaps to close in step 1.4 (among them: plain Python processes read host time, and Frappe caches a site's config for 60 s).
4. The claim needs a company site with a scheduled job, so it cannot be proved in a world with no site.
5. The rpc lists WORK_DIED, PROVIDER_ERROR, WRONG_STATE and WRONG_ENVIRONMENT among its errors. The operation gives none of them a starting world.

## 9. `record.export`

### Operation

- Operation: `record.export` (Export the world's record as training data)
- CLI command today: `capxul record export`
- Concept that owns it: devnet (the old record's area: devnet)
- Who may call it: "The world's owner: on a local devnet anyone on the machine; on a hosted world the holder of an organiser grant."
- What it changes: "Nothing in the world; it writes a file on this machine."
- Implemented by: rpc devnet.records.export
- In the journey: step 9, run as operator; primary test `acc:record.export/c-bd1acd26102d2d92`

### Payload

Read from: The rpc input `devnet.records.export` and the examples.

| Input | On the command line | Type | Required | Note |
|---|---|---|---|---|
| world | `--world <world>` | string | yes |  |
| (not in the rpc input) | `--out <file>` | string (a path on the caller's machine) | unknown | Example: `--out run.jsonl`. The operation "writes a file on this machine". |
| from | unknown | number or null | no | The rpc text says "Every entry of a world, or of a range". |
| to | unknown | number or null | no |  |
| json | `--json` | boolean | no | Global flag of the old CLI (`blueprint/baseline/flags.ts`, globalFlags): "Print a versioned JSON result". Every example passes it. |

The input of rpc devnet.records.export, as the record declares it:

```
{ world: string, from: number | null, to: number | null }
```

Example commands in the record:

- `capxul record export --world town2 --out run.jsonl --json` (succeeds; "Export town2's record, whose lineage names town")
- `capxul record export --world town --out run.jsonl --json` (refused: ROLE_PERMISSION_DENIED, exit 4; "Priya is a player in the world, not its owner")

### Result

What a success prints with `--json`:

- `lines`: number
- `bytes`: number
- `lineage`: object
  - `parentWorld`: string | null
  - `parentSnapshot`: string | null
  - `parentSeq`: number | null

### Refusals

1. `NOT_AUTHENTICATED` (exit 3), from the starting world `signed-out`:
   > No one is signed in on this machine (a hosted world needs a grant).
2. `INVALID_INPUT` (exit 2), from the starting world `empty-devnet`:
   > No world has that name.
3. `ROLE_PERMISSION_DENIED` (exit 4), from the starting world `org-with-member`:
   > A player or viewer, not an owner, tries to export the record; nothing changes.

Other declared errors, with no starting world and no `when`:

- `CLI_USAGE` (exit 2): declared by the operation's own `errors` (raised by the CLI)

### Claims

1. *(thin line)* "An export carries the lineage and every entry once."
   - Observes: "cli: `record export --world town3 --out run.jsonl --json` prints the line count and lineage naming town1; the file's first line is the lineage and the entries follow in order."
   - Test id: `acc:record.export/c-bd1acd26102d2d92`

### Events

None found. What implements it drives no transition, invokes no procedure and declares no event.

### Budget

- The operation: class `read`, p50 600 ms, p95 1,200 ms
- The rpc devnet.records.export it runs: class `read`, p50 600 ms, p95 1,200 ms

### Touches

| Part of a world | Needed |
|---|---|
| database | yes: it reads the record (`command-records`) and the `worlds` row. Nothing else |
| chain | no |
| index | no |
| Frappe site | no |
| clock | no |
| snapshot store | no |
| signing | no |
| also | It writes a file on the caller's machine. |
| must exist first | A world with a record. For the claim's lineage: a world restored from another. |

- Tables read: command-records (devnet), worlds (devnet)
- Tables written: none
- Outside calls: none
- Contract functions named: none

### Source

- `blueprint/devnet/world-ops.ts:103`: the operation record
- `blueprint/devnet/world-rpcs.ts:158`: implemented by rpc devnet.records.export
- `blueprint/devnet/world-rpcs.ts:157`: the rpc
- `blueprint/devnet/world-data.ts:65`: the record's table
- `blueprint/devnet/world-examples.ts:152`: examples
- `evals/thin-line.md:32`: the journey step and its primary test
- `blueprint/sites/thin-line.ts:11`: the journey record

### Doubts

1. The spike contract already has a `record.export` with no payload that returns `{ entries: [{ seq, key, kind, body }] }` (`spikes/pipeline/contract/record.ts`). The old operation returns only counts and the lineage, and puts the entries in a file on the caller's machine.
2. The old record table is described as "one append-only JSON Lines file per world". The roadmap gives each world one database (a Neon branch) for everything.
3. The thin line runs this at step 9, before any restore, so the lineage is null there. The claim's observation uses a world restored from another, which exists only after step 11; step 12's assertion exports again.
4. Roadmap rule 1 says a run copies the record out before the world is destroyed. The old record does not connect export to the end of a run.
5. The rpc is a query, but it is owner-only (a player is refused), unlike `record list` and `record show`. The rpc text notes an open question: "an export of a real customer's world needs the consent rule (assumption: not designed; open in devnet.record-readers)".

## 10. `world.snapshot.save`

### Operation

- Operation: `world.snapshot.save` (Save a snapshot of a whole world)
- CLI command today: `capxul world snapshot save`
- Concept that owns it: devnet (the old record's area: devnet)
- Who may call it: "The world's owner: on a local devnet anyone on the machine; on a hosted world the holder of an organiser grant."
- What it changes: "One snapshot; the world is unchanged."
- Implemented by: rpc devnet.worlds.snapshot-save
- In the journey: step 10, run as operator; primary test `acc:world.snapshot.save/c-69e4dbcdf13e3750`

### Payload

Read from: The rpc input `devnet.worlds.snapshot-save`, the `about` and the examples.

| Input | On the command line | Type | Required | Note |
|---|---|---|---|---|
| world | `<world>` (first argument) | string | yes |  |
| name | `<name>` (second argument) | string | yes | Example: `m3`. |
| replace | `--replace` | boolean | no |  |
| template | `--template` | boolean | no | "marks it as one new worlds can be made from" |
| json | `--json` | boolean | no | Global flag of the old CLI (`blueprint/baseline/flags.ts`, globalFlags): "Print a versioned JSON result". Every example passes it. |

The input of rpc devnet.worlds.snapshot-save, as the record declares it:

```
{ world: string, name: string, replace: boolean, template: boolean }
```

Example commands in the record:

- `capxul world snapshot save town m3 --json` (succeeds; "Save the world as m3")
- `capxul world snapshot save town m3 --json` (refused: WRONG_STATE, exit 2; "A snapshot named m3 exists and --replace was not given")
- `capxul world snapshot save town m4 --json` (refused: ROLE_PERMISSION_DENIED, exit 4; "Priya is a player in the world, not its owner")

### Result

What a success prints with `--json`:

- `name`: string
- `worldId`: string
- `epoch`: number
- `recordSeq`: number
- `clockMode`: "frozen" | "running"
- `rate`: number
- `worldNow`: number
- `template`: boolean
- `createdAt`: number
- `sites`: number

### Refusals

1. `NOT_AUTHENTICATED` (exit 3), from the starting world `signed-out`:
   > No one is signed in on this machine (a hosted world needs a grant).
2. `INVALID_INPUT` (exit 2), from the starting world `empty-devnet`:
   > No world has that name.
3. `ROLE_PERMISSION_DENIED` (exit 4), from the starting world `org-with-member`:
   > A player or viewer, not an owner, tries to save a snapshot; nothing changes.
4. `WRONG_STATE` (exit 2), from the starting world `world-with-snapshot`:
   > A snapshot of that name exists and `--replace` was not asked.

Other declared errors, with no starting world and no `when`:

- `CLI_USAGE` (exit 2): declared by the operation's own `errors` (raised by the CLI)
- `WRONG_ENVIRONMENT` (exit 2): declared by rpc devnet.worlds.snapshot-save
- `PROVIDER_ERROR` (exit 5): declared by rpc devnet.worlds.snapshot-save

### Claims

1. *(thin line)* "A snapshot saves everything that makes the world and leaves it untouched."
   - Observes: "cli: `world snapshot save town1 m3 --json` prints the epoch and recordSeq; the world's record gains no entry but the save; `world snapshot list town1` lists it."
   - Test id: `acc:world.snapshot.save/c-69e4dbcdf13e3750`

### Events

None found. What implements it drives no transition, invokes no procedure and declares no event.

### Budget

- The operation: class `background`, p50 2,000 ms, p95 15,000 ms
- The rpc devnet.worlds.snapshot-save it runs: class `background`, p50 20,000 ms, p95 60,000 ms. Why: "A snapshot saves a chain and a site backup per company: 9.4 s and 9.5 MB for four companies (measured in the spike); a hosted world's larger sites are the headroom."

### Touches

| Part of a world | Needed |
|---|---|
| database | yes: it writes `world-snapshots` and the record, and copies the whole world database |
| chain | yes: the chain's state is captured |
| index | yes: the index is stopped and its schema is copied with the database |
| Frappe site | every site of a `full` world: its database, files and configuration |
| clock | yes: the clock's mode, rate and now are saved |
| snapshot store | yes |
| signing | no |
| must exist first | A running world. |

- Tables read: worlds (devnet)
- Tables written: world-snapshots (devnet), command-records (devnet)
- Outside calls: devnet-control.snapshotSave, site-service.saveSnapshot
- Contract functions named: none

### Source

- `blueprint/devnet/world-ops.ts:68`: the operation record
- `blueprint/devnet/world-rpcs.ts:105`: implemented by rpc devnet.worlds.snapshot-save
- `blueprint/devnet/world-rpcs.ts:104`: the rpc and its own budget
- `blueprint/devnet/world-data.ts:46`: the snapshots' table
- `blueprint/devnet/world-examples.ts:114`: examples
- `evals/thin-line.md:33`: the journey step and its primary test
- `blueprint/sites/thin-line.ts:11`: the journey record

### Doubts

1. The roadmap makes a world's one database a Neon branch that can be forked from another world (step 0.2), and step 0.6 kept the chain's state across a stop through R2. It does not describe a snapshot store. The old rpc stops the writers, copies the Postgres database into a template, and takes a backup of each site.
2. The operation's budget (class background, p95 15,000 ms) is lower than its own rpc's (p50 20,000 ms, p95 60,000 ms, with a measured 9.4 s for four companies). The two disagree.
3. The record declares no event for a save.
4. The result has `sites` (a count) and `template`. Whether a snapshot of a world on a shared bench includes its sites is not said in the roadmap.
5. The rpc text says a snapshot "carries every site's encryption key and the whole database, so it is as sensitive as production". The roadmap does not say who may read a snapshot.

## 11. `world.snapshot.restore`

### Operation

- Operation: `world.snapshot.restore` (Restore a snapshot, in place or into a separate world)
- CLI command today: `capxul world snapshot restore`
- Concept that owns it: devnet (the old record's area: devnet)
- Who may call it: "The world's owner: on a local devnet anyone on the machine; on a hosted world the holder of an organiser grant."
- What it changes: "In place: the world returns to the snapshot with a higher epoch. With `--as`: a new world; the old one is untouched."
- Implemented by: rpc devnet.worlds.snapshot-restore
- In the journey: step 11, run as operator; primary test `acc:world.snapshot.restore/c-1dd79fdbcb1c0fd7`

### Payload

Read from: The rpc input `devnet.worlds.snapshot-restore`, the `about` and the examples.

| Input | On the command line | Type | Required | Note |
|---|---|---|---|---|
| world | `<world>` (first argument) | string | yes |  |
| name | `<name>` (second argument) | string | yes | The snapshot's name. Example: `m3`. |
| as | `--as <new world>` | string or null | no | Without it the restore is in place. |
| json | `--json` | boolean | no | Global flag of the old CLI (`blueprint/baseline/flags.ts`, globalFlags): "Print a versioned JSON result". Every example passes it. |

The input of rpc devnet.worlds.snapshot-restore, as the record declares it:

```
{ world: string, name: string, as: string | null }
```

Example commands in the record:

- `capxul world snapshot restore town m3 --as town2 --json` (succeeds; "Restore m3 into a separate world town2")
- `capxul world snapshot restore town m9 --json` (refused: INVALID_INPUT, exit 2; "No snapshot of that name")
- `capxul world snapshot restore town m3 --json` (refused: WRONG_STATE, exit 2; "The snapshot was saved with other backend code")

### Result

What a success prints with `--json`:

- `worldId`: string
- `name`: string
- `kind`: "local" | "simulated" | "staging" | "production"
- `profile`: "core" | "full"
- `address`: string | null
- `state`: "creating" | "running" | "stopped" | "restoring" | "parked" | "closed"
- `clockMode`: "frozen" | "running"
- `rate`: number
- `worldNow`: number
- `epoch`: number
- `chainId`: number
- `hosted`: boolean
- `parentWorld`: string | null
- `parentSnapshot`: string | null
- `parentSeq`: number | null
- `companies`: array of object
  - `orgId`: string
  - `name`: string
  - `url`: string | null
- `recordHead`: number

### Refusals

1. `NOT_AUTHENTICATED` (exit 3), from the starting world `signed-out`:
   > No one is signed in on this machine (a hosted world needs a grant).
2. `INVALID_INPUT` (exit 2), from the starting world `empty-devnet`:
   > No world has that name.
3. `ROLE_PERMISSION_DENIED` (exit 4), from the starting world `org-with-member`:
   > A player or viewer, not an owner, tries to restore a snapshot; nothing changes.
4. `INVALID_INPUT` (exit 2), from the starting world `world-with-snapshot`:
   > No snapshot of that name, or the new world's id is taken.
5. `WRONG_STATE` (exit 2), from the starting world `world-with-snapshot`:
   > The snapshot was saved with other backend code.

Other declared errors, with no starting world and no `when`:

- `CLI_USAGE` (exit 2): declared by the operation's own `errors` (raised by the CLI)
- `WRONG_ENVIRONMENT` (exit 2): declared by rpc devnet.worlds.snapshot-restore
- `PROVIDER_ERROR` (exit 5): declared by rpc devnet.worlds.snapshot-restore

### Claims

1. "An in-place restore returns the world to the snapshot and records it."
   - Observes: "cli: in `world-with-snapshot`, after more commands, `world snapshot restore town1 m3`; the diff against the saved world is empty, epoch is one higher, the record has a `restore` entry and the earlier branch is listed as abandoned."
   - Test id: `acc:world.snapshot.restore/c-369b1db183b9807f`
2. *(thin line)* "A restore into a separate world leaves the first world untouched and the two never see each other."
   - Observes: "cli: `world snapshot restore town1 m3 --as town3`; both worlds list their companies on their own addresses; a command in town3 changes nothing in town1; the new born entry names town1, m3 and the sequence."
   - Test id: `acc:world.snapshot.restore/c-1dd79fdbcb1c0fd7`

### Events

| Event | Transition | Sent by |
|---|---|---|
| `world_transitioned` | `world.restore` (running to restoring) | rpc devnet.worlds.snapshot-restore |
| `world_transitioned` | `world.restored` (restoring to running) | rpc devnet.worlds.snapshot-restore |

What each event carries:

- `world_transitioned`: `{ from: "creating" | "running" | "stopped" | "restoring" | "parked" | "closed" | null, to: "creating" | "running" | "stopped" | "restoring" | "parked" | "closed", transition: "create" | "start" | "stop" | "resume" | "restore" | "restored" | "park" | "close", world_id: string, kind: "local" | "simulated" | "staging" | "production", epoch: number }`

Both transitions belong to a restore in place (running to restoring, then restoring to running). The record names no transition for a restore into a separate world, which is the thin line's case.

### Budget

- The operation: class `background`, p50 2,000 ms, p95 15,000 ms
- The rpc devnet.worlds.snapshot-restore it runs: class `background`, p50 30,000 ms, p95 90,000 ms. Why: "A restore replaces a chain and every company's site: measured in the spike, 36 s into a new world with one company and 80 s in place for four; 90 s p95 is the headroom."

### Touches

| Part of a world | Needed |
|---|---|
| database | yes: the whole world database is restored or cloned |
| chain | yes: in place, or a new chain instance with the same chain id |
| index | yes: restored with the database |
| Frappe site | every site of a `full` world, under new addresses with `--as` |
| clock | yes: the clock resumes at the saved time |
| snapshot store | yes |
| signing | no |
| also | With `--as` it makes a second world, so everything `world.create` needs. |
| must exist first | A world with a saved snapshot (the starting world `world-with-snapshot`). |

- Tables read: world-snapshots (devnet), worlds (devnet)
- Tables written: worlds (devnet), command-records (devnet)
- Outside calls: devnet-control.snapshotRestore, devnet-control.restoreAs, site-service.restoreSnapshot
- Contract functions named: none

### Source

- `blueprint/devnet/world-ops.ts:80`: the operation record
- `blueprint/devnet/world-rpcs.ts:125`: implemented by rpc devnet.worlds.snapshot-restore
- `blueprint/devnet/world-rpcs.ts:124`: the rpc and its own budget
- `blueprint/devnet/world-decisions.ts:102`: what `--as` keeps and renames
- `blueprint/devnet/world-examples.ts:125`: examples
- `blueprint/devnet/world-data.ts:113`: event world_transitioned
- `evals/thin-line.md:34`: the journey step and its primary test
- `blueprint/sites/thin-line.ts:11`: the journey record

### Doubts

1. The thin line restores into a separate world (`--as`). The rpc drives only the in-place transitions, so the events a restore into a new world sends are not stated. A new world would be born, and nothing says `world_transitioned` with `create` is sent for it.
2. The roadmap forks a world's database by branching (step 0.2) and deploys a stack per world. The old rpc clones a Postgres template, starts a new chain instance on new ports and renames every site. The old text speaks of ports, database credentials and a shared secret; the roadmap mentions none of them.
3. The operation's budget (class background, p95 15,000 ms) is lower than its own rpc's (p50 30,000 ms, p95 90,000 ms; measured 36 s into a new world with one company and 80 s in place for four). The two disagree.
4. One operation does two things: restore in place (a new epoch) and restore into a new world. The spike contract declares one payload, one result and events sent exactly once per operation.
5. The refusal WRONG_STATE ("The snapshot was saved with other backend code") compares the code that saved the snapshot with the code now running (the example shows `saved` and `running` hashes). The roadmap deploys each world separately and does not say what happens to a snapshot saved by another version.
6. With `--as`, roadmap rule 2 applies to the new world too: it needs an owner and an expiry, and the payload has neither.

## 12. `world.show`

### Operation

- Operation: `world.show` (Show one world)
- CLI command today: `capxul world show`
- Concept that owns it: devnet (the old record's area: devnet)
- Who may call it: "Anyone with a grant in the world; on a local devnet anyone on the machine."
- What it changes: "Nothing: it only reads."
- Implemented by: rpc devnet.worlds.show
- In the journey: step 12, run as operator; primary test `acc:world.show/c-6aa449b0c9f7abaf`

### Payload

Read from: The rpc input `devnet.worlds.show` and the examples.

| Input | On the command line | Type | Required | Note |
|---|---|---|---|---|
| world | `<world>` (argument) | string | yes |  |
| json | `--json` | boolean | no | Global flag of the old CLI (`blueprint/baseline/flags.ts`, globalFlags): "Print a versioned JSON result". Every example passes it. |

The input of rpc devnet.worlds.show, as the record declares it:

```
{ world: string }
```

Example commands in the record:

- `capxul world show town --json` (succeeds; "Show town")
- `capxul world show tow --json` (refused: INVALID_INPUT, exit 2; "No world has that name")

### Result

What a success prints with `--json`:

- `worldId`: string
- `name`: string
- `kind`: "local" | "simulated" | "staging" | "production"
- `profile`: "core" | "full"
- `address`: string | null
- `state`: "creating" | "running" | "stopped" | "restoring" | "parked" | "closed"
- `clockMode`: "frozen" | "running"
- `rate`: number
- `worldNow`: number
- `epoch`: number
- `chainId`: number
- `hosted`: boolean
- `parentWorld`: string | null
- `parentSnapshot`: string | null
- `parentSeq`: number | null
- `companies`: array of object
  - `orgId`: string
  - `name`: string
  - `url`: string | null
- `recordHead`: number

### Refusals

1. `NOT_AUTHENTICATED` (exit 3), from the starting world `signed-out`:
   > No one is signed in on this machine (a hosted world needs a grant).
2. `INVALID_INPUT` (exit 2), from the starting world `empty-devnet`:
   > No world has that name.

Other declared errors, with no starting world and no `when`:

- `CLI_USAGE` (exit 2): declared by the operation's own `errors` (raised by the CLI)

### Claims

1. *(thin line)* "A world restored into another names its parent."
   - Observes: "cli: in `world-with-snapshot`, after `world snapshot restore town1 m3 --as town3`, `world show town3 --json` prints parentWorld town1, parentSnapshot m3 and parentSeq."
   - Test id: `acc:world.show/c-6aa449b0c9f7abaf`

### Events

None found. What implements it drives no transition, invokes no procedure and declares no event.

### Budget

- The operation: class `read`, p50 600 ms, p95 1,200 ms
- The rpc devnet.worlds.show it runs: class `read`, p50 600 ms, p95 1,200 ms

### Touches

| Part of a world | Needed |
|---|---|
| database | yes: it reads the `worlds` row and the record. Nothing else |
| chain | no: "It reads the rows, so it answers while the chain is stopped." |
| index | no |
| Frappe site | no |
| clock | no: it reports the clock from the row |
| snapshot store | no |
| signing | no |
| must exist first | A world. For the claim: a world restored from another. |

- Tables read: worlds (devnet), command-records (devnet)
- Tables written: none
- Outside calls: none
- Contract functions named: none

### Source

- `blueprint/devnet/world-ops.ts:40`: the operation record
- `blueprint/devnet/world-rpcs.ts:73`: implemented by rpc devnet.worlds.show
- `blueprint/devnet/world-rpcs.ts:72`: the rpc
- `blueprint/devnet/world-rpcs.ts:32`: the result's shape
- `blueprint/devnet/world-examples.ts:82`: examples
- `evals/thin-line.md:35`: the journey step and its primary test
- `blueprint/sites/thin-line.ts:11`: the journey record

### Doubts

1. The result's `kind` (local, simulated, staging, production), `profile`, `hosted` and `address` describe the old hosting model. The roadmap has three grades, an owner and an expiry, none of which are in the result.
2. The result's `state` includes `parked`, a state for idle sites on a hosted bench. Roadmap rule 3 says keeping a world is explicit, costs nothing while parked and is time-limited, which is a different meaning.
3. `worldNow` is read from the row. For a running clock the record does not say how fresh the row is.
4. The thin line's claim can be proved only after step 11 has restored a world. A separate claim for a world with no parent is not written.

## Starting worlds the refusals name

A starting world is the `given` of a refusal. The catalog is `blueprint/devnet/worlds.ts`.

| Starting world | In the catalog | What it holds | Named by |
|---|---|---|---|
| `signed-out` | yes | No session on this machine: the state of empty-devnet. | `world.create`, `org.create`, `doc.create`, `doc.submit`, `payment.send`, `report.run`, `world.clock.warp`, `record.export`, `world.snapshot.save`, `world.snapshot.restore`, `world.show` |
| `empty-devnet` | yes | Protocol v4 deployed by Companies House from packages/contracts, with the general escrow (payments.escrow-contract-build), Ponder at the head, no principal, no mail, a fresh CLI home, the clock frozen at the eval epoch at rate 1 and unmoved. | `world.create`, `world.clock.warp`, `record.export`, `world.snapshot.save`, `world.snapshot.restore`, `world.show` |
| `org-with-member` | yes | org-ready plus Sam's Seat with no hat, and Olga (olga@outside.test) ready and outside Acme; Dana current. | `world.create`, `doc.create`, `doc.submit`, `report.run`, `world.clock.warp`, `record.export`, `world.snapshot.save`, `world.snapshot.restore` |
| `person-ready` | yes | Dana admitted, profile done, her Safe claimed by Companies House with her dev signer; no Organization, no money. | `org.create` |
| `two-founders` | yes | org-ready plus Sam's own ready Organization Globex; neither founder is in the other's; Dana current. | `org.create` |
| `person-unclaimed` | yes | Dana admitted with her profile done and three invites, her Safe not set up. | `org.create` |
| `person-on-waitlist` | yes | Dana signed in and on the waitlist, waiting, in the devnet's closed beta. | `org.create` |
| `org-with-founder-board` | yes | org-with-member (Acme fresh from setup, Dana the one Director, 1 of 1, wearing the Shareholders' top hat; Sam set up; Olga outside and signed in) plus Pat, a member who has not finished signing up; Dana current. | `org.member.grant` |
| `org-with-waiting-proposals` | yes | org-with-two-directors plus two proposals waiting at consecutive nonces, one executed, one rejected, one replaced outside Capxul, a waiting rejection, Sam wearing the Books hat and a waiting Invoicing grant. | `org.member.grant` |
| `org-with-proposals-gate-off` | yes | org-with-founder-board with the `owner-safe-proposals` gate off for Acme. | `org.member.grant` |
| `org-with-budget-tree` | yes | Acme with Directors Dana and Eli (2 of 2), the People hat on Pat, members Mia, Sam, Lead and Plat, outsider Olga signed in and current; USDC top budget `company` 1,200,000 a year (Board) with `engineering` 800,000 (Lead), its teams `platform` 300,000 (Plat) and `hiring` 100,000 closed, and `operations` 300,000 with the team chain `ops-1`…`ops-7` eight deep; top budget `monthly-spend` 10,000 a month with allowance `office-costs` 2,000 a month worn by Mia, 600 spent; the USDC payout ceiling 1,200,000 a year; EURC admitted with no budget; DAI not admitted. | `org.member.grant` |
| `cli-signed-out` | yes | No sign-in: the state of empty-devnet, under budgets' name. | `org.member.grant` |
| `org-with-site-features` | no | Not in the catalog (blueprint/devnet/worlds.ts), and no record describes what it holds. | `doc.create`, `doc.submit`, `report.run` |
| `org-with-site-down` | no | Not in the catalog (blueprint/devnet/worlds.ts). Decision plugs.worlds describes it as: "the bench stopped". | `doc.create`, `doc.submit`, `report.run` |
| `org-with-site` | no | Not in the catalog (blueprint/devnet/worlds.ts). Decision plugs.worlds describes it as: "a company with its site ready". | `doc.create`, `doc.submit`, `report.run` |
| `person-with-funded-safe` | yes | Dana ready with 1,000 USDC in her Safe and current; Sam ready with a live Safe; nobody@outside.test has no account. | `payment.send` |
| `person-with-empty-safe` | yes | Dana ready and current with no USDC, and one payment to Sam whose approval expired unsigned. | `payment.send` |
| `org-with-budgets` | yes | org-with-budget-tree (two Directors, a funded company Safe, `engineering` held by Lead, `office-costs` worn by Mia, `hiring` closed, Sam holding nothing, Olga outside and signed in) plus a proposed department `research`. | `payment.send` |
| `world-frozen` | no | Not in the catalog (blueprint/devnet/worlds.ts), and no record describes what it holds. | `world.clock.warp` |
| `world-with-snapshot` | no | Not in the catalog (blueprint/devnet/worlds.ts), and no record describes what it holds. | `world.snapshot.save`, `world.snapshot.restore` |

## The twelve, ordered by what they touch

Fewest always-needed parts first; equal counts keep the journey's order. A part counts when the operation's own call needs it. What only the thin line's claim needs is under `touches` of each operation. An operation early in this order can still need state that only a later one makes; the last column says what.

| Order | Operation | Step | The call always needs | Needs in some cases | Must exist first |
|---|---|---|---|---|---|
| 1 | `record.export` | 9 | database | nothing more | A world with a record. For the claim's lineage: a world restored from another. |
| 2 | `world.show` | 12 | database | nothing more | A world. For the claim: a world restored from another. |
| 3 | `doc.create` | 4 | database, Frappe site | nothing more | A company with a ready site, and a caller whose Frappe user a hat created (so hats must have reached the site first). |
| 4 | `report.run` | 7 | database, Frappe site | clock: only for the claim: the balance is read "at the world's now" | A company with a ready site, a caller with a site user, and for the claim a posted payment. |
| 5 | `world.create` | 1 | database, chain, clock | Frappe site: only with `--profile full` and a template that has companies; snapshot store: only with a `--template` saved from a snapshot | Nothing. It is the first step. |
| 6 | `doc.submit` | 5 | database, index, Frappe site | nothing more | A draft document on the site. For the thin line: a draft Payment Entry from the Safe's account, and a signer who wears a hat that may pay. |
| 7 | `world.clock.warp` | 8 | database, chain, clock | Frappe site: every site of a `full` world; none in a `core` world | A running world with a frozen clock (the starting world `world-frozen`). |
| 8 | `org.create` | 2 | database, chain, index, signing | nothing more | A signed-in person, admitted from the waitlist, whose personal Safe is claimed (the starting world `person-ready`). |
| 9 | `org.member.grant` | 3 | database, chain, index, signing | nothing more | A company that is set up, the caller a Director, and the member a current member with a claimed personal Safe. |
| 10 | `payment.send` | 6 | database, chain, index, signing | nothing more | A signed-in person with a funded Safe, or with `--org` a budget hat. For the thin line: the payment held by step 5. |
| 11 | `world.snapshot.save` | 10 | database, chain, index, clock, snapshot store | Frappe site: every site of a `full` world: its database, files and configuration | A running world. |
| 12 | `world.snapshot.restore` | 11 | database, chain, index, clock, snapshot store | Frappe site: every site of a `full` world, under new addresses with `--as` | A world with a saved snapshot (the starting world `world-with-snapshot`). |

## Every error code and event the twelve use

| Error code | Exit | A refusal of | Otherwise declared by |
|---|---|---|---|
| `NOT_AUTHENTICATED` | 3 | `world.create`, `org.create`, `org.member.grant`, `doc.create`, `doc.submit`, `payment.send`, `report.run`, `world.clock.warp`, `record.export`, `world.snapshot.save`, `world.snapshot.restore`, `world.show` | none |
| `INVALID_INPUT` | 2 | `world.create`, `org.create`, `org.member.grant`, `doc.create`, `payment.send`, `report.run`, `world.clock.warp`, `record.export`, `world.snapshot.save`, `world.snapshot.restore`, `world.show` | `doc.submit` |
| `ROLE_PERMISSION_DENIED` | 4 | `world.create`, `org.member.grant`, `doc.create`, `doc.submit`, `payment.send`, `report.run`, `world.clock.warp`, `record.export`, `world.snapshot.save`, `world.snapshot.restore` | `org.create` |
| `WRONG_STATE` | 2 | `org.create`, `org.member.grant`, `doc.submit`, `payment.send`, `world.snapshot.save`, `world.snapshot.restore` | `world.clock.warp` |
| `FEATURE_NOT_AVAILABLE` | 6 | `org.create`, `org.member.grant`, `doc.create`, `doc.submit`, `report.run` | `payment.send` |
| `PROVIDER_ERROR` | 5 | `doc.create`, `doc.submit`, `report.run` | `world.create`, `org.member.grant`, `payment.send`, `world.clock.warp`, `world.snapshot.save`, `world.snapshot.restore` |
| `CLI_USAGE` | 2 | `org.create`, `payment.send` | `world.create`, `org.member.grant`, `doc.create`, `doc.submit`, `report.run`, `world.clock.warp`, `record.export`, `world.snapshot.save`, `world.snapshot.restore`, `world.show` |
| `CAPACITY_REACHED` | 6 | `world.create` | none |
| `INSUFFICIENT_BALANCE` | 2 | `payment.send` | `doc.submit` |
| `INVALID_RECIPIENT` | 2 | `payment.send` | `doc.submit` |
| `PAYROLL_BUDGET_EXCEEDED` | 2 | `payment.send` | `doc.submit` |
| `ROLE_CONFLICT` | 6 | `org.member.grant` | none |
| `SUPERSEDED` | 6 | `payment.send` | none |
| `AUTHORISED_EXCEEDED` | 2 | none | `doc.submit` |
| `CANCELLED` | 130 | none | `org.create`, `org.member.grant`, `payment.send` |
| `CLI_DEADLINE` | 5 | none | `org.create` |
| `CLI_STORAGE` | 2 | none | `org.create` |
| `PROVIDER_RESPONSE_INVALID` | 5 | none | `org.member.grant`, `doc.create`, `doc.submit`, `payment.send`, `report.run` |
| `TRANSACTION_FAILED` | 5 | none | `payment.send` |
| `WORK_DIED` | 5 | none | `world.clock.warp` |
| `WRONG_ENVIRONMENT` | 2 | none | `world.create`, `world.clock.warp`, `world.snapshot.save`, `world.snapshot.restore` |

| Event | Sent by | Defined at |
|---|---|---|
| `world_transitioned` | `world.create`, `world.snapshot.restore` | `blueprint/devnet/world-data.ts:113` |
| `org_setup_transitioned` | `org.create` | `blueprint/organizations/data.ts:741` |
| `org_app_transitioned` | `org.create` | `blueprint/organizations/data.ts:1042` |
| `party_transitioned` | `org.create`, `payment.send` | `blueprint/parties/data.ts:154` |
| `officer_change_transitioned` | `org.member.grant` | `blueprint/board/data.ts:483` |
| `proposal_transitioned` | `org.member.grant`, `payment.send` | `blueprint/board/data.ts:334` |
| `approval_transitioned` | `org.member.grant`, `doc.submit`, `payment.send` | `blueprint/approvals/data.ts:184` |
| `payment_request_transitioned` | `doc.submit` | `blueprint/plugs/data.ts:329` |
| `payment_transitioned` | `doc.submit`, `payment.send` | `blueprint/payments/data.ts:346` |
| `book_annotation_transitioned` | `payment.send` | `blueprint/books/data.ts:161` |
