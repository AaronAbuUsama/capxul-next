/**
 * The portal's process entry and composition root. The only file here that reads the arguments, touches the file
 * system, runs git, prints or exits. It loads the target book, hands it to the modules, and writes what they return.
 *
 *   node --experimental-strip-types src/main.ts generate <outDir>   write the site
 *   node --experimental-strip-types src/main.ts check               generate twice in memory and run the portal check
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildBook, keyOf, type AnyRecord } from "@capxul/book";

import { direction } from "#content/direction.ts";
import { check, expect, passed } from "#src/modules/check/service.ts";
import { renderSite } from "#src/modules/render/service.ts";
import type { Assets } from "#src/modules/render/types.ts";
import { buildSite } from "#src/modules/site/service.ts";
import type { FrozenArgument, FrozenCommand, FrozenFlag, SiteInput } from "#src/modules/site/types.ts";
import { twinsOf } from "#src/modules/twins/service.ts";
import { LLMS_FILE } from "#src/modules/twins/types.ts";

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

type Fields = Readonly<Record<string, unknown>>;
type Fn = (...args: readonly unknown[]) => unknown;
const isFields = (u: unknown): u is Fields => typeof u === "object" && u !== null;
const isFn = (u: unknown): u is Fn => typeof u === "function";
const isRecord = (u: unknown): u is AnyRecord => isFields(u) && typeof u["_kind"] === "string" && typeof u["id"] === "string";
const str = (u: unknown): string => (typeof u === "string" ? u : "");
const orNull = (u: unknown): string | null => (u === null || u === undefined ? null : String(u));
const list = (u: unknown): readonly unknown[] => (Array.isArray(u) ? u : []);
const fields = (u: unknown): readonly Fields[] => list(u).filter(isFields);

/** The repository this package sits in. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PACKAGE = join(ROOT, "packages/portal");

const argumentOf = (a: Fields): FrozenArgument => ({
  name: str(a["name"]), type: str(a["type"]), required: a["required"] === true, variadic: a["variadic"] === true,
  description: str(a["description"]),
});
const flagOf = (f: Fields): FrozenFlag => ({
  flag: str(f["flag"]), alias: orNull(f["alias"]), takesValue: f["takesValue"] === true, type: str(f["type"]),
  metavar: orNull(f["metavar"]), required: f["required"] === true, repeatable: f["repeatable"] === true,
  description: str(f["description"]), default: orNull(f["default"]),
});
/** The old CLI's command book, by operation id. A command the old CLI never shipped has no arguments and no flags. */
const frozenOf = (flagBook: unknown): ReadonlyMap<string, FrozenCommand> =>
  new Map(Object.entries(isFields(flagBook) && isFields(flagBook["commands"]) ? flagBook["commands"] : {}).flatMap(([id, c]) =>
    isFields(c)
      ? [[id, {
        command: str(c["command"]), inCli: c["inCli"] === true,
        arguments: fields(c["arguments"]).map(argumentOf), flags: fields(c["flags"]).map(flagOf),
      }] as const]
      : []));

/** The commit the book is read at, or "unknown" outside a git checkout. */
const commitOf = (root: string): string => {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
};

/**
 * Everything the site is built from, read from the repository at `root`: the target book, which concept exports each
 * record, the one waiting predicate, and the frozen CLI for reference. The books are imported at run time, read-only.
 */
export const load = async (root: string, commit: string = commitOf(root)): Promise<Result<SiteInput>> => {
  const open = async (path: string): Promise<Fields> => {
    const loaded: unknown = await import(pathToFileURL(join(root, path)).href);
    return isFields(loaded) ? loaded : {};
  };
  try {
    const target = await open("books/target/index.ts");
    const recordsOf = (await open("books/target/shared/index.ts"))["recordsOf"];
    const forAaron = (await open("books/target/shared/waiting.ts"))["forAaron"];
    const concepts = list((await open("books/target/shared/foundation.ts"))["CONCEPTS"]).filter(isRecord).map((c) => c.id);
    const frozen = (await open("books/frozen/operations.ts"))["frozen"];
    const flagBook = (await open("books/frozen/flags.ts"))["frozenFlagBook"];
    if (!isFn(recordsOf) || !isFn(forAaron) || !isFields(frozen) || !Array.isArray(target["records"])) {
      return { ok: false, error: `the books under ${root} do not export what the portal reads` };
    }
    const conceptOf = new Map<string, string>();
    for (const id of concepts) {
      const modules = (await open(`books/target/${id}/index.ts`))["modules"];
      for (const r of list(recordsOf(list(modules)))) if (isRecord(r)) conceptOf.set(keyOf(r), id);
      // the pay agreements live in payments/agreements since the cut (cut.agreements-in-payments)
      if (id === "payments") {
        const agreements = (await open("books/target/payments/agreements/index.ts"))["modules"];
        for (const r of list(recordsOf(list(agreements)))) if (isRecord(r)) conceptOf.set(keyOf(r), id);
      }
    }
    const book = buildBook({ name: str(target["name"]), stage: target["stage"] === "as-is" ? "as-is" : "target", records: target["records"] });
    return {
      ok: true,
      value: {
        book, commit, concepts, conceptOf, direction,
        waits: (decision) => forAaron(decision) === true,
        frozen: frozenOf(flagBook), frozenOperations: new Set(Object.keys(frozen)),
      },
    };
  } catch (cause) {
    return { ok: false, error: `the book could not be loaded: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
};

/** The stylesheet, its parts joined in name order, and the one script. */
export const assetsOf = (packageDir: string = PACKAGE): Assets => {
  const css = join(packageDir, "assets/css");
  return {
    css: readdirSync(css).filter((f) => f.endsWith(".css")).sort().map((f) => readFileSync(join(css, f), "utf8")).join("\n"),
    js: readFileSync(join(packageDir, "assets/site.js"), "utf8"),
  };
};

/** The whole site as file path to content: the pages, the stylesheet and script, the twins and `llms.txt`. */
export const generate = (input: SiteInput, assets: Assets): ReadonlyMap<string, string> => {
  const site = buildSite(input);
  return new Map([...renderSite(site, assets), ...twinsOf(site)]);
};

/** Writes the site. It replaces `outDir` only when that folder is absent, empty, or a site this generator wrote. */
const write = (outDir: string, files: ReadonlyMap<string, string>): Result<number> => {
  if (existsSync(outDir) && readdirSync(outDir).length > 0 && !existsSync(join(outDir, LLMS_FILE))) {
    return { ok: false, error: `${outDir} holds files this generator did not write; it is left as it is` };
  }
  rmSync(outDir, { recursive: true, force: true });
  const made = new Set<string>();
  for (const [file, content] of files) {
    const folder = dirname(join(outDir, file));
    if (!made.has(folder)) {
      mkdirSync(folder, { recursive: true });
      made.add(folder);
    }
    writeFileSync(join(outDir, file), content);
  }
  return { ok: true, value: files.size };
};

/** Runs one command and returns the lines to print and the exit code. */
const run = async (args: readonly string[]): Promise<{ readonly lines: readonly string[]; readonly code: number }> => {
  const [command, outDir] = args;
  if (command !== "check" && !(command === "generate" && outDir !== undefined)) {
    return { lines: ["usage: main.ts generate <outDir> | main.ts check"], code: 2 };
  }
  const loaded = await load(ROOT);
  if (!loaded.ok) return { lines: [loaded.error], code: 1 };
  const input = loaded.value;
  const assets = assetsOf();
  const files = generate(input, assets);
  if (command === "generate" && outDir !== undefined) {
    const written = write(resolve(outDir), files);
    if (!written.ok) return { lines: [written.error], code: 1 };
    const pages = [...files.keys()].filter((f) => f.endsWith(".html")).length;
    return {
      lines: [`${pages} pages, ${written.value} files written to ${resolve(outDir)} at commit ${input.commit} ` +
        `(${input.book.records.size} records, ${input.book.problems.length} problems, ${input.book.gaps.length} gaps)`],
      code: 0,
    };
  }
  const outcomes = check(files, generate(input, assets), expect(input.book, input.waits));
  return {
    lines: [
      ...outcomes.flatMap((o) => [
        `${o.failures === 0 ? "pass" : "FAIL"}  ${o.check}${o.failures === 0 ? "" : ` (${o.failures})`}`,
        ...o.detail.map((d) => `      ${d}`),
      ]),
      passed(outcomes) ? `portal check passed: ${files.size} files` : "portal check FAILED",
    ],
    code: passed(outcomes) ? 0 : 1,
  };
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { lines, code } = await run(process.argv.slice(2));
    console.log(lines.join("\n"));
    process.exitCode = code;
  } catch (cause) {
    console.error(cause instanceof Error ? cause.stack ?? cause.message : String(cause));
    process.exitCode = 1;
  }
}
