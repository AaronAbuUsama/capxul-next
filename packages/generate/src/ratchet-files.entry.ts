// The repository's files ratchets R7, R8 and R10 are counted from (packages/blueprint-tools, src/checks/
// ratchet-files.ts): the blueprint's verbs, the long READMEs the docs' shape lists, the tracked READMEs and package docs (git's list of them), each package's
// runtime dependencies, and what `capxul/effect-only` finds, run by oxlint alone (packages/lint/effect-only.json) on
// the TypeScript the lint does not reach. Read once by `pnpm ratchets` and by this package's tests.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { Ratchets } from "@capxul/blueprint-tools";
import { LONG_READMES } from "../../lint/src/door.ts";

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, ROOT), "utf8");

/** A program run at the root, and what it printed; it stops the run when it could not start or wrote nothing. */
const run = (command: string, args: ReadonlyArray<string>): string => {
  const done = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (done.error !== undefined || done.stdout.length === 0)
    throw new Error(`${command} ${Arr.join(args, " ")} failed: ${done.error?.message ?? done.stderr}`);
  return done.stdout;
};

/** Each verb's file under packages/blueprint, by its path there. */
const verbs = (): { [path: string]: string } => {
  const things = "packages/blueprint/src/things/";
  return Rec.fromEntries(
    Arr.flatMap(readdirSync(new URL(things, ROOT), { recursive: true, encoding: "utf8" }), (path) =>
      /^[^/]+\/verbs\/[^/]+\.ts$/.test(path) ? [[`src/things/${path}`, read(`${things}${path}`)] as const] : [],
    ),
  );
};

/** Each tracked README and page under a package's docs/, but those vendored. */
const docs = (): { [path: string]: string } =>
  Rec.fromEntries(
    Arr.flatMap(Str.split(Str.trim(run("git", ["ls-files", "*.md"])), "\n"), (path) =>
      (Str.endsWith("README.md")(path) || /^packages\/[^/]+\/docs\//.test(path)) &&
      !Str.startsWith("packages/contracts/lib/")(path)
        ? [[path, read(path)] as const]
        : [],
    ),
  );

/** oxlint's JSON report: only each finding's file is read. */
const Report = Schema.Struct({ diagnostics: Schema.Array(Schema.Struct({ filename: Schema.String })) });

/** effect-only's findings in the TypeScript the lint does not reach (Ratchets.NOT_LINTED), by file. */
const nonEffect = (): { [file: string]: number } => {
  const text = run(new URL("node_modules/.bin/oxlint", ROOT).pathname, [
    "-c",
    "packages/lint/effect-only.json",
    "-f",
    "json",
    ...Ratchets.NOT_LINTED,
  ]);
  // oxlint-disable-next-line effecttsgo/schema-sync -- read once from the command line: a report of another shape stops the run with its reason.
  const report = Schema.decodeUnknownSync(Report)(JSON.parse(text));
  return Arr.reduce(report.diagnostics, {} as { [file: string]: number }, (counts, { filename }) => ({
    ...counts,
    [filename]: (counts[filename] ?? 0) + 1,
  }));
};

/** A package.json: only its runtime dependencies are read. */
const Manifest = Schema.Struct({ dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)) });

/** Each package's runtime dependencies, by its path: every tracked `packages/<name>/package.json`. */
const dependencies = (): { [pkg: string]: ReadonlyArray<string> } =>
  Rec.fromEntries(
    Arr.map(Str.split(Str.trim(run("git", ["ls-files", "packages/*/package.json"])), "\n"), (path) => {
      // oxlint-disable-next-line effecttsgo/schema-sync -- read once from the command line: a manifest of another shape stops the run with its reason.
      const manifest = Schema.decodeUnknownSync(Manifest)(JSON.parse(read(path)));
      return [Str.replace("/package.json", "")(path), Rec.keys(manifest.dependencies ?? {})] as const;
    }),
  );

/** The repository's files, as the three counters read them. */
export const repositoryFiles = (): Ratchets.RepositoryFiles => ({
  verbs: verbs(),
  longReadmes: LONG_READMES,
  docs: docs(),
  nonEffect: nonEffect(),
  dependencies: dependencies(),
});
