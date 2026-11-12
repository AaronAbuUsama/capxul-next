import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { RunReceipt } from "@capxul/blueprint-engine";

import { check, expect, passed } from "#src/modules/check/service.ts";

import { assetsOf, extraPagesOf, generate, load, ownerNeedsOf, ROOT } from "./main.ts";
import { sliceRunsOf } from "./run-input.ts";
import { closedFor, waitingOf } from "./serve.ts";

test("the real blueprint generates a site that passes the portal check", async () => {
  const loaded = await load(ROOT, "test000");
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.error);
  const input = loaded.value;
  assert.equal(input.blueprint.problems.length, 0);
  const assets = assetsOf();
  const files = generate(input, assets);
  const expected = expect(input.blueprint, input.waits, input.status, ownerNeedsOf(input), extraPagesOf(input));
  assert.ok(input.worlds, "the Worlds page is made from docs/design/worlds-platform.md");
  assert.ok((files.get("worlds/index.html") ?? "").includes("Worlds as a hosted platform"));
  assert.ok((files.get("worlds.md") ?? "").includes("## Clean data"));
  assert.ok(input.guide, "the Blueprint page is made from docs/blueprint-guide.md");
  assert.ok((files.get("blueprint/index.html") ?? "").includes('<h3 id="followed">'));
  assert.ok((files.get("blueprint.md") ?? "").includes("### Followed: doc.submit, acceptance line 1"));
  assert.ok(!(files.get("blueprint/index.html") ?? "").includes("Not explained on this page yet"), "every kind of record and of eval has its words on the Blueprint page");
  for (const path of ["design/index.html", "design.md", "data/design.json"]) {
    const page = files.get(path) ?? "";
    for (const phrase of ["sites-backup", "production", "worlds", "34.249.131.57", "8 February 2027", "No production RPO/RTO promised"]) {
      assert.ok(page.includes(phrase), `${path} exposes deployment record: ${phrase}`);
    }
  }
  assert.ok(input.slices);
  const board = JSON.parse(files.get("data/board.json") ?? "null") as { sliceManifest: unknown };
  assert.deepEqual(board.sliceManifest, input.slices, "the CLI and board consume one manifest");
  assert.match(files.get("board.md") ?? "", /one agent per concept/i);
  const zero = files.get("slice/slice-0.md") ?? "";
  for (const claim of ["scr:supplier-invoice/shows", "scr:safe-trial-balance/shows", "alr:money_event_parked/clears"]) assert.ok(zero.includes(claim));
  assert.match(zero, /Required declaration has not landed|not run/);
  assert.ok((files.get("slice/slice-0/index.html") ?? "").includes("Owned events and screens"));
  const outcomes = check(files, generate(input, assets), expected);
  assert.ok(passed(outcomes), JSON.stringify(outcomes.filter((o) => o.failures > 0), null, 2));

  const operations = [...input.blueprint.records.values()].filter((r) => r._kind === "operation").length;
  assert.equal(expected.operations.length, operations);
  assert.equal([...files.keys()].filter((f) => f.endsWith(".html")).length, expected.pages.length);
  assert.equal(files.size, expected.pages.length * 3 + 3);
  // The list of what waits on the owner may be empty: he may have answered everything.
  assert.ok((files.get("assets/style.css") ?? "").length > 1000);
});

test("a folder with no books is an error value, not a throw", async () => {
  const loaded = await load("/nonexistent-capxul-root", "test000");
  assert.equal(loaded.ok, false);
});

test("slice evidence reads the immutable matching run and only in-run capture files", () => {
  const root = mkdtempSync(join(tmpdir(), "portal-receipt-"));
  try {
    const directory = join(root, "status/runs/fixture");
    mkdirSync(directory, { recursive: true });
    const receipt: RunReceipt = { version: 1, id: "fixture", state: "complete", commit: "fixture-only", at: "2026-11-12T10:00:00Z", finishedAt: "2026-11-12T10:00:01Z",
      environment: { world: "fixture", storage: "postgres", indexer: "ponder", stack: "postgres-ponder-erpnext-v4", components: { fixture: "1" } },
      requested: ["scr:fixture/shows"], evals: [{ id: "scr:fixture/shows", claim: "Shows source values." }], scripts: [{ script: "fixture", exitCode: 0, signal: null }],
      screens: [{ screen: "fixture", path: "capture.png", source: "acceptance/sources.json#fixture", assertion: "source-equality" }] };
    writeFileSync(join(directory, "receipt.json"), JSON.stringify(receipt));
    const verdict = { verdict: "pass", run: receipt.id, commit: receipt.commit, at: receipt.at, claim: receipt.evals[0]!.claim };
    const status = (run: string) => writeFileSync(join(directory, "status.json"), JSON.stringify({ version: 1, evals: { "scr:fixture/shows": { ...verdict, run } } }));
    status("another-run");
    // A global historical pass must not fill in an absent or foreign-run immutable result.
    writeFileSync(join(root, "status/status.json"), JSON.stringify({ version: 1, evals: { "scr:fixture/shows": verdict } }));
    assert.deepEqual(sliceRunsOf(root)[0]?.status.evals, {});
    status(receipt.id);
    assert.equal(sliceRunsOf(root)[0]?.status.evals["scr:fixture/shows"]?.verdict, "pass");
    assert.equal(sliceRunsOf(root)[0]?.screens.length, 0);
    writeFileSync(join(directory, "capture.png"), "fixture capture");
    assert.equal(sliceRunsOf(root)[0]?.screens.length, 1);
    rmSync(join(directory, "capture.png"));
    symlinkSync(join(root, "status/status.json"), join(directory, "capture.png"));
    assert.equal(sliceRunsOf(root)[0]?.screens.length, 0, "an outside symlink is not an in-run capture");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a server started from a linked worktree takes no answers; one started from the repository's own checkout does", () => {
  const worktree = mkdtempSync(join(tmpdir(), "portal-worktree-")), own = mkdtempSync(join(tmpdir(), "portal-own-"));
  writeFileSync(join(worktree, ".git"), "gitdir: /somewhere/.git/worktrees/x\n");
  mkdirSync(join(own, ".git"));
  assert.match(closedFor(worktree) ?? "", /served from a worktree.*takes no answers/);
  assert.equal(closedFor(own), undefined);
  assert.equal(closedFor(ROOT), existsSync(join(ROOT, ".git")) && statSync(join(ROOT, ".git")).isFile() ? closedFor(worktree) : undefined);
});

test("the server takes an answer for exactly the cards the served Questions page offers", async () => {
  const loaded = await load(ROOT, "test000");
  assert.ok(loaded.ok);
  const dist = mkdtempSync(join(tmpdir(), "portal-dist-"));
  mkdirSync(join(dist, "data"));
  writeFileSync(join(dist, "data/review.json"), JSON.stringify({ questions: [
    { kind: "decision", id: "new.decision", options: [{ label: "a" }, { label: "b" }] }, { kind: "need", id: "a-task" },
  ] }));
  const waiting = waitingOf(loaded.value, ROOT, dist);
  assert.deepEqual([...waiting.decisions], [["new.decision", ["a", "b"]]]);
  assert.deepEqual([...waiting.tasks], ["a-task"]);
});
