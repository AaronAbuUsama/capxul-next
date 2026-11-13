import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadTarget } from "../../blueprint-engine/scripts/target.ts";
import { executeRun } from "./execute.ts";
import { loadBindings, parseScriptList } from "./modules/bindings/service.ts";

test("a shows claim passes only with a fresh, non-empty, source-resolved capture from this run", async () => {
  const target = await loadTarget();
  assert.ok(target.ok);
  const ids = ["scr:supplier-invoice/shows", "scr:supplier-invoice/refuses"];
  const root = mkdtempSync(join(tmpdir(), "eval-screens-"));
  const printed: string[] = [];
  const log = console.log;
  try {
    mkdirSync(join(root, "packages/evals/src"), { recursive: true });
    symlinkSync(join(import.meta.dirname, "record-status.ts"), join(root, "packages/evals/src/record-status.ts"));
    mkdirSync(join(root, "status"));
    const loaded = loadBindings([{
      source: "acceptance.json", area: "acceptance", script: "run.sh", worlds: ["main"], secrets: [], near: [],
      bindings: ids.map((id, i) => ({ eval: id, checks: [`S${i + 1}.done`], why: "screen capture regression" })),
    }], { evals: new Set(ids), scripts: new Map([["run.sh", parseScriptList("S1.done\tcheck\nS2.done\tcheck")]]) });
    assert.ok(loaded.ok);
    // Real 1×1 images; a bare PNG signature is not a capture.
    const png = "printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAACklEQVQI12NoAAAAggCB3UNq9AAAAABJRU5ErkJggg==' | base64 -d", jpg = "printf '%s' '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==' | base64 -d";
    const checks = [
      "printf '@check\\tS1.done\\tpass\\t1\\tok\\n@check\\tS2.done\\tpass\\t1\\tok\\n'",
      'mkdir -p "$CAPXUL_EVAL_RUN_DIR/acceptance" "$CAPXUL_EVAL_RUN_DIR/sites"',
      `${png} > "$CAPXUL_EVAL_RUN_DIR/acceptance/shot.png"; ${png} > "$CAPXUL_EVAL_RUN_DIR/sites/shot.png"; printf text > "$CAPXUL_EVAL_RUN_DIR/acceptance/note.png"`,
      `{ printf '\\211PNG\\r\\n\\032\\n'; head -c 40 /dev/zero; } > "$CAPXUL_EVAL_RUN_DIR/acceptance/magic.png"; ${jpg} | head -c -2 > "$CAPXUL_EVAL_RUN_DIR/acceptance/cut.jpg"; ${jpg} > "$CAPXUL_EVAL_RUN_DIR/acceptance/shot.jpg"; printf text > "$CAPXUL_EVAL_RUN_DIR/acceptance/notes.txt"`,
      `printf '{"invoice":{"supplier":"Acme"},"a/b~c":1,"tilde":{"~1":1},"slash":{"/":1},"rows":[]}' > "$CAPXUL_EVAL_RUN_DIR/acceptance/sources.json"`,
    ].join("\n");
    const manifest = (screen: string, assertion = "source-equality", source = "acceptance/sources.json#/invoice/supplier", path = "acceptance/shot.png") =>
      `\nprintf '[{"screen":"${screen}","path":"${path}","source":"${source}","assertion":"${assertion}"}]' > "$CAPXUL_EVAL_RUN_DIR/screens.json"`;
    // An earlier run's manifest and capture, offered through --screens: real files, but older than this run.
    const old = join(root, "old");
    mkdirSync(old);
    writeFileSync(join(old, "shot.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAACklEQVQI12NoAAAAggCB3UNq9AAAAABJRU5ErkJggg==", "base64"));
    writeFileSync(join(old, "sources.json"), '{"invoice":{"supplier":"Acme"}}');
    writeFileSync(join(old, "screens.json"), '[{"screen":"supplier-invoice","path":"shot.png","source":"sources.json#/invoice/supplier","assertion":"source-equality"}]');
    for (const f of ["shot.png", "sources.json", "screens.json"]) utimesSync(join(old, f), new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    const shows = "scr:supplier-invoice/shows";
    // [script, --screens, state, pass count, uncaptured]: a capture decides the shows verdict; bad evidence fails the run.
    for (const [script, screens, state, pass, uncaptured] of [
      [checks, undefined, "complete", 1, [shows]],
      [checks + manifest("payment-entry"), undefined, "complete", 1, [shows]],
      [checks + manifest("supplier-invoice", "visual"), undefined, "complete", 1, [shows]],
      [checks + manifest("supplier-invoice"), undefined, "complete", 2, []],
      [checks + manifest("screen:supplier-invoice"), undefined, "complete", 2, []],
      [checks + manifest("supplier-invoice", "source-equality", "acceptance/sources.json#/a~1b~0c"), undefined, "complete", 2, []],
      [checks + manifest("supplier-invoice") + '\n: > "$CAPXUL_EVAL_RUN_DIR/acceptance/shot.png"', undefined, "incomplete", 0, [shows]],
      [checks + manifest("supplier-invoice") + '\nmv "$CAPXUL_EVAL_RUN_DIR/acceptance/shot.png" "$CAPXUL_EVAL_RUN_DIR/real.png"; ln -s ../real.png "$CAPXUL_EVAL_RUN_DIR/acceptance/shot.png"', undefined, "incomplete", 0, [shows]],
      [checks + manifest("supplier-invoice", "source-equality", "acceptance/sources.json#/invoice/missing"), undefined, "incomplete", 0, [shows]],
      [checks + manifest("supplier-invoice", "source-equality", "acceptance/sources.json#invoice"), undefined, "incomplete", 0, [shows]],
      [checks + manifest("supplier-invoice", "source-equality", "acceptance/sources.json#/constructor"), undefined, "incomplete", 0, [shows]],
      // RFC 6901 decoding is pinned: ~01 is "~1", never "/"; the leading "/" is required; an array has no length value.
      [checks + manifest("supplier-invoice", "source-equality", "acceptance/sources.json#/tilde/~01"), undefined, "complete", 2, []],
      [checks + manifest("supplier-invoice", "source-equality", "acceptance/sources.json#/slash/~01"), undefined, "incomplete", 0, [shows]],
      [checks + manifest("supplier-invoice", "source-equality", "acceptance/sources.json#xinvoice/supplier"), undefined, "incomplete", 0, [shows]],
      [checks + manifest("supplier-invoice", "source-equality", "acceptance/sources.json#/rows/length"), undefined, "incomplete", 0, [shows]],
      // A capture behind a nested linked directory lies outside the run; a capture must be an image other than its source.
      [checks + manifest("supplier-invoice", "source-equality", "acceptance/sources.json#/invoice/supplier", "acceptance/ext/shot.png")
        + `\nmkdir -p "$CAPXUL_EVAL_RUN_DIR/../../outside"; ${png} > "$CAPXUL_EVAL_RUN_DIR/../../outside/shot.png"; ln -s ../../../outside "$CAPXUL_EVAL_RUN_DIR/acceptance/ext"`, undefined, "incomplete", 0, [shows]],
      [checks + manifest("supplier-invoice", "source-equality", "acceptance/sources.json#/invoice/supplier", "acceptance/note.png"), undefined, "incomplete", 0, [shows]],
      [checks + manifest("supplier-invoice", "source-equality", "acceptance/sources.json#/invoice/supplier", "acceptance/sources.json"), undefined, "incomplete", 0, [shows]],
      [checks + manifest("supplier-invoice", "source-equality", "acceptance/shot.png"), undefined, "incomplete", 0, [shows]],
      [checks + manifest("supplier-invoice", "source-equality", "acceptance/sources.json#/invoice/supplier", "acceptance/magic.png"), undefined, "incomplete", 0, [shows]],
      [checks + manifest("supplier-invoice", "source-equality", "acceptance/sources.json#/invoice/supplier", "acceptance/cut.jpg"), undefined, "incomplete", 0, [shows]],
      [checks + manifest("supplier-invoice", "source-equality", "acceptance/sources.json#/invoice/supplier", "acceptance/shot.jpg"), undefined, "complete", 2, []],
      [checks + manifest("supplier-invoice", "source-equality", "acceptance/notes.txt"), undefined, "incomplete", 0, [shows]],
      [checks + manifest("supplier-invoice", "source-equality", "acceptance/sources.json#/invoice/supplier", "sites/shot.png"), undefined, "incomplete", 0, [shows]],
      [checks + manifest("supplier-invoice", "source-equality", "doctype:Purchase Invoice"), undefined, "incomplete", 0, [shows]],
      [checks, "old/screens.json", "incomplete", 0, [shows]],
    ] as const) {
      writeFileSync(join(root, "run.sh"), script);
      printed.length = 0;
      console.log = (line: string) => { printed.push(line); };
      const code = await executeRun(root, target.blueprint, loaded.value, ids, { world: "main", slug: "test", json: true, ...(screens ? { screens } : {}) }, "abc1234", []);
      console.log = log;
      const result = JSON.parse(printed.at(-1)!) as { state: string; passed: boolean; counts: { pass: number; fail: number }; uncaptured: string[] };
      const label = `${script} ${screens ?? ""}`;
      assert.equal(code, pass === 2 ? 0 : 1, label);
      assert.equal(result.state, state, label);
      assert.equal(result.counts.pass, pass, label);
      // In a complete run an uncaptured shows claim is an explicit failure, never a recorded pass.
      assert.equal(result.counts.fail, state === "complete" && pass === 1 ? 1 : 0, label);
      assert.equal(result.passed, pass === 2, label);
      assert.deepEqual(result.uncaptured, uncaptured, label);
      const status = JSON.parse(readFileSync(join(root, "status/status.json"), "utf8")) as { evals: Record<string, { verdict: string }> };
      assert.equal(status.evals[shows]?.verdict, pass === 2 ? "pass" : state === "complete" ? "fail" : "not_run", label);
    }
  } finally {
    console.log = log;
    rmSync(root, { recursive: true, force: true });
  }
});
