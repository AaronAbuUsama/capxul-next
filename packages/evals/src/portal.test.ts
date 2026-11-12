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
import { loadTarget } from "../../blueprint-engine/scripts/target.ts";

const REPO = resolve(import.meta.dirname, "../../..");
const FAILING = "acc:doc.submit/c-74a45893884b5bef";
const PASSING = "acc:world.snapshot.restore/c-369b1db183b9807f";

test("a failing result shows as fail on the operation's page, a passing one as pass, and one that never ran as not run", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "evals-portal-"));
  const root = join(tmp, "root");
  mkdirSync(join(root, "status"), { recursive: true });
  symlinkSync(join(REPO, "blueprint"), join(root, "blueprint"));
  symlinkSync(join(REPO, "plan"), join(root, "plan"));

  const target = await loadTarget();
  assert.ok(target.ok);
  const results = join(tmp, "results.json");
  writeFileSync(results, JSON.stringify({
    commit: "abc1234", at: "2026-11-10T12:00:00Z", run: "run-test",
    receipt: {
      version: 1, id: "run-test", commit: "abc1234", at: "2026-11-10T12:00:00Z", finishedAt: "2026-11-10T12:01:00Z", state: "complete",
      environment: { world: "main", storage: "json", indexer: "inline", stack: "skeleton-json", components: {} },
      requested: [FAILING, PASSING], evals: target.blueprint.evals.filter((e) => [FAILING, PASSING].includes(e.id)).map(({ id, claim, observes }) => ({ id, claim, observes })),
      scripts: [], screens: [],
    },
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
  assert.match(row(page("doc.submit"), "acc:doc.submit/c-df3c0c51cdf3899b"), /chip chip-quiet">not run</, "an eval with no verdict is not shown as run");
  assert.doesNotMatch(row(page("doc.submit"), FAILING), /chip-blue/, "a failing eval must not also look passing");
  assert.match(row(page("doc.submit"), FAILING), /<b>Observes<\/b>.*Purchase Invoice.*General Ledger/s, "opaque IDs must retain their own rendered observation");
  assert.match(row(page("doc.submit"), "acc:doc.submit/c-df3c0c51cdf3899b"), /<b>Observes<\/b>.*org-with-held-payment.*awaiting/s);
  assert.doesNotMatch(row(page("doc.submit"), FAILING), /org-with-held-payment/, "adjacent claims must not exchange observations");
});
