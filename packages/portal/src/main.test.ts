import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { check, expect, passed } from "#src/modules/check/service.ts";

import { assetsOf, extraPagesOf, generate, load, ownerNeedsOf, ROOT } from "./main.ts";
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
