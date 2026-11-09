# swarmD today: what the original Capxul's swarm CLI would wrap

Inventory for `swarm-cli.md`: what swarmD has, what its docs promise but the code does not do, how to pin a version,
and what a project-specific management tool for `Xelmar-tech/infrastructure` would wrap. Read only; nothing in swarmD
or on its server was changed.

**Sources and how claims are cited**

| Prefix | Means |
|---|---|
| none, e.g. `packages/server/src/main.ts:65` | The checkout `/home/user/swarmd` at `9703092` ("Docs as the specification", #91, 2026-11-08 09:30 UTC), relative to its root |
| `main@2c46d82:` / `main@b905582:` | The same repository's `origin/main`, read through GitHub (no fetch into the checkout). `2c46d82` is what is deployed (below); `b905582` adds only the session handoff |
| `live GET /path → status` | A GET against `$SWARMD_URL` on 2026-11-09 at about 09:34 UTC, with `$SWARMD_TOKEN` (user `aaron`) |

## 1. The facts that change the plan

1. **The checkout is not what is deployed.** `origin/main` is 35 merged PRs (#92 to #126) past `9703092`. The handoff
   says "main is at `2c46d82`. The deployed Worker is `7b0d1d61`" (`main@b905582:docs/planning/session-handoff-2026-11-09.md:48`).
   The server agrees: `live GET /describe → 200` lists the resources `managers`, `tasks`, `log`, `verdicts`, `projects`
   and `why`, the action `manager.assess`, and the events `manager.created`/`manager.removed`. None of these exist at
   `9703092`, whose resources are `routers` and router collections only (`packages/protocol/src/modules/uri/types.ts:8-24`).
   The live catalog ids are `manager:<name>` (`live GET /r/swarmd/catalog → 200`), where `9703092` stores `router:`
   (`packages/server/src/modules/directory/internal/keys.ts:8`).
2. **A `9703092` CLI still works against the deployed server, but only "for one release".** The deployed server keeps
   `/r/<ns>/routers`, `router:<name>` catalog ids, `kind: "router"` on `PUT /catalog` and `defineRouter` as aliases
   (`main@2c46d82:STATUS.md:170`, `main@2c46d82:packages/server/src/modules/control/service.ts:85`).
   `swarm-cli.md` says to pin `9703092` *and* the deployed server; those are two different versions. See §5.
3. **swarmD is not on npm.** Pinning means building a tarball from a commit (§5) (`STATUS.md:46`, `STATUS.md:185`;
   still so on `main@2c46d82:STATUS.md:194`).
4. **There is no API for secrets, and nothing can be deleted:** no namespace, router, worker or catalog entry (§6.1, §6.3, §6.6).
5. **Each event connector feeds one namespace per Worker.** Slack, GitHub and Telegram events go only to
   `SLACK_NAMESPACE`, `GITHUB_NAMESPACE` and `TELEGRAM_NAMESPACE` (`packages/server/src/main.ts:31-47`,
   `packages/server/src/main.ts:218-226`, `packages/server/src/modules/ingress/types.ts:11-13`). That is unchanged on
   main (`main@2c46d82:packages/server/src/main.ts:38`, `:42`, `:53`). A Capxul namespace on the shared Worker can call
   GitHub and Slack, but it receives no GitHub or Slack events unless Aaron moves those secrets.
6. **The live server is partly broken.** Listing the managers of namespace `swarmd` fails: `live GET
   /r/swarmd/managers → 500` and `live GET /r/swarmd/routers → 500`, with the body `error code: 1101`, Cloudflare's
   uncaught-exception page. The cause is `live GET /r/swarmd/factory-build → 500 (1101)`, while `live GET
   /r/swarmd/factory-build/tickets?limit=5 → 200`. `live GET /inbox → 500` and `live GET /r/swarmd/usage → 500` read
   every manager of the namespace too (as `packages/server/src/modules/control/internal/plane.ts:68-72` and `:212-219`
   do at `9703092`), so I infer that they fail for the same reason.
7. **Aaron may refactor or restart swarmD** ("A refactor or a restart are both open",
   `main@b905582:docs/planning/session-handoff-2026-11-09.md:11`), so what is pinned matters.

## 2. What exists today (at `9703092`)

### 2.1 The system

- One Cloudflare Worker, `swarmd-server` (`packages/server/wrangler.jsonc:2`), with three Durable Object classes:
  - `RouterDO`: one per router instance;
  - `SandboxDO`: one container per worker sandbox;
  - `DirectoryDO`: one per swarm, named `"swarm"`.

  Sources: `packages/server/wrangler.jsonc:13-19`, `packages/server/src/main.ts:208`, `packages/server/src/main.ts:232`.
- One R2 bucket, `swarmd-blobs` (`packages/server/wrangler.jsonc:20`).
- The sandbox image (`packages/server/wrangler.jsonc:6-12`) is `node:24-bookworm-slim` plus git and swarmD's
  environment server (`packages/server/sandbox.Dockerfile:3-4`).
- Deployed at `https://swarmd-server.thedao.workers.dev`, on Aaron's Cloudflare account. The owner is `aaron`
  (`STATUS.md:22-23`).
- A deploy builds the amd64 image, pushes it with retries, and deploys pinned to its digest
  (`packages/server/scripts/deploy.ts:3-4`, `:16-22`). It needs Docker and wrangler on that account
  (`apps/docs/content/docs/how-to/deploy.md:38-51`). "Agents never deploy"
  (`main@b905582:docs/planning/session-handoff-2026-11-09.md:104`).
- The model of work:
  - A **router** is an always-on manager that routes work and never does it.
  - A **worker** does one **ticket** in its own conversation, inside its router's Durable Object
    (`README.md:5-6`, `packages/server/src/modules/workers/types.ts:1-3`).

### 2.2 The `swarmd` CLI (`@swarmd/agent`)

Entry and composition root:
- The CLI is `packages/agent/src/main.ts`. It reads `SWARMD_URL` and `SWARMD_TOKEN` (`packages/agent/src/main.ts:43`).
- `--url` and `--token` override them (`packages/agent/src/modules/cli/service.ts:82-83`).
- It prints one line, or JSON with `--json`. An error goes to stderr as `{ "error": { code, message } }`.
- It exits `0` on success and `1` on failure, with no other exit codes (`packages/agent/src/main.ts:52-54`).

A `--json` success is the server's value. An array is wrapped as `{ items }`
(`packages/agent/src/modules/cli/service.ts:24`).

The CLI does **not** use `@swarmd/client`. It has its own `send()`, which calls `fetch`, adds the bearer header and
turns errors into values (`packages/agent/src/modules/cli/internal/control.ts:4-17`, `packages/agent/package.json:19`).
A non-JSON error page, such as the live 500s, becomes `invalid: HTTP <status>`
(`packages/agent/src/modules/cli/internal/control.ts:11-13`).

| Command | Flags | Calls | Who | Cite |
|---|---|---|---|---|
| `init [folder]` | `--model provider/id` (default `openai/gpt-6-luna`) | nothing: writes a starter team (router `team`; fixer, researcher, reviewer, writer) into `<folder>/.swarmd/`; never overwrites | anyone | `cli/service.ts:81`, `cli/internal/init.ts:8-25` |
| `bootstrap` | `--user --ns` | `POST /bootstrap` | the first member of an empty swarm | `cli/service.ts:88-92` |
| `member add <id>` | `--role admin\|maintainer\|member\|viewer`, `--bot`, `--ns` | `POST /members`: a bot gets a token, a person an invite code | admin | `cli/service.ts:93-99` |
| `member link\|unlink <id>` | `--slack T…:U…` \| `--github <login>` \| `--telegram <id>`, `--ns` | `POST /act` `members` with `identity` | admin | `cli/service.ts:100-110` |
| `login <code>` | `--label` | `POST /login` → device token | holder of an invite | `cli/service.ts:111-114` |
| `devices` · `devices rm <id>` | | `GET /devices` · `DELETE /devices/<id>` | self | `cli/service.ts:115-118` |
| `ns create <name>` | | `POST /namespaces` | the swarm's owner only | `cli/service.ts:119-122`, `directory/service.ts:173` |
| `ns config <ns>` | `--default-model p/id`, repeated `--tier name=p/id`, `--set '<json>'`; none = read | `PATCH /namespaces/<ns>/settings`, else `GET /r/<ns>` | admin (write), any role (read) | `cli/service.ts:42-62`, `:123-129` |
| `up <file>` | `--ns` | loads the file's default export, `prepare`s it, `PUT /catalog/<ns>` | maintainer, admin | `cli/service.ts:64-76`, `:130-133` |
| `read <uri>` | `--query 'k=v&…'` | `GET /r/<path>` | any role in the namespace | `cli/service.ts:135-139` |
| `act <action> <uri>` | `--args '<json>'`, `--via pi` | `POST /act` with a fresh `requestId` | by action (§2.5) | `cli/service.ts:145-155` |
| `changes <uri>` | `--cursor`, `--wait <s>` | `GET /changes/<path>` | any role | `cli/service.ts:140-144` |
| `describe` | | `GET /describe` | any token | `cli/service.ts:156-159` |

`cli/service.ts` means `packages/agent/src/modules/cli/service.ts`; `directory/service.ts` means
`packages/server/src/modules/directory/service.ts`.

The CLI has no `whoami`, `secrets`, `down`, `rm`, profiles or typed shortcuts
(`apps/docs/content/docs/reference/cli.md:47`). The usage text is at `packages/agent/src/modules/cli/service.ts:8-21`.

### 2.3 Define helpers

Exported from `@swarmd/agent` (`packages/agent/src/index.ts:3`) and built:

| Helper | Gives | Cite |
|---|---|---|
| `defineWorker({...})` | `{ kind: "worker", lifetime: "ticket", … }` | `packages/agent/src/modules/define/service.ts:5` |
| `defineRouter({...})` | `{ kind: "router", … }` | `…/define/service.ts:6` |
| `sandbox({...})` and `sandbox.repo("." \| "github:o/n")` | the `.swarmd/sandbox.ts` setup; the worker's repository | `…/define/service.ts:8-11` |
| `pi`, `api`, `slack`, `telegram`, `github`, `schedule`, `conditions` | source specs with defaults | `…/define/service.ts:13-40` |

Worker fields:

| Field | Meaning | Cite |
|---|---|---|
| `name`, `description` | identity and what the router reads to choose it | `packages/agent/src/modules/define/types.ts:51-64` |
| `model` | `{ provider, modelId, thinking? }`, or `{ tier }` (`ModelChoice`) | `…/define/types.ts:16` |
| `instructions` | text, or a `./` or `../` path to a `.md` or `.txt` file, read relative to the definition file | `…/define/service.ts:43-52` |
| `lifetime` | always `ticket` | |
| `input`, `result` | JSON Schemas | |
| `concurrency` | default 3 per router | `packages/server/src/modules/definition/types.ts:176-177` |
| `review` | `"none" \| "person"` | |
| `sandbox`, `connectors`, `icon` | the sandbox; grant patterns per connector; where it posts | |

Router fields:

| Field | Meaning | Cite |
|---|---|---|
| `name`, `description`, `model`, `instructions` | as for workers | `packages/agent/src/modules/define/types.ts:80-91` |
| `dispatches` | `{ worker: "name" \| "name@N", models? }[]` | |
| `sources` | the source specs above | |
| `rules` | `{ name, when, mode: off\|observe\|auto, sources?, limits? }[]` | |
| `connectors`, `icon` | as for workers | |
| `evalTimeout` | default 10 minutes | `packages/server/src/modules/definition/service.ts:10` |

The `9703092` package does **not** export `defineManager`, `definePolicy`, `defineProject`, `defineDomain`, `mcp`,
`hook`, `rule`, the model helpers or `prepare` (`packages/agent/src/index.ts:3`). They are only documented (§4). On
the deployed `main` they are all exported
(`main@2c46d82:packages/agent/src/index.ts:3-4`).

The server's schema is closed. `obj()` in pi-schema adds `additionalProperties: false`
(`node_modules/@earendil-works/pi-schema/dist/builders.js:94`), and the worker and setup schemas are built from it
(`packages/server/src/modules/definition/internal/schema.ts:23-47`, `:51-90`). A definition carrying a field the code
does not know, such as `skills` or `tools`, is refused at `up` as `invalid`.

### 2.4 The HTTP API (control plane)

Every request except `/bootstrap`, `/login` and the connector webhooks needs `Authorization: Bearer <token>`
(`packages/server/src/modules/control/service.ts:31-33`). Errors are `{ error: { code, message } }`, with these
statuses (`packages/server/src/modules/control/internal/http.ts:4-18`):

| Status | Codes |
|---|---|
| 401 | `unauthorized` |
| 403 | `forbidden` |
| 404 | `not_found` |
| 400 | `invalid`, `missing_secret`, `cycle` |
| 409 | `in_use`, `conflict` |
| 429 | `over_limit`, `rule_limit` |

| Route | Body → answer | Cite (`control/service.ts` unless said) |
|---|---|---|
| `POST /bootstrap` | `{ user, namespace }` → `{ token }`; refused once anyone exists | `:20-24`, `directory/service.ts:70-76` |
| `POST /login` | `{ code, deviceLabel }` → `{ token, user, device }`; a code works once | `:25-29`, `directory/service.ts:100-109` |
| `GET /ws?via=` | WebSocket upgrade (§2.5) | `:30` |
| `GET /describe` | `{ resources, actions, events, errors, providers }` | `:35` |
| `GET /me` | `{ user, kind: human\|bot, roles: { <ns>: role } }` | `:36` |
| `GET /inbox` | tickets in a `person/*` stage across your namespaces | `:37`, `plane.ts:212-219` |
| `GET /r/<path>?<query>` | any read (below) | `:38`, `plane.ts:46-85` |
| `GET /changes/<ns>/<router>[/<collection>]?cursor=&wait=` | feed events after the cursor; long-poll up to 30 s; router level only | `:39`, `plane.ts:10`, `:191-209` |
| `POST /act` | `{ action, target, args, requestId }` → result; header `x-swarmd-via: pi` routes `submit` through `pi` | `:40-43`, `plane.ts:87-120` |
| `POST /members` | `{ namespace, id, role, bot }` → `{ token }` (bot) or `{ code }` (person) | `:44-50`, `directory/service.ts:84-98` |
| `GET /devices` · `DELETE /devices/<id>` | your devices · sign one out | `:51-53` |
| `POST /namespaces` | `{ name }` → `{ namespace }`; owner only | `:54-58`, `directory/service.ts:172-181` |
| `PATCH /namespaces/<ns>/settings` | a settings patch → merged settings; admin | `:59-63`, `directory/service.ts:235-244` |
| `PUT /catalog/<ns>` | `{ kind: worker\|router, definition }` → `{ kind, name, version, created, instance? }`; maintainer | `:64-71`, `directory/service.ts:122-157` |
| `POST /connectors/{slack,github,telegram}/events` | vendor webhooks, signature-checked, delivered to the namespace's routers | `packages/server/src/modules/ingress/internal/endpoints.ts:10-36` |

`plane.ts` means `packages/server/src/modules/control/internal/plane.ts`.

**Reads** (`plane.ts:46-85`), by URI `swarmd://…`:

- `namespaces` returns only `{ id, role }` per namespace (`plane.ts:50`).
- `<ns>` returns `{ id, role, settings, providers, label? }` (`plane.ts:53-58`).
- `<ns>/members` and `<ns>/catalog` are lists, and a single id reads one entry (`plane.ts:59-65`). A catalog row is
  `{ id, kind, name, version, versions, definition, model }`, where `definition` is the newest stored version
  (`packages/server/src/modules/directory/service.ts:159-170`).
- `<ns>/usage` returns `{ usd, tokens, tickets }`, summed over routers (`plane.ts:68-72`).
- `<ns>/routers` lists router rows, filtered by `parent=` and `q=` (`plane.ts:73-77`).
- `<ns>/<router>` is the router's row (`plane.ts:79-83`).
- `<ns>/<router>/<collection>[/<id>]` reads any of `sources`, `threads`, `reads`, `triggers`, `decisions`, `tickets`,
  `workers`, `conversations`, `policy`, `rules`, `artifacts`, `metrics`, `state` and `usage`
  (`packages/protocol/src/modules/uri/types.ts:10-24`, `packages/server/src/modules/router/internal/collections.ts:36-90`).

Ticket queries take `stage` (`person/*` works), `ended`, `assignee`, `thread`, `worker` and `q`
(`packages/server/src/modules/router/internal/list.ts:71-77`). `group=assignee` adds per-stage counts
(`…/list.ts:133`). Pages use `limit` (default 50, at most 200) and `cursor`, an offset (`…/list.ts:14`, `:137-142`).

`conversations/<id>?view=chat` is the chat, as Pi shows it. Without `view=chat`, a conversation reads as its tool
calls only (`…/collections.ts:46-49`). `artifacts` is always empty (`…/collections.ts:87-89`).

**Actions** (`packages/protocol/src/modules/actions/internal/catalog.ts:46-67`, served at `plane.ts:87-189`):

- **People:**
  - `submit { text, thread? }`, through `api`, or through `pi` with `--via pi` (`plane.ts:101-105`);
  - `stop`, `retry`, `answer { answer }`, `attend { text }`, `reevaluate`, `dismiss` and `unsubscribe`, on a ticket,
    trigger, decision or thread (`plane.ts:108-119`);
  - `pause` and `resume` on a router (`plane.ts:107`);
  - `label { name?, description? }` on a namespace, router, role, worker, ticket or thread (`plane.ts:123-140`).
- **Admins:**
  - `members`: add, change a role, `{ remove: true }`, `{ group, op }`, or `{ identity, op: link|unlink }`
    (`plane.ts:148-163`);
  - `budgets { usdPerDay }`, which only stores `limits.usdPerDay` (`plane.ts:164-168`);
  - `rules.mode { rule, mode }` and `policy.update { patch }`. Each writes the router's **next catalog version**
    (`plane.ts:169-187`).
- **In the catalog, but not served:** `instantiate` and `destroy` answer `not_found` "isn't served yet"
  (`catalog.ts:65-66`, `plane.ts:188`).

People act by role: a member on their own tickets, a maintainer or admin on any, a viewer on none
(`packages/server/src/modules/tickets/README.md:17`).

**Feed events** (`packages/protocol/src/modules/events/types.ts:7-24`): `trigger.received`, `decision.recorded`,
`ticket.created`, `ticket.stage`, `ticket.ended`, `report.recorded`, `attention.raised`, `attention.answered`,
`policy.changed`, `worker.started`, `worker.ended` and `label.changed`. `router.*`, `artifact.*` and `metric.*` are
declared but not emitted at this commit.

A collection's feed is the router's feed, filtered (`plane.ts:15-24`). A cursor is an entry id, and the feed resumes
without gaps (`packages/server/src/modules/store/README.md:8`). A page holds at most 500 events
(`packages/server/src/modules/router/service.ts:28`).

**Ticket stages:** `person/delivery`, `person/answer`, `person/review`, `person/blocked`, `person/failed`, `queued`,
`idle`, `working` and `ended` (`packages/protocol/src/modules/tickets/types.ts:7-16`). The ticket's shape is at
`…/tickets/types.ts:69-99`.

### 2.5 WebSocket and `@swarmd/client`

- **WebSocket** `GET /ws`: auth by header or a first `{ type: "auth", token }` frame.
  - Frames are `read`, `act`, `changes`/`unchanges` and `watch`/`unwatch`.
  - The server pushes `result`, `event` and `watch.value`.
  - Feeds are polled once a second. `watch` sends whole values, not Chord ops, and there is no presence
    (`packages/server/src/modules/control/internal/ws.ts:1-13`, `:49-93`).
- **`@swarmd/client`** is private, at version `0.0.0` (`packages/client/package.json:3-4`). It is **not packed**
  (`scripts/pack.ts:12`).
  - `connect({ url, token, via })` calls `GET /me` and returns a `Swarm` (`packages/client/src/modules/http/service.ts:19-77`).
  - `Swarm` has `me`, `read`, `get`, `changes`, `watch`, `act` and `inbox`
    (`packages/client/src/modules/swarm/types.ts:44-58`).
  - The namespace feed is built **in the client**, by polling each router (`packages/client/src/modules/http/service.ts:24-54`).
  - `memorySwarm` is an in-memory fake for tests (`packages/client/src/modules/swarm/types.ts:75-76`).

### 2.6 What the server keeps

| Where | What | Cite |
|---|---|---|
| Directory DO (one per swarm) | principals with roles per namespace (`principal:`) | `packages/server/src/modules/directory/internal/keys.ts:4-20` |
| | tokens, as SHA-256 hashes only (`token:`): 32 random bytes, hex | `…/keys.ts:41` |
| | the catalog: every version of every worker and router (`catalog:<ns>:worker:<name>`, `catalog:<ns>:router:<name>`) | |
| | router instances (`instances:<ns>`), members (`members:<ns>`), groups, settings, invites, devices, identity links | |
| Router DO (one per router) | a pi-durable Harness on DO SQLite: the setup, `policyVersion`, `paused`, triggers, decisions, threads, tickets, runs, read markers; the feed as one ownerless conversation; each worker's conversation | `packages/server/src/modules/store/types.ts:7-35`, `:101`, `packages/server/src/modules/store/README.md:3-8` |
| Sandbox DO (one per ticket, named `<ns>/<router>/<ticket>`) | the container, its golden-snapshot id, its spec; workspace backups to R2 | `packages/server/src/modules/router/service.ts:42`, `packages/server/src/modules/sandbox/README.md:4-26` |

The Directory is pushed out to routers: on every change it assembles each router's setup and pushes it, so a router
never reads the Directory (`packages/server/src/modules/directory/README.md:10`,
`packages/server/src/modules/directory/service.ts:56-67`).

### 2.7 How a definition is uploaded and versioned

1. `swarmd up <file> --ns <ns>` imports the file's default export and requires `kind` to be `worker` or `router`
   (`packages/agent/src/modules/cli/service.ts:64-68`).
2. `prepare` makes the uploaded value (`packages/agent/src/modules/define/service.ts:45-68`):
   - it inlines a prompt file;
   - it fills router source defaults (`pi` refuses the unlisted; `api` is addressed, and an unaddressed message is
     inferred);
   - for a sandboxed worker, it reads `<cwd>/.swarmd/sandbox.ts`, and either seeds the folder's files or records the
     GitHub clone URL (`packages/agent/src/modules/define/internal/seed.ts:25-44`). `.swarmd/sandbox.ts` is read from
     the folder `up` runs in, not the definition's folder (`packages/agent/src/modules/cli/service.ts:69`).
3. `PUT /catalog/<ns>` → `Directory.up` (`packages/server/src/modules/directory/service.ts:122-157`):
   - It needs a maintainer or an admin (`:123`), and a name matching `[a-z0-9][a-z0-9-]{0,39}` (`:9`, `:125`).
   - The model must resolve and be served by a provider that is on (`:126`,
     `packages/server/src/modules/directory/internal/models.ts:25-32`).
   - **A worker:** a definition equal to the newest version, compared by content, answers `created: false` (`:132`,
     `…/internal/keys.ts:44-46`). Otherwise it is validated and stored as version `N+1` (`:134-136`), and every
     router of the namespace gets its setup again (`:137`).
   - **A router:** the setup is assembled and validated before anything is stored (`:146-148`). Every dispatch must
     resolve to a stored worker, so **workers go up before their router**
     (`packages/server/src/modules/definition/service.ts:40-47`, `dogfood/README.md:34`). `limits.maxRouters` is
     enforced on a new instance (`:151-152`). The router is stored as version `N+1` with `by`, the actor of its
     schedules; the instance `<ns>/<name>` is created; its setup is pushed (`:153-156`).
   - A refused upload leaves no version (`:133`, `:145`).
4. `RouterDO.setup` stores the setup and bumps `policyVersion` when it changed
   (`packages/server/src/modules/router/service.ts:129-151`).
   - A running ticket keeps its worker version (`packages/server/src/modules/workers/README.md:7`).
   - An unpinned dispatch takes the newest version for new tickets; `name@N` pins one
     (`packages/server/src/modules/definition/types.ts:135-139`).
5. The CLI prints `✓ <ns> catalog: <name>@<N>`, or `=` with "(unchanged)", and `· instance <ns>/<name>` for a router
   (`packages/agent/src/modules/cli/service.ts:74`).

### 2.8 Namespace configuration

- **Roles:**
  - `admin` manages members and settings;
  - `maintainer` runs `up`, rules and policy, and pauses and resumes;
  - `member` talks to routers and acts on their own tickets;
  - `viewer` reads.

  The rank is at `packages/server/src/modules/directory/service.ts:10`, the doc at
  `apps/docs/content/docs/how-to/members-and-access.mdx:8-13`. `@maintainers` and `@members` are built-in groups, and
  admins make their own `@name` groups (`…/directory/service.ts:198-210`).
- **Settings** (`packages/server/src/modules/directory/types.ts:40-45`):
  - `defaults.models.{default,router,worker}`;
  - `tiers.<name>`;
  - `limits.{usdPerDay,maxRouters}`;
  - `admission.defaults`.

  A patch merges key by key (`packages/server/src/modules/directory/internal/models.ts:57-61`). Every model it names
  must be served (`…/models.ts:34-41`). A tier name is lowercase (`…/models.ts:11`). A setting's model "can be
  changed but never removed" (`…/models.ts:2`). A change pushes every router again (`…/directory/service.ts:242`).
- **Model resolution:**
  - A definition's own model wins.
  - Otherwise `{ tier }` → `tiers[tier]`.
  - Otherwise `defaults.models.router` or `.worker`, then `.default` (`…/internal/models.ts:14-23`).
  - Thinking defaults to `high` for workers (`packages/server/src/modules/workers/service.ts:36`) and `off` for
    routers (`packages/server/src/modules/router/service.ts:146`).
  - A router may run one ticket on a model its dispatch lists (`packages/server/src/modules/definition/service.ts:70-77`).
- **Providers** are Worker secrets, and adding one is a deploy-side change
  (`packages/server/src/modules/models/service.ts:9-16`, `packages/server/src/modules/models/README.md:7-10`):
  - `deepseek` is always on;
  - `openai` is on with `OPENAI_API_KEY`;
  - `anthropic` is on with `ANTHROPIC_API_KEY`;
  - `gateway` is on with `GATEWAY_BASE_URL`, `GATEWAY_API_KEY` and `GATEWAY_MODELS`.
- **Secrets:** §6.6. **Sandbox:** §6.7.

## 3. The deployed server, read live (GETs only)

| Request | Status | What it said |
|---|---|---|
| `GET /me` | 200 | `aaron`, `human`, `admin` of 34 namespaces |
| `GET /r/namespaces` | 200 | 34 namespaces: `main`, `swarmd`, `pi-uat`, `sbx-probe`, `qs-check`, `bt-check`, `pack-2560` and 27 `e2e-*`. No Capxul namespace yet |
| `GET /describe` | 200 | Providers: `deepseek` (2 models), `openai` (44), `anthropic` (17), `gateway` (`gpt-6.1-sol`, `gpt-6-luna`). The post-rename protocol (§1). No version field |
| `GET /version`, `GET /health` | 404 | `no route GET /version`. **The server reports no version.** The only record is the handoff: Worker version `7b0d1d61`, built from main `2c46d82` (`main@b905582:docs/planning/session-handoff-2026-11-09.md:48`) |
| `GET /r/swarmd` | 200 | default, `strong` and `cheap` are all `anthropic/claude-haiku-5-5`. (`STATUS.md:180` at `9703092` still says `gateway`) |
| `GET /r/swarmd/catalog` | 200 | 13 entries (detail below) |
| `GET /r/swarmd/members` | 200 | `aaron` (admin) and `ci-bot` (maintainer, bot) |
| `GET /r/swarmd/{swarmd,ops,factory}` | 200 | The manager rows: `swarmd@13` is listening; `ops@7`; `factory@2` |
| `GET /r/swarmd/factory-build`, `/r/swarmd/managers`, `/r/swarmd/routers`, `/r/swarmd/usage`, `/inbox` | 500 | `error code: 1101` (§1, item 6) |
| `GET /r/swarmd/swarmd/tickets?limit=200` | 200 | 16 tickets; T-8 is `idle`, the rest ended |
| `GET /r/swarmd/ops/tickets?limit=200` | 200 | 8 ended |
| `GET /r/swarmd/factory/tickets?limit=200` | 200 | 5 completed |
| `GET /r/swarmd/swarmd/policy` | 200 | Policy version 28, with a `pr-checks` hook. `state`: not paused |
| `GET /r/swarmd/projects` | 200 | Project `swarmd`: domain `software`, repo `github:AaronAbuUsama/swarmd`, refs `integration` and `main`, a runner |
| `GET /r/swarmd/tasks`, `GET /r/swarmd/log` | 200 | The ledger's tasks and work log |
| `GET /r/swarmd/verdicts` | 400 | Needs `?check=<id>&version=<Version as JSON>` |
| `GET /changes/swarmd/swarmd?wait=0` | 200 | 500 events, which is the page cap. Events carry `manager`, not `router` |
| `GET /r/swarmd/factory/artifacts` | 200 | The artifact state, built on main |

The 13 catalog entries:
- **Managers:** `factory@2`, `factory-build@5`, `ops@7` and `swarmd@13`.
- **Workers:** `builder@5`, `dev@2`, `factory-builder@2`, `factory-diagnoser@1`, `factory-reviewer@1`,
  `researcher@1`, `reviewer@3`, `slack-admin@3` and `verifier@5`.

The newer entries carry fields that `9703092` would refuse: `template`, `tools`, `manages`, `pairs`, `hooks`, and
`role` on dispatches.

The read-only endpoints for a management tool, then:

| To list | Read |
|---|---|
| Namespaces | `GET /me` (roles) or `GET /r/namespaces` |
| One namespace | `GET /r/<ns>`: settings and providers |
| Definitions and their versions | `GET /r/<ns>/catalog` |
| Routers | `GET /r/<ns>/routers`, or `/managers` on the deployed server |
| Workers | `GET /r/<ns>/<router>/workers` |
| Tickets | `GET /r/<ns>/<router>/tickets` and `GET /inbox` |
| The feed | `GET /changes/<ns>/<router>` |
| Models | `GET /describe` |

## 4. What the docs promise that the code does not do (at `9703092`)

The docs were rewritten on 2026-11-08 as the specification. "Where the code disagrees, the docs win, and the
difference is the planned work" (`STATUS.md:161`). Pages mark built and planned parts, but not always.

| Docs say | Where | Code at `9703092` |
|---|---|---|
| `npm i -D @swarmd/agent` | `apps/docs/content/docs/how-to/install.md:24` | Not on npm; tarballs only (`STATUS.md:46`, `:185`) |
| `defineManager`, `definePolicy`, templates, `manages`, `workers` as imported objects | `apps/docs/content/docs/reference/manager.md:8-63` | Not exported (`packages/agent/src/index.ts:3`); built on main |
| `defineProject`, the runner contract, `run_evals` | `apps/docs/content/docs/reference/project.md:8` (says planned) | Not built (`STATUS.md:169`) |
| `@swarmd/agent/models`, model objects, `provider()` | `apps/docs/content/docs/how-to/choose-models.mdx:9`, `:38` | No such export: `exports` has only `.` (`packages/agent/package.json:9-11`, `:35`) |
| Worker `skills`, `tools`, `sandbox.repo(…, { readOnly })` | `apps/docs/content/docs/reference/worker.md:66-75` | Refused as unknown fields (§2.3); `STATUS.md:175` |
| MCP servers as connectors, `mcp("posthog", …)` | `apps/docs/content/docs/concepts/connectors.mdx:23`, `:33`, `:94` | Not built (`STATUS.md:109`, `:116`) |
| Per-worker secrets, custom tools | `README.md:6`, `apps/docs/content/docs/reference/worker.md:64` | Not built (`STATUS.md:117`, `:119`). Egress reads any Worker secret by name (§6.6) |
| Manager tools (`task_open`, `pair_start`, `merge`, `deploy`, …) and pair tools | `apps/docs/content/docs/reference/tools.md:72-103` | Not built |
| Project, ledger and manager URIs and actions | `apps/docs/content/docs/reference/control-plane.md:108-158` | Not in the URI grammar (`packages/protocol/src/modules/uri/types.ts:8-24`) |
| "A namespace's feed merges its routers'" | `apps/docs/content/docs/reference/control-plane.md:73` | `/changes` is router-only (`packages/server/src/modules/control/internal/plane.ts:194`). The merge is client-side (`packages/client/src/modules/http/service.ts:24-54`) |
| `watch` with Chord ops, and `presence` | `apps/docs/content/docs/reference/protocol.md:48`, `:52`, `:57` | Whole values, no presence (`packages/server/src/modules/control/internal/ws.ts:7-8`). The page admits this at `:43` |
| `instantiate`, `destroy` | `/describe` lists them (`packages/protocol/src/modules/actions/internal/catalog.ts:65-66`) | `not_found` "isn't served yet" (`plane.ts:188`). `protocol.md:11` says so |
| `budgets` | Not built (`apps/docs/content/docs/reference/control-plane.md:69`), yet listed as served (`apps/docs/content/docs/reference/protocol.md:28`) | Served, but it only stores `limits.usdPerDay` (`plane.ts:164-168`); nothing enforces it (`packages/server/src/modules/directory/types.ts:37`, `STATUS.md:118`). Only a **rule's** `limits.usdPerDay` is enforced (`packages/server/src/modules/intake/internal/route.ts:117`) |
| `admission.defaults`: "Default admission settings per source kind" | `apps/docs/content/docs/reference/configuration.md:22` | Stored and merged (`packages/server/src/modules/directory/internal/models.ts:57-61`), but never read anywhere in `packages/server/src` |
| `swarmd://namespaces`: "Each namespace and its settings" | `apps/docs/content/docs/reference/control-plane.md:18` | Only `{ id, role }` (`plane.ts:50`). Settings come from `swarmd://<ns>` |
| The sandbox size is set in `container.ts` | `apps/docs/content/docs/reference/worker.md:58` | It is `INSTANCE` in `packages/server/src/modules/sandbox/internal/spec-key.ts:4` |
| A worker's grant is bounded by its router's | Code comments `packages/agent/src/modules/define/types.ts:45`, `packages/server/src/modules/definition/types.ts:147` | Not bounded (`packages/server/src/modules/definition/service.ts:50-51`, `STATUS.md:156`). The comments are stale |

The docs also promise less than the code in two places:
- `member link` is documented only with `--slack` (`apps/docs/content/docs/reference/cli.md:13`), but the code also
  takes `--github` and `--telegram` (`packages/agent/src/modules/cli/service.ts:100-110`).
- The control README says the WebSocket transport is "Not yet" (`packages/server/src/modules/control/README.md:15`),
  but it is built (`packages/server/src/modules/control/service.ts:30`).

## 5. Pinning a version

1. **Nothing is published.**
   - `@swarmd/agent` is `private`, at `0.0.0`. Its bin is the TypeScript source, and it depends on
     `@swarmd/protocol` as `file:../protocol` (`packages/agent/package.json:3-7`, `:19`).
   - A git URL or `file:` install of the package folder will not run: Node does not strip types under `node_modules`
     (`packages/agent/tsdown.config.ts:1-2`).
2. **Build the tarball from a commit.**
   - `node scripts/pack.ts` bundles `@swarmd/agent` (with `@swarmd/protocol` inlined) and `pi-swarmd` with tsdown,
     stages each package's `publish` manifest, runs `npm pack` into `dist/`, and checks that the bundle imports
     outside the repository (`scripts/pack.ts:1-28`, `packages/agent/tsdown.config.ts:11`).
   - The output is `dist/swarmd-agent-0.1.0.tgz` (`apps/docs/content/docs/how-to/install.md:16-19`). Install it with
     `npm i -D <tarball>` (`scripts/pack.ts:5`). Pinning it from a pnpm workspace has not been tried.
   - The build writes `dist/` inside the swarmD checkout, so build in a separate clone, never in `/home/user/swarmd`.
3. **The tarball's version does not name the commit.** `publish.version` is a hard-coded `0.1.0`, at both `9703092`
   (`packages/agent/package.json:28`) and `2c46d82` (`main@2c46d82:packages/agent/package.json:29`). Record the swarmD
   commit beside the vendored tarball, and let the lockfile's integrity hash pin the bytes.
4. **Node ≥ 22.18** (`packages/agent/package.json:33`). Definitions are `.ts` files run without a build.
5. **Only the CLI and the define helpers ship.** `runCli` is not exported (`packages/agent/src/index.ts:3`), and
   `@swarmd/client` is not packed (`scripts/pack.ts:12`). A tool has two choices:
   - shell out to the `swarmd` bin, and read its `--json` output and exit code;
   - or speak HTTP itself. The surface is small: bearer JSON over `fetch`, with errors as values
     (`packages/agent/src/modules/cli/internal/control.ts:4-17`).
6. **The server cannot be pinned by the project.** It is whatever Aaron last deployed (`STATUS.md:22-25`), and it
   reports no version (§3).
   - A tool can only check compatibility by shape: does `/describe` list `managers` or `routers` among its
     `resources`?
   - The `9703092` CLI works today through aliases kept "for one release" (`main@2c46d82:STATUS.md:170`).
7. **The choice for Aaron.** `swarm-cli.md` pins `9703092` and the deployed server, but the server runs `2c46d82`.
   - **(a) Pin `9703092`:** routers and workers only, as `swarm-cli.md` says. It breaks when the aliases go.
   - **(b) Pin `2c46d82`,** which is what the server runs. It brings `defineManager`, `tools`, `skills`, `mcp()`,
     projects and policy files, which are more than "routers and workers".

   Either way the tool should refuse to run against a server whose `/describe` shape it does not know.

## 6. What a Capxul swarm tool would wrap

For each area: what exists, its limits, and what the tool would add. "Today" means `9703092`. "Deployed" means `main`
at `2c46d82`, where it differs.

### 6.1 Creating the swarm

- **Exists.** The swarm is the shared deployed Worker. A project gets a **namespace**:
  - `ns create <name>` → `POST /namespaces`. Only the swarm's owner (`aaron`) may run it, and the creator becomes
    admin (`packages/server/src/modules/directory/service.ts:172-181`).
  - The owner flag is set only at bootstrap (`…/directory/service.ts:73`).
  - Then `member add` adds the tool's bot and its people (`…/directory/service.ts:84-98`), and `ns config` sets models
    (§6.5).
  - A new Worker would mean a Cloudflare deploy and `bootstrap`, which is out of scope
    (`apps/docs/content/docs/how-to/deploy.md:38-62`, `main@b905582:docs/planning/session-handoff-2026-11-09.md:104`).
- **Limits.**
  - Creating an existing namespace answers `conflict` (`…/directory/service.ts:175`).
  - **Nothing can delete a namespace** (no route at `packages/server/src/modules/control/service.ts:20-72`; "There is
    no namespace delete command yet", `main@b905582:docs/planning/session-handoff-2026-11-09.md:133`).
  - So evals that "drive the real CLI against a test namespace" leave a namespace behind per run, as the e2e suite
    already does (`apps/docs/content/docs/how-to/deploy.md:72`, and the 27 live `e2e-*` namespaces).
  - A bot's token is printed once (`…/directory/service.ts:94`); only its hash is stored
    (`packages/server/src/modules/directory/internal/keys.ts:1`).
- **The tool adds:**
  - `create`: one owner-run step that is idempotent (`conflict` means it exists, checked with `GET /r/<ns>`);
  - one admin bot for the tool, whose token goes into a local secret file;
  - default models;
  - a reuse-or-name policy for test namespaces, since they cannot be removed.

### 6.2 Deploying and updating definitions

- **Exists.** `swarmd up <file> --ns <ns>` makes one new catalog version per change (§2.7). The catalog read gives the
  newest stored definition and every version number (`packages/server/src/modules/directory/service.ts:159-170`).
- **Limits.**
  - There is no dry run, diff or rollback command.
  - At `9703092`, `prepare` is not exported (`packages/agent/src/index.ts:3`). A tool cannot build the upload
    in-process to compare it with the catalog; it must reimplement `prepare` or shell out. On main, `prepare` is
    exported (`main@2c46d82:packages/agent/src/index.ts:3`).
  - Order matters: workers before the router that dispatches them (`packages/server/src/modules/definition/service.ts:44-47`).
  - `act rules.mode` and `act policy.update` write router versions that the repository file does not have
    (`packages/server/src/modules/control/internal/plane.ts:169-187`). The next `up` of the file silently reverts them.
  - A rollback is either a new version with the old content, or a `name@N` pin in `dispatches`
    (`packages/server/src/modules/definition/types.ts:135-139`).
- **The tool adds:**
  - `deploy`: walk the project's definition folder, put workers first and routers last;
  - a preview first: `prepare`, then compare by content (as `sameDefinition` does,
    `packages/server/src/modules/directory/internal/keys.ts:44-46`) with `GET /r/<ns>/catalog`;
  - a report of `name@N` and `created`;
  - a warning on drift made by `rules.mode` or `policy.update`.

### 6.3 Adding and removing workers

- **Adding.** `up worker.ts`, add it to a router's `dispatches`, then `up router.ts`. A worker's `up` re-pushes every
  router's setup, so unpinned dispatches take the new version for new tickets
  (`packages/server/src/modules/directory/service.ts:137`). Concurrency is per worker per router, default 3
  (`packages/server/src/modules/definition/types.ts:176-177`).
- **Removing.** There is no `down`, `rm` or `destroy`:
  - `destroy` is in the catalog but not served (`packages/server/src/modules/control/internal/plane.ts:188`), and the
    CLI lacks `down` and `rm` (`apps/docs/content/docs/reference/cli.md:47`).
  - A worker leaves a router when it is dropped from `dispatches` and the router goes up again. Its catalog entry stays
    forever.
  - The router keeps the definition of every worker it ever dispatched, so open tickets finish
    (`packages/server/src/modules/directory/service.ts:31-35`).
  - A router can only be paused: `act pause`. A paused router records triggers but starts no Eval
    (`packages/server/src/modules/store/types.ts:17`, `plane.ts:107`).
  - A router instance is never removed, and still counts toward `limits.maxRouters`
    (`…/directory/service.ts:150-152`).
- **The tool adds:**
  - `worker add` and `worker remove`, as edits to the router's `dispatches` followed by an ordered `up`;
  - `router pause` and `router resume`;
  - a listing that marks catalog entries no router dispatches.

### 6.4 Tools, skills and connectors

- **Exists today.** Connector grants: `connectors: { slack | github | telegram: [patterns] }` on routers and workers.
  - The catalogs are generated: Slack has 153 methods, GitHub 1,015 REST operations, Telegram 179
    (`STATUS.md:133`, `:153`, `:143`).
  - Patterns are checked at `up` (`packages/server/src/modules/definition/service.ts:48-60`, `:86-90`).
  - Each agent's grant is its own (`…/definition/service.ts:50-51`). An agent gets `<kind>` and `<kind>_describe`
    tools (`packages/server/src/modules/sources/README.md:15-17`).
  - A worker with a sandbox gets `read`, `write`, `edit` and `bash`
    (`apps/docs/content/docs/reference/worker.md:39`).
- **Not built today:** skills, custom tools (`STATUS.md:119`), MCP (`STATUS.md:109`, `:116`), and Mattermost.
  Unknown fields are refused (§2.3).
  - No route serves a connector's operation list, so a tool can check a grant only by an `up` that is refused.
- **Deployed:**
  - `tools:` replaces `connectors:` (which still works as an alias);
  - `skills: [folders]` are read at `up` (`main@2c46d82:STATUS.md:182`);
  - `mcp({ url, secret })` connectors are declared on a **project**, with secrets matching `^MCP_[A-Z0-9_]+$`. They
    are built against a fake server and have not been run live (`main@2c46d82:STATUS.md:183`).
- **Event side.**
  - Slack, GitHub and Telegram events reach only one namespace each (§1, item 5). Today that is `swarmd`, which runs
    on the GitHub source (`live GET /r/swarmd/catalog`).
  - The calls themselves use one Slack bot token, one Telegram token and **one GitHub App installation**
    (`GITHUB_INSTALLATION_ID`, `packages/server/src/main.ts:40`, `:59-69`).
  - `github` calls and `sandbox.repo("github:Xelmar-tech/infrastructure")` reach Capxul only if that one
    installation covers `Xelmar-tech`. Not verified.
- **The tool adds:**
  - grants written once per role in the project's definitions;
  - a check of grants against what the pinned swarmD accepts;
  - a doctor that reports which connectors the namespace actually has: event side, credential, installation.

### 6.5 Models and tiers

- **Exists.**
  - `ns config <ns> --default-model p/id --tier name=p/id …`. Every value is validated before sending
    (`packages/agent/src/modules/cli/service.ts:40-62`), and the server checks that each is served
    (`packages/server/src/modules/directory/internal/models.ts:34-41`).
  - Definitions name a model, a tier, or nothing (§2.8).
  - The served models are in `GET /describe` and in `GET /r/<ns>` under `providers`
    (`packages/server/src/modules/control/service.ts:35`, `plane.ts:57`).
- **Limits.**
  - A default or tier can be changed but not removed (`…/internal/models.ts:2`).
  - Turning a provider on is a Worker secret (§6.6).
  - Credit has run out before: OpenAI was at $0 (`STATUS.md:180`), DeepSeek at $0 (`STATUS.md:183`).
  - Aaron's rule: "Never strong Anthropic models"; swarmD's agents run on `gpt-6-luna` or `gpt-6.1-sol` through his
    proxy, or on Haiku while testing (`main@b905582:docs/planning/session-handoff-2026-11-09.md:95-97`).
  - The live `swarmd` namespace runs on `anthropic/claude-haiku-5-5` (§3).
  - On main, the settings keys gained `defaults.models.manager` and `limits.maxManagers` (`main@2c46d82:STATUS.md:170`).
- **The tool adds:**
  - `models list` (providers that are on);
  - `models set`, writing defaults and tiers as one patch from a file in the repository;
  - a check that every definition's model or tier resolves before deploy.

### 6.6 Secrets

- **Exists.** Only Worker secrets, set with `npx wrangler secret put <NAME>` in `packages/server` by the Cloudflare
  account owner (`apps/docs/content/docs/reference/configuration.md:28-38`). Only the server's `main.ts` reads them:
  - model keys (`packages/server/src/modules/models/types.ts:5-16`);
  - connector credentials and namespaces (`packages/server/src/main.ts:30-47`, `:65-69`);
  - any name a sandbox's `egress` lists as `bearer`, or under `basic`. `GITHUB_TOKEN` is the App's minted token
    (`packages/server/src/main.ts:70-75`).
- **Not built:**
  - per-worker secrets (`STATUS.md:117`; still not on main, `main@2c46d82:STATUS.md:119`);
  - any API or CLI to set, list or rotate a secret (`apps/docs/content/docs/reference/cli.md:47`).

  A missing egress secret answers 502 inside the sandbox (`packages/server/src/modules/sandbox/service.ts:22`).
- **Risk to raise.** At `9703092`, egress resolves **any** Worker environment name (`packages/server/src/main.ts:72-75`)
  and adds it to requests to a host the definition chooses (`packages/server/src/modules/sandbox/service.ts:15-25`).
  The only check is the name's pattern, `^[A-Z][A-Z0-9_]*$`
  (`packages/server/src/modules/definition/internal/schema.ts:19`). So any maintainer of any namespace could send,
  say, `OPENAI_API_KEY` or `SLACK_BOT_TOKEN` to a host they control. Main restricts MCP secrets to `MCP_*`
  (`main@b905582:docs/planning/session-handoff-2026-11-09.md:65`). Whether egress is restricted on main was not
  checked.
- **The tool adds:**
  - no secret writes;
  - a `secrets` check that lists the names the project's definitions need (egress names, MCP keys) and reports which
    ones fail;
  - a request to Aaron for each missing one.

### 6.7 Sandboxes

- **Exists.**
  - A worker's `sandbox` is `sandbox.repo(".")` or `sandbox.repo("github:o/n")`
    (`packages/agent/src/modules/define/service.ts:8-11`, `:64`).
  - `.swarmd/sandbox.ts` holds:
    - `cwd`;
    - `prepare`, run once into a golden snapshot keyed by the spec;
    - `services`, started on every boot;
    - `egress`, the only hosts it reaches.

    Sources: `packages/agent/src/modules/define/types.ts:30-40`, `packages/server/src/modules/sandbox/README.md:11-16`.
  - One container per ticket, released when the ticket ends (`…/sandbox/README.md:4`,
    `packages/server/src/modules/sandbox/types.ts:46`).
  - Always `standard-3`: 2 vCPU, 8 GiB, 16 GB (`…/sandbox/README.md:46`,
    `packages/server/src/modules/sandbox/internal/spec-key.ts:4`).
  - An exec runs at most 14 minutes (`…/sandbox/README.md:35-36`).
  - The image is Node 24 with git (`packages/server/sandbox.Dockerfile:3-4`). Per-repository images are not built
    (`…/sandbox/README.md:42`, `STATUS.md:71`).
- **Limits that hit Capxul.**
  - `sandbox.repo(".")` seeds at most 2,000 files and 8 MB (`packages/agent/src/modules/define/internal/seed.ts:6-7`,
    `:34`, `:41`). The Capxul monorepo is far larger: its old book alone is 3,210 files (`FINISH-CAPXUL.md`, §1).
  - So it must use `sandbox.repo("github:Xelmar-tech/infrastructure")`, a clone over HTTPS with the App's token
    (`…/seed.ts:23`, `:29-31`). That needs the single installation to cover Xelmar-tech (§6.4).
  - Anything beyond Node 24 and git (pnpm, toolchains for contracts or the devnet) must be installed by `prepare`
    through hosts listed in `egress`.
  - `.swarmd/sandbox.ts` is read from the directory `up` runs in (§2.7), so run `up` from the repository root.
- **The tool adds:**
  - a sandbox profile in the repository (`.swarmd/sandbox.ts`) owned by the tool;
  - a `sandbox check` that confirms the clone source, egress and seed size before `up`.

### 6.8 Opening and reading work

- **Opening.** `act submit swarmd://<ns>/<router> --args '{"text":…,"thread":…}'`, through `api`, or through `pi` with
  `--via pi` (`packages/server/src/modules/control/internal/plane.ts:101-105`).
  - **A bot cannot open work explicitly:**
    - `pi` refuses bots;
    - through `api`, a bot is at most `inferred`;
    - an inferred trigger is accepted only under a rule in `auto` mode that covers `api`.

    Sources: `packages/server/src/modules/sources/README.md:7-11`, `apps/docs/content/docs/how-to/members-and-access.mdx:42`.
  - So a tool running on a bot token needs its router to list the bot in an `api` source and to have an `auto` rule
    covering it, as swarmD's own `pr-checks` rule does (`dogfood/router.ts:13-22`). Otherwise the tool needs a
    person's device token.
  - `thread` groups follow-ups (`apps/docs/content/docs/reference/sources.md:24-30`).
  - On main, `hook` workflows open tickets with no model (main commit `a7ae252`, PR #105).
- **Reading.**
  - `read …/tickets` with filters, a single ticket, `…/decisions`, `…/triggers`, and `…/conversations/<id>?view=chat`
    (§2.4);
  - `GET /inbox` for what waits on a person (`plane.ts:212-219`). It is down on the live `swarmd` namespace (§1).
- **Acting:** `answer`, `attend`, `stop`, `retry` and `reevaluate` (§2.4).
- **Deployed:** a ledger of tasks, a log and verdicts under `swarmd://<ns>/{tasks,log,verdicts,projects}` (§3).
  `swarmd why <trigger>` traces one trigger (`main@2c46d82:packages/agent/src/modules/cli/service.ts:22`).
- **The tool adds:**
  - `ask "<text>"`: `submit`, then wait on the router's feed for the decision and ticket;
  - `tickets`, `ticket <id>` (with its chat), `answer`, `stop` and `retry`;
  - a check that the tool's identity can open work at all.

### 6.9 Logs and the board

- **Logs.**
  - **No log API.** The structured record is the feed: `GET /changes/<ns>/<router>`, resumable by cursor, at most 500
    events per page (§2.4).
  - What actually happened in a ticket is its conversation: `?view=chat`, or the tool calls only
    (`packages/server/src/modules/router/internal/collections.ts:46-49`).
  - Harness failures and refused deliveries go to `console.error` (`packages/server/src/main.ts:95-96`). They can be
    read only with `wrangler tail` on Aaron's account; Workers Logs on main (commit `5ac856d`, PR #93) is the same.
  - The proof `evidence()` exists only as a Durable Object RPC (`packages/server/src/main.ts:145-147`), with no HTTP
    route.
- **Board.**
  - Today, the only board is Pi's Tickets view. It is drawn client-side from ticket reads: columns queued, working,
    waiting, needs you, and ended in the last day (`packages/pi-swarmd/src/modules/board/README.md:1-4`).
  - The server offers `tickets?group=assignee` counts (`packages/server/src/modules/router/internal/list.ts:133`)
    and computed `metrics`: `inflow`, `decisions`, `open`, `throughput`, `leadTime`, `personWait`, `failureRate`,
    `burn` and `rules` (`…/router/internal/metrics.ts:51-63`).
  - On main: one artifact state per manager, drawn on the web at `/a/<ns>/<manager>`
    (`main@2c46d82:packages/server/src/modules/control/service.ts:33-35`), on a pinned Slack board, and in Pi;
    `swarmd open` prints its link (`main@2c46d82:packages/agent/src/modules/cli/service.ts:23`).
- **The tool adds:**
  - `board`: a text board from tickets plus metrics, per router or for the namespace;
  - `log --follow`: the feed, merged across routers client-side, as `@swarmd/client` does;
  - `transcript <ticket>`.

## 7. Decisions to bring to Aaron

1. **Which swarmD to pin:** `9703092` or the deployed `2c46d82` (§5, item 7). `swarm-cli.md` names both.
2. **Event connectors.** Capxul gets no Slack or GitHub events while the Worker's `*_NAMESPACE` secrets point at
   `swarmd` (§1, item 5). Is the CLI enough as the way work comes in, or should the connectors move to Capxul?
3. **The GitHub App.** Does it, or will it, cover `Xelmar-tech/infrastructure`? The sandbox clone and the `github`
   tools depend on it (§6.4, §6.7).
4. **The egress-secret exposure** on the shared Worker (§6.6), before a second team's maintainers can attach
   definitions.
5. **The live 500s** on `swarmd`'s manager list, usage and inbox, caused by `factory-build` (§1, item 6).
6. **Test namespaces.** Nothing deletes a namespace (§6.1). Should evals share one fixed test namespace, or is
   namespace delete needed?
