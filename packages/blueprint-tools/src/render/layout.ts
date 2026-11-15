// The blueprint's folders read as data: each thing (a folder under src/things/), its verbs (one file each: an
// operation with its Rpc, or work no door serves) and its thing files, from the files' text alone, so `pnpm generate` can write the generated indexes even when the ones on
// disk are out of date, and the renderer can say which verbs are whose. Pure: the callers read the disk.
import * as Arr from "effect/Array";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Str from "effect/String";

/** One file under src/things/: its path from there (`invitation/accept.ts`) and its text. */
export interface ThingFile {
  readonly path: string;
  readonly text: string;
}

/** The files a thing may hold beside its verbs. Every other file of a thing's folder is a verb. */
export const THING_FILES = ["values.ts", "events.ts", "refusals.ts", "lifecycle.ts", "examples.ts"] as const;

/**
 * The names a thing's files export for the generated indexes, never for the package: a verb's `promises`, `server`
 * and `stateless`, a values file's `subjects`, a refusals file's `refusals` and `exitCode`.
 */
export const RESERVED: ReadonlyArray<string> = ["promises", "server", "stateless", "subjects", "refusals", "exitCode"];

/** What a file exports: its values and its types, less the reserved names and those marked `@internal`. */
export interface Exports {
  readonly values: ReadonlyArray<string>;
  readonly types: ReadonlyArray<string>;
}

/** One verb: its file, the operation it declares, and what the indexes take from it. */
export interface Verb {
  readonly thing: string;
  readonly verb: string;
  readonly path: string;
  /** The operation's name, as its Rpc declares it (today's words: `invite.accept`). */
  readonly operation: string;
  /** The name its declaration is exported under. */
  readonly declaration: string;
  readonly server: "platform" | "world";
  /** True when it exports `stateless`: it moves no thing with a lifecycle, and says why. */
  readonly stateless: boolean;
  readonly exports: Exports;
}

/**
 * One verb that is work no door serves (the language's `work`): its file, its name and its declaration's export. It
 * has no Rpc, no server and no promises, so it joins no domain and no Rpc group; the pipeline's index gathers it.
 */
export interface WorkVerb {
  readonly thing: string;
  readonly verb: string;
  readonly path: string;
  /** Its name, `<thing>.<verb>`, as its declaration writes it. */
  readonly name: string;
  readonly declaration: string;
  readonly exports: Exports;
}

/** One of a thing's own files, as the indexes read it. */
export interface Part {
  readonly path: string;
  readonly exports: Exports;
  /** True when it exports `subjects`: what an approval of this thing authorises. */
  readonly subjects: boolean;
}

/** A thing's lifecycle: its file, the machine's export and its name. */
export interface Lifecycle {
  readonly path: string;
  readonly machine: string;
  readonly name: string;
}

export interface Thing {
  readonly name: string;
  readonly verbs: ReadonlyArray<Verb>;
  /** Its verbs that are work no door serves, in order. */
  readonly works: ReadonlyArray<WorkVerb>;
  readonly parts: { readonly [file in (typeof THING_FILES)[number]]?: Part };
  readonly lifecycle: Lifecycle | null;
}

export interface Layout {
  /** Every thing, by its folder's name, in order. */
  readonly things: ReadonlyArray<Thing>;
  /** Every way a file does not fit the layout, one line each. Empty when all fit. */
  readonly problems: ReadonlyArray<string>;
}

/** What `f` keeps of `items`, in order: each item whose `f` is Some. */
const somes = <A, B>(items: ReadonlyArray<A>, f: (item: A) => Option.Option<B>): Array<B> =>
  Arr.flatMap(items, (item) => Option.toArray(f(item)));

/** Every match of a global `pattern` in `text`. */
const all = (pattern: RegExp, text: string): ReadonlyArray<RegExpMatchArray> =>
  Arr.fromIterable(Str.matchAll(pattern)(text));

/** True when the doc comment right before `index` marks the declaration there `@internal`. */
const isInternal = (text: string, index: number): boolean => {
  const before = Str.trimEnd(Str.slice(0, index)(text));
  if (!Str.endsWith("*/")(before)) return false;
  return Option.match(Str.lastIndexOf("/**")(before), {
    onNone: () => false,
    onSome: (start) => Str.includes("@internal")(Str.slice(start)(before)),
  });
};

const exportsOf = (text: string): Exports => {
  const named = (pattern: RegExp) =>
    somes(all(pattern, text), (match) => {
      const name = match[1];
      return name === undefined || Arr.contains(RESERVED, name) || isInternal(text, match.index ?? 0)
        ? Option.none()
        : Option.some(name);
    });
  return {
    values: named(/^export (?:const|class|function) (\w+)/gm),
    types: named(/^export (?:type|interface) (\w+)/gm),
  };
};

const has = (text: string, name: string): boolean => new RegExp(`^export const ${name}\\b`, "m").test(text);

const verbOf = (file: ThingFile, thing: string, verb: string): { verb: Verb | null; problems: Array<string> } => {
  const problems: Array<string> = [];
  const names = all(/Rpc\.make\(\s*"([^"]+)"/g, file.text);
  const declarations = all(/^export const (\w+) = declare(?:Outcomes)?\(/gm, file.text);
  const server = /^export const server = "(platform|world)";/m.exec(file.text)?.[1];
  if (names.length !== 1) problems.push(`${file.path}: a verb declares one Rpc; this declares ${names.length}`);
  if (declarations.length !== 1)
    problems.push(
      `${file.path}: a verb exports one declaration (declare or declareOutcomes); this ${declarations.length}`,
    );
  if (server !== "platform" && server !== "world")
    problems.push(`${file.path}: a verb exports \`server\`, "platform" or "world"`);
  if (!has(file.text, "promises")) problems.push(`${file.path}: a verb exports its \`promises\``);
  const operation = names[0]?.[1];
  const declaration = declarations[0]?.[1];
  if (problems.length > 0 || operation === undefined || declaration === undefined || server === undefined)
    return { verb: null, problems };
  return {
    verb: {
      thing,
      verb,
      path: file.path,
      operation,
      declaration,
      server: server === "platform" ? "platform" : "world",
      stateless: has(file.text, "stateless"),
      exports: exportsOf(file.text),
    },
    problems,
  };
};

/** The work a verb's file declares, when it declares work (`export const x = work({ name: "..."`) and no Rpc. */
const workOf = (file: ThingFile, thing: string, verb: string): { work: WorkVerb | null; problems: Array<string> } => {
  const found = all(/^export const (\w+) = work\(\{\s*name: "([^"]+)"/gm, file.text);
  const declared = found[0];
  if (declared === undefined) return { work: null, problems: [] };
  const problems: Array<string> = [];
  const declaration = declared[1] ?? "";
  const name = declared[2] ?? "";
  if (found.length !== 1)
    problems.push(`${file.path}: a verb declares one piece of work; this declares ${found.length}`);
  if (/Rpc\.make\(/.test(file.text)) problems.push(`${file.path}: work no door serves declares no Rpc`);
  if (name !== `${thing}.${verb}`)
    problems.push(`${file.path}: its work is named \`${thing}.${verb}\`, not \`${name}\``);
  return problems.length > 0
    ? { work: null, problems }
    : { work: { thing, verb, path: file.path, name, declaration, exports: exportsOf(file.text) }, problems };
};

const lifecycleOf = (file: ThingFile): Lifecycle | null => {
  const found = /^export const (\w+) = Machine\.make\(\{\s*name: "([^"]+)"/m.exec(file.text);
  const machine = found?.[1];
  const name = found?.[2];
  return machine === undefined || name === undefined ? null : { path: file.path, machine, name };
};

const isThingFile = (file: string): file is (typeof THING_FILES)[number] =>
  Arr.some(THING_FILES, (each) => each === file);

/** The layout of the things, from every file under src/things/. */
export const layoutOf = (files: ReadonlyArray<ThingFile>): Layout => {
  const problems: Array<string> = [];
  const byThing = new Map<string, Array<{ readonly file: string; readonly at: ThingFile }>>();
  for (const at of files) {
    const parts = Str.split(at.path, "/");
    const [thing, file] = parts;
    if (parts.length !== 2 || thing === undefined || file === undefined || !/^[a-z][a-z-]*$/.test(thing)) {
      problems.push(`${at.path}: src/things/ holds one folder per thing, each with files only`);
      continue;
    }
    if (!/^[a-z][a-z-]*\.ts$/.test(file)) {
      problems.push(`${at.path}: a thing's folder holds only .ts files named in lower case`);
      continue;
    }
    byThing.set(thing, [...(byThing.get(thing) ?? []), { file, at }]);
  }
  const things = Arr.map(Arr.sort([...byThing.keys()], Order.String), (name): Thing => {
    const entries = Arr.sort(
      byThing.get(name) ?? [],
      Order.mapInput(Order.String, (each: { readonly file: string }) => each.file),
    );
    const verbs: Array<Verb> = [];
    const works: Array<WorkVerb> = [];
    const parts: { [file in (typeof THING_FILES)[number]]?: Part } = {};
    let lifecycle: Lifecycle | null = null;
    for (const { file, at } of entries) {
      if (file === "lifecycle.ts") {
        lifecycle = lifecycleOf(at);
        if (lifecycle === null) problems.push(`${at.path}: a lifecycle exports one machine, made by Machine.make`);
      } else if (isThingFile(file)) {
        parts[file] = { path: at.path, exports: exportsOf(at.text), subjects: has(at.text, "subjects") };
      } else {
        const verb = Str.slice(0, -3)(file);
        const asWork = workOf(at, name, verb);
        problems.push(...asWork.problems);
        if (asWork.work !== null) works.push(asWork.work);
        else if (asWork.problems.length === 0) {
          const made = verbOf(at, name, verb);
          problems.push(...made.problems);
          if (made.verb !== null) verbs.push(made.verb);
        }
      }
    }
    if (verbs.length + works.length === 0) problems.push(`${name}: a thing has at least one verb`);
    return { name, verbs, works, parts, lifecycle };
  });
  const operations = Arr.flatMap(things, (thing) => [
    ...Arr.map(thing.verbs, (verb) => verb.operation),
    ...Arr.map(thing.works, (each) => each.name),
  ]);
  for (const operation of Arr.dedupe(operations))
    if (Arr.filter(operations, (each) => each === operation).length > 1)
      problems.push(`${operation}: declared by more than one verb`);
  return { things, problems };
};

/** Every verb of the layout that is work no door serves, thing by thing. */
export const worksOf = (layout: Layout): ReadonlyArray<WorkVerb> => Arr.flatMap(layout.things, (thing) => thing.works);

/** Every verb of the layout, thing by thing. */
export const verbsOf = (layout: Layout): ReadonlyArray<Verb> => Arr.flatMap(layout.things, (thing) => thing.verbs);

/** The verb at `path` (`thing/verb`), if the layout has it. */
export const verbAt = (layout: Layout, path: string): Option.Option<Verb> =>
  pipe(
    verbsOf(layout),
    Arr.findFirst((verb) => `${verb.thing}/${verb.verb}` === path),
  );
