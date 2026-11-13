import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("notices catalogue needs no fixture; missing selected world fails every requested check", () => {
  const script = fileURLToPath(new URL("./run.sh",import.meta.url)), env = { ...process.env };
  for (const key of ["CAPXUL_EVAL_RUN_DIR","CAPXUL_WORLD_CONFIG","CAPXUL_ACCEPTANCE_FIXTURE"]) delete env[key];
  const list = spawnSync("bash",[script,"--list"],{ env,encoding: "utf8" });
  assert.equal(list.status,0,list.stderr);
  const names = list.stdout.trim().split("\n").map((line) => {
    const [name,kind] = line.split("\t"); assert.equal(kind,"check"); return name;
  });
  assert.equal(names.length,4);
  for (const prefix of ["NOTICES","NOTICES.schema"]) {
    const result = spawnSync("bash",[script,"missing","--only",prefix],{ env,encoding: "utf8" });
    assert.equal(result.status,1,result.stderr);
    const lines = result.stdout.trim().split("\n").map((line) => line.split("\t"));
    assert.deepEqual(lines.map((line) => line[1]),names.filter((name) => name!.startsWith(prefix)));
    assert(lines.every((line) => line[0] === "@check" && line[2] === "fail"));
  }
});
