// Entry: `pnpm shape`. Lists the files git tracks (`git ls-files`: its index, so a new file counts once it is added),
// reads the two entry lists in .oxlintrc.json, checks both against packages/lint/src/shape.ts and exits 1 on any
// problem. Nothing walks the disk, so `node_modules`, ignored records and untracked scratch files never count.
// Running git, reading files, printing and the exit code live here; the rules are in shape.ts.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import { type EntryLists, shapeProblems, trackedFiles } from "./shape.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const read = (file: string): string => readFileSync(`${root}/${file}`, "utf8");

const listed = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" });
const files = trackedFiles(listed, (file) => existsSync(`${root}/${file}`));
const lines = (file: string): number => Str.split(read(file), "\n").length - 1;

/** .oxlintrc.json is JSON with whole-line `//` comments. */
const config: unknown = JSON.parse(
  Arr.join(
    Arr.filter(Str.split(read(".oxlintrc.json"), "\n"), (line) => !Str.startsWith("//")(Str.trim(line))),
    "\n",
  ),
);
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Arr.isArray(value);
const at = (value: unknown, key: string): unknown => (isObject(value) ? value[key] : undefined);
const strings = (value: unknown): Array<string> =>
  Arr.isArray(value) ? Arr.filter(value, (item): item is string => typeof item === "string") : [];

const capxulEntries = at(at(at(config, "settings"), "capxul"), "entries");
const overrides = at(config, "overrides");
const entries: EntryLists = {
  reasons: isObject(capxulEntries) ? Rec.keys(capxulEntries) : [],
  override: Arr.flatMap(
    Arr.filter(
      Arr.isArray(overrides) ? overrides : [],
      (override) => at(at(override, "rules"), "capxul/effect-only") === "off",
    ),
    (override) => strings(at(override, "files")),
  ),
};

const problems = shapeProblems({ files, lines, read, entries });
for (const problem of problems) console.error(problem);
console.log(problems.length === 0 ? `shape: ${files.length} files, 0 problems` : `shape: ${problems.length} problems`);
process.exitCode = problems.length === 0 ? 0 : 1;
