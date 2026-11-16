// The ratchets counted from the repository's files (roadmap items 3.6 and 3.8): R7, R8, R10 and R20's counters on made-up files,
// each through the registry's counter of its name. The repository's own counts are tested where its files are gathered
// (packages/generate/test/ratchets.test.ts). Run with `pnpm test`.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Arr from "effect/Array";
import type { Ratchet } from "../src/language/ratchet.ts";
import type { RepositoryFiles } from "../src/checks/ratchet-files.ts";
import type { Entry } from "../src/language/glossary.ts";
import { tally, type Lists } from "../src/checks/ratchets.ts";

const none: RepositoryFiles = {
  verbs: {},
  longReadmes: [],
  docs: {},
  nonEffect: {},
  dependencies: {},
  tracked: [],
  scripts: [],
};
const lists = (files: Partial<RepositoryFiles>, glossary: ReadonlyArray<Entry>): Lists => ({
  lint: {},
  formats: {},
  oldWords: {},
  files: { ...none, ...files },
  glossary,
});
const one = (ratchet: Ratchet, files: Partial<RepositoryFiles>, glossary: ReadonlyArray<Entry> = []) => {
  const [counted] = tally([ratchet], lists(files, glossary));
  return { count: counted?.count, items: counted?.items };
};

const R7: Ratchet = { id: "R7", name: "One file", holds: "verbs", closes: "D3", count: "verbs:examples" };
const R8: Ratchet = {
  id: "R8",
  name: "Docs",
  holds: "docs",
  closes: "D3",
  count: "docs:long-or-mapped",
  unmigrated: ["packages/a/docs/order.md"],
};
const R10: Ratchet = { id: "R10", name: "Effect", holds: "code", closes: "7", count: "effect:non-effect" };

test("R7 counts each verb that imports its examples from an examples.ts, and no other", () => {
  const verbs = {
    "src/things/ticket/verbs/open.ts": 'import { opened } from "../examples.ts";\nexport const open = verb({});\n',
    "src/things/ticket/verbs/close.ts": 'import { other } from "../../note/examples.ts";\n',
    "src/things/ticket/verbs/read.ts": 'import { Ticket } from "../values.ts";\n// examples.ts is folded here\n',
  };
  assert.deepEqual(one(R7, { verbs }), {
    count: 2,
    items: ["src/things/ticket/verbs/close.ts", "src/things/ticket/verbs/open.ts"],
  });
  assert.deepEqual(one(R7, {}), { count: 0, items: [] });
});

const page = (n: number, line: string): string => `${Arr.join(Arr.replicate(line, n), "\n")}\n`;

test("R8 counts each long README the docs' shape lists, each file map, and each doc not yet folded", () => {
  const longReadmes = ["packages/a/README.md"];
  const docs = {
    "packages/a/README.md": page(61, "text"),
    "packages/c/README.md": page(3, "| `src/x.ts` | what it holds |"),
    "packages/d/README.md": `- \`src/x.ts\` holds x\n- \`bin/up.sh\` starts it\nThe \`y.ts\` file, in prose\n`,
    "packages/e/docs/page.md": page(80, "- `src/x.ts`: x"),
  };
  assert.deepEqual(one(R8, { longReadmes, docs }), {
    count: 4,
    items: [
      "long: packages/a/README.md",
      "map: packages/c/README.md (3 lines name a file)",
      "map: packages/e/docs/page.md (80 lines name a file)",
      "not folded: packages/a/docs/order.md",
    ],
  });
});

test("R10 counts effect-only's findings and each runtime dependency that is not Effect nor Capxul's own", () => {
  const files = {
    nonEffect: { "packages/indexer/src/index.ts": 3, "packages/indexer/ponder.config.ts": 2 },
    dependencies: {
      "packages/core": ["effect", "@effect/sql-pg", "@capxul/blueprint", "viem", "alchemy"],
      "packages/sdk": ["effect"],
    },
  };
  assert.deepEqual(one(R10, files), {
    count: 7,
    items: [
      "construct: packages/indexer/ponder.config.ts: 2",
      "construct: packages/indexer/src/index.ts: 3",
      "dependency: packages/core: alchemy",
      "dependency: packages/core: viem",
    ],
  });
  assert.deepEqual(one(R10, {}), { count: 0, items: [] });
});

const R20: Ratchet = { id: "R20", name: "Landed", holds: "words", closes: "3.8", count: "glossary:not-landed" };

test("R20 counts each landing place not there yet and each file still named by an old word", () => {
  const glossary: ReadonlyArray<Entry> = [
    { word: "api", meaning: "m", replaces: ["core"], scope: "internal", lands: "packages/api" },
    { word: "sites", meaning: "m", replaces: [], scope: "internal", lands: "packages/sites" },
    { word: "gate", meaning: "m", replaces: [], scope: "internal", lands: "pnpm gate" },
    { word: "words", meaning: "m", replaces: [], scope: "internal", lands: "pnpm words" },
    { word: "endpoint", meaning: "m", replaces: [], scope: "user-facing", lands: "--world <name>" },
    { word: "index.ts", meaning: "m", replaces: [{ kind: "code", text: "door.ts" }], scope: "internal" },
    { word: "flag", meaning: "m", replaces: [{ kind: "code", text: "--at" }], scope: "internal" },
  ];
  const files = {
    tracked: ["packages/sites/README.md", "packages/core/src/door.ts", "packages/a/door.ts.md", "door.ts"],
    scripts: ["words"],
  };
  assert.deepEqual(one(R20, files, glossary), {
    count: 4,
    items: [
      "not landed: api: packages/api",
      "not landed: gate: pnpm gate",
      "not renamed: door.ts (index.ts)",
      "not renamed: packages/core/src/door.ts (index.ts)",
    ],
  });
  assert.deepEqual(one(R20, {}, []), { count: 0, items: [] });
});
