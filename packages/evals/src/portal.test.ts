// A failing result written into a status file must show as failing on the portal, and a pass as passing.
// The status file is a temporary one made by packages/evals/src/record-status.ts (the only writer); the portal is read from a temporary
// root that points at the real blueprint and plan, and generated into a temporary directory.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

import { assetsOf, generate, load } from "../../portal/src/main.ts";

const REPO = resolve(import.meta.dirname, "../../..");
const FAILING = "acc:doc.submit/1";
const PASSING = "acc:world.snapshot.restore/1";

test("a failing result shows as fail on the operation's page, a passing one as pass, and one that never ran as not run", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "evals-portal-"));
  const root = join(tmp, "root");
  mkdirSync(join(root, "status"), { recursive: true });
  symlinkSync(join(REPO, "blueprint"), join(root, "blueprint"));
  symlinkSync(join(REPO, "plan"), join(root, "plan"));

  const results = join(tmp, "results.json");
  writeFileSync(results, JSON.stringify({
    commit: "abc1234", at: "2026-11-10T12:00:00Z", run: "run-test",
    results: [{ id: FAILING, verdict: "fail", evidence: "status/runs/run-test/evidence/x.txt" }, { id: PASSING, verdict: "pass" }],
  }));
  const status = join(root, "status/status.json");
  const recorded = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(REPO, "packages/evals/src/record-status.ts"), results, "--status", status], { encoding: "utf8" });
  assert.equal(recorded.status, 0, recorded.stdout + recorded.stderr);

  const loaded = await load(root, "abc1234");
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.error);
  const out = join(tmp, "site");
  for (const [file, content] of generate(loaded.value, assetsOf())) {
    mkdirSync(dirname(join(out, file)), { recursive: true });
    writeFileSync(join(out, file), content);
  }
  const page = (id: string): string => readFileSync(join(out, "operation", id, "index.html"), "utf8");
  const row = (html: string, evalId: string): string => {
    const at = html.indexOf(`<td class="mono eval-id">${evalId}</td>`);
    assert.ok(at >= 0, `no row for ${evalId}`);
    return html.slice(at, html.indexOf("</tr>", at));
  };

  assert.match(row(page("doc.submit"), FAILING), /chip chip-orange">fail</, "the failing eval is not shown as failing");
  assert.match(row(page("world.snapshot.restore"), PASSING), /chip chip-blue">pass</);
  assert.match(row(page("doc.submit"), "acc:doc.submit/2"), /chip chip-quiet">not run</, "an eval with no verdict is not shown as run");
  assert.doesNotMatch(row(page("doc.submit"), FAILING), /chip-blue/, "a failing eval must not also look passing");
});
