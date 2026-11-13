// Entry: `pnpm shape`. Lists the files git tracks or would track, checks them against packages/lint/src/shape.ts and
// exits 1 on any problem. Reading the disk, printing and the exit code live here; the rules are in shape.ts.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { shapeProblems } from "./shape.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const listed = execFileSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
});
const files = [...new Set(listed.split("\0"))].filter((file) => file !== "" && existsSync(`${root}/${file}`));
const lines = (file: string): number => readFileSync(`${root}/${file}`, "utf8").split("\n").length - 1;

const problems = shapeProblems({ files, lines });
for (const problem of problems) console.error(problem);
console.log(problems.length === 0 ? `shape: ${files.length} files, 0 problems` : `shape: ${problems.length} problems`);
process.exitCode = problems.length === 0 ? 0 : 1;
