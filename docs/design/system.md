# The system map: where everything goes

Status: agreed with Aaron, 15 November 2026, from the explorer "System Map", with its fourteen choices as
recommended. It holds each package's layout and the line between generated and hand-written code, and it is the rule
the other sessions follow. The blueprint's layout is part 13 of `blueprint.md`, and the world's is `world.md`; this map
takes both as given. Nothing has moved yet: the moves are built later, by pull request, in lanes.

## The rule

1. **A verb is one file, at the same path everywhere.** It is declared at `blueprint/src/things/<thing>/<verb>.ts`.
   Where it has behaviour, its handler sits at `src/things/<thing>/<verb>.ts` in the package that serves it. The
   verb's `server` names that package: `api`, `world`, `runner`, `sites` or `cli`. `capxul invitation accept`,
   `invitation/accept.ts`, the page "invitation › accept" and the span `invitation.accept` are one shape.
2. **No list of verbs is kept by hand.** Each serving package's `src/generated/handlers.ts` is generated from the
   verbs whose server it is; a verb with no file answers `NotImplemented`. The same goes for the journey registry,
   the check index and the CLI's reference page.
3. **Derive where the reader can import the blueprint; generate a file only where it cannot.** The SDK's methods and
   the CLI's commands are read from the blueprint when they run. A file is generated for Python, SQL, Markdown,
   handler wiring by path, and anything read from JSON (the Frappe catalogue).
4. **One writer.** `pnpm generate` writes every generated file and `generate:check` checks them all. Renderers are
   pure functions in `blueprint-tools/src/render/`; `packages/generate` reads each owner, calls them and writes.
   `pnpm claims` goes.

## One set of folder names for every package

Every package's `src/` has `index.ts`, the one import entry, and uses only these folder names. One table in
`packages/lint/src/layout/` declares them, and one check holds every package to it; the world's `layout.test.ts`
becomes one row of that table.

| Folder | Holds |
|---|---|
| `entry/` | The only files that touch the process or runtime: `bin`, `main`, `worker`. Lint exempts this path; the hand-kept list of entry files in `.oxlintrc.json` goes |
| `things/<thing>/` | One thing: `values.ts`, `store.ts`, `client.ts`, `stage.ts`, `lifecycle.ts` where it has them, and one `<verb>.ts` per verb |
| `parts/<part>/` | Code deployed to run somewhere: a Worker, a Durable Object, a container, a host |
| `clients/` | How this package reaches a system outside it, one file or folder per system |
| `endpoint/`, `account/` | The server of a group of verbs: a world's, at its endpoint; or outside any world |
| `stack/` | Alchemy, the providers, where this package makes things run |
| `common/` | What several folders of this package share |
| `testing/` | Stand-ins that other packages' tests import |
| `generated/` | Written by `pnpm generate`, never edited |

A package may have a few folder names of its own, each declared in the table with its reason: the blueprint's
`protocol/` and `starting-points/`; blueprint-tools' `language/`, `checks/` and `render/`; the SDK's `methods/`; the
CLI's `commands/` and `output/`; the journeys' `language/`, `journeys/`, `checks/`, `looks/` and `coverage/`; the
runner's `checks/`; generate's `outputs/` and `seed/`; lint's `layout/`, `rules/` and `ratchets/`; the world's `cli/`
(until item 4.9) and `proofs/` (frozen). Four packages keep the layout their tool fixes: contracts (Foundry), indexer
(Ponder), frappe-app (Frappe) and status-feed (a flat Python script).

Every package also has a one-screen `README.md`, a generated `generated/index.md`, and `docs/` for its own how-to
pages, as `blueprint.md` part 7 says.

## Package by package

| Package | Layout | Generated or derived | Hand-written, and why |
|---|---|---|---|
| `blueprint` | Part 13. Adds `protocol/settings.ts` (the names a caller sets: endpoint, credential, account, world), the site and site-template verbs, and the pipeline's verbs as things (run, journey, verdict, starting-point, shard, cluster, sites) | `src/generated/verbs.ts` (thing, verb and server per verb), the hubs, the pages | The declarations |
| `blueprint-tools` | `entry/`, `language/`, `checks/`, `render/` | | The language, the checks, every renderer |
| `api` (was core) | `entry/worker.ts`, `things/<thing>/{<verb>,store}.ts`, `clients/{chain,site}/`, `endpoint/`, `stack/`, `common/`, `testing/`, `migrations/` | `generated/handlers.ts` (with the fault wrapper once), the empty handlers, a migration per lifecycle change for its CHECK constraint, state types and span names from the blueprint | Handler logic, SQL, the chain and site clients: behaviour and protocols with the outside world |
| `sdk` | `methods/`, `clients/{endpoint,account,chain}.ts`, `common/settings.ts`, `testing/endpoint.ts` | Every method, read from the verbs at run time, thing then verb: `capxul.invitation.accept({...})` | Transport, sign-in, trace headers, chain reads: machinery written once |
| `cli` | `entry/bin.ts`, `commands/{verbs,frappe,safe,flags}.ts`, `output/{table,json,exit}.ts`, `clients/{in-process,sdk}.ts`, `things/account/login.ts`, `things/world/use.ts`, `testing/call.ts` | Every command, `capxul <thing> <verb>`, read from the verbs, the Frappe catalogue and the ABI; `generated/commands.md` | Parsing, output, `login` and `use`. Pipeline verbs run in-process through the world's, runner's and sites' handler layers. If `use` is the world's own `use` verb, it lives only in the world |
| `journeys` (was scenarios) | `language/`, `journeys/<journey>.ts`, `checks/<thing>/<verb>.ts`, `looks/<thing>.ts`, `coverage/<thing>.ts` | `generated/`: the registry from the journeys the blueprint names, the check index, the promises to cover | Journey steps, check logic and looks: the journey author's. `language/` and `checks/` are protected |
| `runner` | `things/<thing>/<verb>.ts` (`run/start`, `journey/run`, `verdict/show`, `starting-point/make`, `shard/`), `checks/`, `clients/`, `stack/`, `common/`, `records/` (frozen) | `generated/handlers.ts`; spans, settings and the verdict's schema from the blueprint | Plumbing. The generic checks and the one starting-point maker are protected |
| `world` | `world.md`, unchanged | Adds `generated/handlers.ts` for its account group | `run.sh` and `cli/` go at item 4.9; its fork of the indexer config goes |
| `sites` (was platform, with bench-image) | `src/things/{sites,site-token}/`, `src/parts/`, `src/stack/`, `src/common/`; beside `src/`: `service/` (the Python site service), `images/{bench,hosted}/`, `bootstrap/` | `service/generated/contract.py` and the world's client, from the site verbs; `generated/catalogue/` from the pinned Frappe apps' metadata; `capxul sites deploy\|drift\|list` | Alchemy stacks, the site service's Python, images, the bootstrap (a package script) |
| `frappe-app` | Frappe's app layout, its modules grouped into `capxul/site_api/` (one per caller: core, person, chain), `capxul/books/`, `capxul/platform/` | `capxul/generated/site.py`: all of `common/site.ts` | The site API, the books and the doctypes: behaviour in Python and Frappe's own format |
| `contracts` | Foundry's: `src/`, `test/`, `certora/`; `deployments/` (inputs and record); `vendor/` (was `lib/`) | `generated/abi.ts`, `generated/seeded.ts` (now with third-party addresses and the start block) | The Solidity |
| `indexer` | Ponder's: one `ponder.config.ts`, `src/handlers/<contract>.ts` | The config from `Seeded` and `Abi`; event names from the blueprint | The projections from logs to rows |
| `generate` | `entry/{generate,seed}.ts`, `outputs/` (one file per owner), `seed/` | | Reading owners and writing; the seed builder |
| `lint` | `entry/shape.ts`, `layout/`, `rules/`, `ratchets/` | Ratchet ceilings computed from the lists | The rules and the layout table |
| `status-feed` | Unchanged | | Reads `docs/decisions.md` once the decisions move |

## The choices, as agreed

1. The SDK and the CLI are derived from the blueprint at run time; a reference page of every command is generated.
2. A verb's handler sits at `things/<thing>/<verb>.ts` in the package that serves it.
3. The CLI runs pipeline verbs in-process by linking those packages' handler layers. A hosted account service is
   for later (decision 51's open question).
4. The blueprint owns the site service's contract as site and site-template verbs.
5. The Frappe catalogue is generated into `packages/sites/generated/catalogue/`.
6. `packages/bench-image` folds into `packages/sites/images/hosted/`.
7. The names a caller sets are declared once in `blueprint/src/protocol/settings.ts`.
8. `pnpm generate` is the only writer of generated files.
9. The Python site service sits at `packages/sites/service/`.
10. `packages/indexer` stays, with one config built from `Seeded`.
11. The runner's `door` and `chain` runs become journeys named in the blueprint.
12. Files that touch the process live in `src/entry/`.
13. The SDK's surface is thing then verb.
14. One layout check, in `packages/lint`, holds every package to the table above.
