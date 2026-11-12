import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./run.sh", import.meta.url));
test("activity catalogue needs no fixture and execution cannot pass without a running selected world", () => {
  const env = { ...process.env };
  for (const key of ["CAPXUL_EVAL_RUN_DIR", "CAPXUL_WORLD_CONFIG", "CAPXUL_ACCEPTANCE_FIXTURE"]) delete env[key];
  const list = spawnSync("bash", [script, "--list"], { env, encoding: "utf8" });
  assert.equal(list.status, 0, list.stderr);
  const names = list.stdout.trim().split("\n").map((line) => {
    const [name, kind] = line.split("\t"); assert.equal(kind, "check"); return name;
  });
  assert.equal(names.length, 4);
  const result = spawnSync("bash", [script, "missing-world", "--only", "ACTIVITY"], { env, encoding: "utf8" });
  assert.equal(result.status, 1);
  const lines = result.stdout.trim().split("\n").map((line) => line.split("\t"));
  assert.deepEqual(lines.map((line) => line[1]), names);
  assert(lines.every((line) => line[0] === "@check" && line[2] === "fail"));
});
