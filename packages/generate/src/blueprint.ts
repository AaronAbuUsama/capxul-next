// The text of the blueprint's generated indexes (packages/blueprint/src/generated/), from its things' folders as the
// toolkit reads them (`layoutOf`) and today's domains (sources.ts, `BLUEPRINT.domains`). Pure: main.ts reads the
// folders and writes the files. Each file is written as oxfmt would format it, so no generated file is formatted
// after.
import type { Exports, Layout, Part, Verb } from "@capxul/blueprint-tools";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import {
  array,
  at,
  call,
  exportFrom,
  first,
  FROM_THINGS,
  key,
  moduleName,
  partOf,
  pieceOf,
  record,
  somes,
  type Written,
} from "./blueprint-text.ts";
import { pipelineHub } from "./pipeline.ts";
import { BLUEPRINT, type BlueprintDomain } from "./sources.ts";

/** The things' files that make up one domain: its verbs, in order, each found in the layout, and its parts. */
const verbsOf = (layout: Layout, domain: BlueprintDomain, order: ReadonlyArray<string>) =>
  somes(order, (path) =>
    Arr.findFirst(
      Arr.flatMap(layout.things, (thing) => thing.verbs),
      (verb) => `${verb.thing}/${verb.verb}` === path && Arr.contains(domain.verbs, path),
    ),
  );

const domainHub = (layout: Layout, name: string, domain: BlueprintDomain): string => {
  const verbs = verbsOf(layout, domain, domain.verbs);
  const grouped = verbsOf(layout, domain, domain.groups ?? domain.verbs);
  const parts = somes(domain.parts, (path) => pieceOf(layout, path));
  const lifecycles = Arr.flatMap(parts, (each) => (each.kind === "lifecycle" ? [each.lifecycle] : []));
  const reexported = Arr.flatMap(parts, (each) => (each.kind === "part" ? [each.part] : []));
  const exporting: ReadonlyArray<{ readonly path: string; readonly exports: Exports }> = [
    ...reexported,
    ...Arr.map(verbs, (verb) => ({ path: verb.path, exports: verb.exports })),
  ];
  const rpcs = (server: Verb["server"]) =>
    Arr.map(
      Arr.filter(grouped, (verb) => verb.server === server),
      (verb) => `${moduleName(verb.path)}.${verb.declaration}.rpc`,
    );
  const lines = [
    first(FROM_THINGS) +
      `// The domain \`${name}\` (the namespace \`${domain.namespace}\`): its operations by name, its share of the two Rpc\n` +
      "// groups, its machines and its verbs' promises (today's word: claims), gathered from its things' verbs; and every\n" +
      "// name its things export for the package. Today's domains are kept for the package's namespaces until the\n" +
      "// glossary's renames (roadmap item 3.8).",
    'import * as RpcGroup from "effect/rpc/RpcGroup";',
    'import type { ClaimsOf } from "../starting-points/points.ts";',
    ...Arr.map(verbs, (verb) => `import * as ${moduleName(verb.path)} from "../things/${verb.path}";`),
    ...Arr.map(
      lifecycles,
      (lifecycle) =>
        `import { ${lifecycle.machine} as ${moduleName(lifecycle.path)} } from "../things/${lifecycle.path}";`,
    ),
    "",
    ...Arr.flatMap(exporting, (each) => [
      ...(each.exports.values.length > 0 ? [exportFrom(each.exports.values, `../things/${each.path}`)] : []),
      ...(each.exports.types.length > 0
        ? [
            exportFrom(
              Arr.map(each.exports.types, (type) => `type ${type}`),
              `../things/${each.path}`,
            ),
          ]
        : []),
    ]),
    "",
    "/** Its operations, by name. */",
    `export const operations = ${record(Arr.map(verbs, (verb) => [key(verb.operation), `${moduleName(verb.path)}.${verb.declaration}`]))} as const;`,
    "",
    "/** Its operations that move no thing with a lifecycle, each with why: each such verb's `stateless`. */",
    `export const stateless: { readonly [Name in keyof typeof operations]?: string } = ${record(
      Arr.map(
        Arr.filter(verbs, (verb) => verb.stateless),
        (verb) => [key(verb.operation), `${moduleName(verb.path)}.stateless`],
      ),
    )};`,
    "",
    "/** Its machines, by name: its things' lifecycles. */",
    `export const machines = ${record(Arr.map(lifecycles, (lifecycle) => [lifecycle.name, moduleName(lifecycle.path)]))} as const;`,
    "",
    "/** What the platform's world service serves of it (`PlatformRpcs`). */",
    call("export const platformRpcs = RpcGroup.make", rpcs("platform"), ";"),
    "",
    "/** What a world's Core serves of it, through the world's door (`WorldRpcs`). */",
    call("export const worldRpcs = RpcGroup.make", rpcs("world"), ";"),
    "",
    "/** The promises of each of its operations: each verb's `promises`. */",
    `export const claims: { readonly [Name in keyof typeof operations]: ClaimsOf } = ${record(
      Arr.map(verbs, (verb) => [key(verb.operation), `${moduleName(verb.path)}.promises`]),
    )};`,
    "",
  ];
  return Arr.join(lines, "\n");
};

const domainsHub = (): string => {
  const names = Rec.keys(BLUEPRINT.domains);
  const namespaces = Arr.map(names, (name) => BLUEPRINT.domains[name]?.namespace ?? name);
  const sorted = Arr.sort(
    Arr.zip(names, namespaces),
    Order.mapInput(Order.String, ([, namespace]: readonly [string, string]) => namespace),
  );
  return Arr.join(
    [
      first("packages/generate/src/sources.ts") +
        "// Every domain of the blueprint, each a generated module (./<domain>.ts) gathered from its things' verbs: its\n" +
        "// operations, its share of the two Rpc groups and its claims. The door (../index.ts) gathers them into\n" +
        "// `operations` and the two groups, and ./promises.ts into `allClaims`.",
      'import * as Rec from "effect/Record";',
      ...Arr.map(sorted, ([name, namespace]) => `import * as ${namespace} from "./${name}.ts";`),
      "",
      "/** Every domain, by its name. This order is the order of `operations` and of each Rpc group. */",
      `export const domains = ${record(Arr.map(Arr.zip(names, namespaces), ([name, namespace]) => [name, namespace]))} as const;`,
      "",
      "/** The names of one domain's operations, read the same way whichever domain it is. */",
      "export const namesOf = (domain: { readonly operations: { readonly [name: string]: unknown } }): ReadonlyArray<string> =>",
      "  Rec.keys(domain.operations);",
      "",
      `export { ${Arr.join(
        Arr.map(sorted, ([, namespace]) => namespace),
        ", ",
      )} };`,
      "",
    ],
    "\n",
  );
};

const refusalsHub = (layout: Layout): string => {
  const files = [
    { name: "Common", path: "../common/refusals.ts" },
    ...somes(layout.things, (thing) =>
      Option.map(partOf(thing, "refusals"), (part) => ({
        name: moduleName(part.path),
        path: `../things/${part.path}`,
      })),
    ),
  ];
  return Arr.join(
    [
      first(FROM_THINGS) +
        "// Every refusal of the contract, gathered here from where each is declared once: the things' own, in\n" +
        "// src/things/<thing>/refusals.ts, and those several things share, in src/common/refusals.ts. A refusal is a\n" +
        "// typed error that needs the world's state to decide; a payload of the wrong shape never reaches a handler\n" +
        "// (its schema rejects it). Each carries what a caller needs to act on it, and nothing secret.",
      'import { gather, type ExitCode } from "@capxul/blueprint-tools";',
      'import * as Rec from "effect/Record";',
      ...Arr.map(files, (file) => `import * as ${file.name} from "${file.path}";`),
      "",
      ...Arr.map(files, (file) => `export * from "${file.path}";`),
      "",
      "/** Every file that declares refusals. */",
      array(
        "const declaring = ",
        Arr.map(files, (file) => file.name),
        " as const;",
      ),
      "",
      "/**",
      " * Every refusal, by its tag. The tests read this to prove no tag is declared twice. All but `PayloadRejected` are a",
      " * door's; that one is the caller's own client's, made from the operation's schema before anything is sent.",
      " */",
      'export const refusals = gather(declaring, "refusals");',
      "",
      "export type RefusalTag = keyof typeof refusals;",
      "",
      'export type { ExitCode } from "@capxul/blueprint-tools";',
      "",
      "/** The command line's exit code for each refusal, declared on the refusal itself so the CLI never invents one. */",
      "export const exitCode: { readonly [Tag in RefusalTag]: ExitCode } = Rec.map(refusals, (refusal) => refusal.exitCode);",
      "",
    ],
    "\n",
  );
};

const subjectsHub = (layout: Layout): string => {
  const order = Arr.flatMap(Rec.values(BLUEPRINT.domains), (domain) => domain.parts);
  const files = Arr.dedupeWith(
    somes(order, (path) =>
      Option.flatMap(pieceOf(layout, path), (piece): Option.Option<Part> =>
        piece.kind === "part" && piece.part.subjects && Str.endsWith("/values.ts")(piece.part.path)
          ? Option.some(piece.part)
          : Option.none(),
      ),
    ),
    (a: Part, b: Part) => a.path === b.path,
  );
  return Arr.join(
    [
      first(FROM_THINGS) +
        "// What an approval authorises, once enough of its kind are signed, named by the id the operation that asked\n" +
        "// for it answered: every thing whose verbs ask for approvals declares its kinds as `subjects`, in its values.ts.",
      'import * as Schema from "effect/Schema";',
      ...Arr.map(files, (part) => `import * as ${moduleName(part.path)} from "../things/${part.path}";`),
      "",
      "/** What an approval authorises: a kind of each thing's `subjects`, in the domains' order. */",
      array(
        "export const Subject = Schema.Union(",
        Arr.map(files, (part) => `...${moduleName(part.path)}.subjects`),
        ");",
      ),
      "",
    ],
    "\n",
  );
};

const valuesHub = (): string =>
  Arr.join(
    [
      first("packages/blueprint/src/common/values.ts and ./subjects.ts") +
        "// `Values`: the values several things share (src/common/values.ts) and what an approval authorises\n" +
        "// (./subjects.ts, gathered from the things), as one module.",
      'export * from "../common/values.ts";',
      'export { Subject } from "./subjects.ts";',
      "",
    ],
    "\n",
  );

const promisesHub = (): string =>
  Arr.join(
    [
      first("packages/generate/src/sources.ts") +
        "// Every operation's promises (today's word: claims), gathered from the domains (./domains.ts), domain by\n" +
        "// domain. The type makes an operation with no promises a compile error.",
      'import { gather } from "@capxul/blueprint-tools";',
      'import * as Rec from "effect/Record";',
      'import type { OperationName } from "../index.ts";',
      'import type { ClaimsOf } from "../starting-points/points.ts";',
      'import { domains } from "./domains.ts";',
      "",
      'export const allClaims: { readonly [Name in OperationName]: ClaimsOf } = gather(Rec.values(domains), "claims");',
      "",
    ],
    "\n",
  );

/** Why the layout and today's domains disagree: a verb no domain lists, or one a domain lists that is not there. */
const disagreements = (layout: Layout): ReadonlyArray<string> => {
  const listed = Arr.flatMap(Rec.values(BLUEPRINT.domains), (domain) => domain.verbs);
  const found = Arr.flatMap(layout.things, (thing) => Arr.map(thing.verbs, (verb) => `${verb.thing}/${verb.verb}`));
  return [
    ...Arr.map(
      Arr.difference(found, listed),
      (path) => `src/things/${path}.ts: no domain of packages/generate/src/sources.ts lists it`,
    ),
    ...Arr.map(
      Arr.difference(listed, found),
      (path) => `packages/generate/src/sources.ts lists ${path}, which is no verb`,
    ),
  ];
};

/** Every generated index of the blueprint, or why it cannot be written. */
export const renderBlueprint = (
  layout: Layout,
): { readonly written: ReadonlyArray<Written>; readonly problems: ReadonlyArray<string> } => ({
  problems: [...layout.problems, ...disagreements(layout)],
  written: [
    ...Arr.map(Rec.toEntries(BLUEPRINT.domains), ([name, domain]) => ({
      path: at(`${name}.ts`),
      text: domainHub(layout, name, domain),
    })),
    { path: at("domains.ts"), text: domainsHub() },
    { path: at("refusals.ts"), text: refusalsHub(layout) },
    { path: at("subjects.ts"), text: subjectsHub(layout) },
    { path: at("values.ts"), text: valuesHub() },
    { path: at("promises.ts"), text: promisesHub() },
    { path: at("pipeline.ts"), text: pipelineHub(layout) },
  ],
});
