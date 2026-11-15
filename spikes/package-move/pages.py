README = """# @capxul/world

What runs where: the Alchemy stacks that create and destroy a world. A world is one whole, isolated Capxul: its
database and its api, its chain, bundler and indexer on a shared cluster, and its companies' sites on the bench. Every
world has an owner and an expiry, and is made, used and destroyed as one unit. Nothing of it lives on the machine
that made it.

**The map**, one line per file, generated from the code: [generated/index.md](generated/index.md).

## The kinds of folder in `src/`

A folder says what kind of thing lives in it. Nothing is loose at the root of `src/` but `index.ts`.

| Folder | Holds |
|---|---|
| `index.ts` | The one file other packages import from |
| `things/<thing>/` | One thing this package makes and destroys: a world, the cluster, the registry, a site, a site template. `values.ts` says what it is, `stage.ts` holds its Alchemy stack, `client.ts` says how it is reached, `store.ts` holds its rows, and each verb is a file of its own: `create.ts`, `reset.ts`, `sweep.ts` |
| `parts/<part>/` | What runs in the cloud: the cluster's gateway, and each world's api, chain, bundler, indexer and database, each with its own client |
| `account/` | The operations served outside any world (`world.create`, `world.show`, `world.list`, the snapshots), on loopback or in the runner |
| `stack/` | Alchemy: the engine that deploys and destroys a stage, the images, the names, the cloud accounts |
| `cli/` | The command line. `cli/main.ts` is the only file that touches the process |
| `common/` | What every kind uses: the package's failures, run records, timing |
| `proofs/` | The proofs, one case per file, frozen with their records under `records/` |

Beside `src/`: `images/` and `ponder/` (what the cluster's containers are built from), `migrations/`, `records/`
(frozen), `run.sh` (the command line from an agent's container, until the `capxul` CLI takes the world's verbs over)
and `alchemy.run.ts` (the stack, for Alchemy's read-only commands).

`test/layout.test.ts` fails a file that lands outside this layout.

## Where to go

- Make, list and destroy a world by hand: [docs/commands.md](docs/commands.md)
- Reset a world in place, renew it: [docs/reset.md](docs/reset.md), [docs/renew.md](docs/renew.md)
- Serve the account's operations: [docs/account.md](docs/account.md)
- Pin or publish an image: [docs/images.md](docs/images.md)
- Run a proof: [docs/proofs.md](docs/proofs.md)
- How the cluster, the api, the sites and the containers work: [docs/cluster.md](docs/cluster.md),
  [docs/api.md](docs/api.md), [docs/sites.md](docs/sites.md), [docs/containers.md](docs/containers.md)
- What was learned building it: [docs/lessons.md](docs/lessons.md)
- The rules a world keeps: [docs/roadmap.md](../../docs/roadmap.md), "World lifecycle rules, enforced by code"
- Why the layout is this one: [docs/design/world.md](../../docs/design/world.md)
"""

# Each docs page: the README's line ranges it is cut from, why, and its heading.
DOCS = {
    "commands.md": ([(177, 220)], "How to run the command line: a how-to page, one task, cut from the README's Commands section.", "# Make, list and destroy a world by hand"),
    "reset.md": ([(67, 144)], "Cut from the README's 'Reset in place'.", "# Reset a world in place"),
    "renew.md": ([(145, 176)], "Cut from the README's 'Renewing a world'.", "# Renew a world"),
    "account.md": ([(221, 240)], "Cut from the README's 'The platform' (glossary: platform, the group, becomes account).", "# Serve the account's operations"),
    "images.md": ([(339, 369)], "Cut from the README's 'Images'.", "# Pin or publish an image"),
    "proofs.md": ([(386, 419)], "Cut from 'What is proven'. Its table of records goes once verdicts replace the proofs (4.5).", "# Run a proof"),
    "cluster.md": ([(8, 66)], "Reasoning, not a task: cut from 'The fleet hub' and 'Capacity'. Question 3 asks where reasoning lives.", "# How the cluster works"),
    "api.md": ([(241, 266), (292, 308)], "Reasoning: cut from 'Core's slot, or a host of Core' and 'How Core reaches the bundler'.", "# How a world's api is hosted and reaches its parts"),
    "sites.md": ([(267, 291)], "Reasoning: cut from 'A company's site'.", "# How a world's sites are made on the bench"),
    "containers.md": ([(309, 338)], "Reasoning: cut from 'Containers: a refused start is tried again'.", "# How a refused container start is tried again"),
    "lessons.md": ([(510, 564)], "Cut from 'What was learned on the way'. The timings (lines 420 to 509) stay in the frozen records they came from; 'Not done' (565 to 617) goes to the roadmap; 'The lifecycle rules, in code' (370 to 385) listed files by hand and is dropped: the generated map and each file's own comment say it.", "# What was learned building the world"),
}

LAYOUT_TEST = r'''// The layout of src/ (docs/design/world.md): fails any file that lands outside it. A folder says what kind of thing
// lives in it, every thing has its own folder with the same files, and nothing but index.ts is loose at the root.
import * as assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";

const SRC = join(import.meta.dirname, "..", "src");
const files = readdirSync(SRC, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => relative(SRC, join(entry.parentPath, entry.name)).split(sep).join("/"));

/** The kinds of folder at the root of src/, and the one file allowed there. */
const KINDS = ["things", "parts", "account", "stack", "cli", "common", "proofs"];
const ROOT_FILES = ["index.ts"];

/** The files every thing folder may hold beside its verbs. */
const THING_FILES = ["values.ts", "stage.ts", "client.ts", "store.ts"];

/** The verbs a thing's file may be named for (the glossary's, until the blueprint's glossary exports them: 3.8). */
const VERBS = ["create", "destroy", "list", "show", "use", "reset", "renew", "sweep", "keep", "reserve", "save", "restore"];

/**
 * Files in a thing folder that are neither one of its files nor one verb. Each folds into a file above; the list may
 * only shrink (a ratchet, like the blueprint's), and a new file is never added to it.
 */
const UNFOLDED = [
  "things/world/bring-up.ts", // into create.ts
  "things/world/take-down.ts", // into destroy.ts and keep.ts
  "things/world/expiry.ts", // into values.ts
  "things/world/names.ts", // into values.ts
  "things/world/handle.ts", // into client.ts
  "things/world/kept.ts", // into client.ts
  "things/world/cast.ts", // into create.ts
  "things/cluster/registration.ts", // into values.ts
  "things/cluster/idle.ts", // into client.ts
  "things/site/bench.ts", // into client.ts and create.ts
  "things/site/snapshot.ts", // into save.ts and restore.ts
];
export const UNFOLDED_COUNT = 11;

const kebab = /^[a-z][a-z0-9-]*$/;
const misfits = (file: string): string | undefined => {
  const parts = file.split("/");
  if (file.endsWith(".md")) return "markdown lives in docs/ or generated/, never in src/";
  if (parts.length === 1) return ROOT_FILES.includes(file) ? undefined : "only index.ts is loose at the root of src/";
  const [kind, ...rest] = parts;
  if (!KINDS.includes(kind)) return `"${kind}/" is not a kind of folder: ${KINDS.join(", ")}`;
  if (kind === "things" || kind === "parts") {
    if (rest.length !== 2) return `${kind}/ holds one folder per ${kind === "things" ? "thing" : "part"}, and files in it`;
    if (!kebab.test(rest[0])) return `"${rest[0]}" is not a folder name in kebab case`;
    if (kind === "parts") return undefined;
    const name = rest[1].replace(/\.ts$/, "");
    if (THING_FILES.includes(rest[1]) || VERBS.includes(name) || UNFOLDED.includes(file)) return undefined;
    return `a thing folder holds ${THING_FILES.join(", ")} and one file per verb (${VERBS.join(", ")})`;
  }
  if (kind === "proofs") return rest.length === 1 || (rest.length === 2 && ["cases", "support"].includes(rest[0])) ? undefined : "proofs/ holds cases/, support/ and cases.ts";
  return rest.length === 1 ? undefined : `${kind}/ holds files, not folders`;
};

test("every file under src/ is where the layout says", () => {
  assert.deepEqual(
    files.flatMap((file) => { const why = misfits(file); return why === undefined ? [] : [`${file}: ${why}`]; }),
    [],
  );
});

test("the unfolded files only shrink, and each still exists", () => {
  assert.ok(UNFOLDED.length <= UNFOLDED_COUNT, "a file was added to UNFOLDED; give it a place instead");
  assert.deepEqual(UNFOLDED.filter((file) => !files.includes(file)), [], "a folded file is gone: remove it and lower the count");
});
'''

DESIGN = """# The world package's layout

Status: proposed, 15 November 2026. Recorded here once Aaron agrees it.

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

**What it does not do.** Exported names keep today's words (`hubUp`, `Core`, `platformUp`); the glossary's
renames run on their own ratchet (3.8). Command names stay until the CLI takes them over (decision 8).
"""
