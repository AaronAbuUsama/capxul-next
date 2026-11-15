# The world package's layout

Status: agreed with Aaron, 15 November 2026, from the explorer "World Layout", with the four open questions as
recommended (below).

`packages/world` follows the blueprint's layout (`docs/design/blueprint.md`, parts 7 and 13) and its glossary
(part 12): a folder says what kind of thing lives in it, every thing has its own folder with the same files, nothing
is loose at the root of `src/`, the package's one import entry is `index.ts`, and generated files go in `generated/`.
It moves files and names them; it changes no behaviour, no Alchemy stack and nothing a world creates or destroys.

```
packages/world/
  README.md                one screen
  generated/index.md       the map: one line per file, from its opening comment
  docs/                    one page per task or question, cut from the old README
  src/
    index.ts               the one import entry (was door.ts)
    things/<thing>/        world, cluster, registry, site, site-template
      values.ts            what it is: its shape, names, limits
      stage.ts             its Alchemy stack, where it has one
      client.ts            how it is reached
      store.ts             its rows
      <verb>.ts            one per verb: create, destroy, list, reset, renew, sweep, use, keep, reserve, ...
    parts/<part>/          what runs in the cloud: gateway, api, chain, bundler, indexer, database, containers
    account/               the operations served outside any world
    stack/                 Alchemy: engine, images, names, the cloud accounts
    cli/                   the command line; main.ts is the only file that touches the process
    common/                failures, run records, timing
    proofs/                cases/, support/, cases.ts: frozen with records/
  test/                    unit tests, and layout.test.ts
  images/  ponder/  migrations/  records/  run.sh  alchemy.run.ts
```

| Kind | Holds | Why apart |
|---|---|---|
| `things/` | What the package makes and destroys, each with its verbs | `capxul world reset` is `things/world/reset.ts` |
| `parts/` | Code that runs on Cloudflare, and each part's client | A part is deployed; a thing is driven from a process |
| `account/` | The Rpc handlers and their server and store | Served to operators, outside any world |
| `stack/` | Alchemy and the provider accounts | Nothing else drives Alchemy |
| `cli/`, `common/`, `proofs/` | The command line, what all kinds share, the frozen proofs | |

**What checks it.** `test/layout.test.ts` fails a file outside these folders, a thing file that is neither one of
the four nor a verb, and a growing list of unfolded files (a ratchet: eleven files that hold more than one verb, or
a helper that folds into one of the four). `pnpm shape` holds the README to one screen; `pnpm generate:check` holds
the map.

**The four questions, as agreed.**

1. Exported names keep today's words (`hubUp`, `Core`, `platformUp`, `BenchStage`), and so do the words inside the
   files' comments; the glossary's renames run on their own ratchet (3.8). The move renames paths only.
2. `run.sh` stays at the package root, running `src/cli/main.ts`, until the CLI takes the world's verbs over
   (decision 8).
3. The README is one screen. The rest is pages under `packages/world/docs/`, one task or question each; the timings
   stay in the frozen records they came from, "Not done" goes to the roadmap, and the hand-written list of files is
   dropped.
4. A file that holds more than one verb, or a helper that belongs in one of a thing's four files, moves whole under an
   honest name and is listed as unfolded: `lifecycle/operations.ts` alone is cut, into `create.ts`, `destroy.ts` and
   `list.ts`.

**What it does not do.** No behaviour changes, no Alchemy stack changes, nothing a world creates or destroys. The
runner fingerprints `world/src` for its starting points, so the first run after the move remakes their site
templates once.
