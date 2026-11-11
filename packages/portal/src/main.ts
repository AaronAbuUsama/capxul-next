/**
 * The portal's process entry and composition root. The only file here that reads the arguments, runs the server, prints
 * or exits. It loads the repository (`load.ts`), hands it to the modules, and writes what they return.
 *
 *   node --experimental-strip-types src/main.ts generate <outDir>   write the site
 *   node --experimental-strip-types src/main.ts check               generate twice in memory and run the portal check
 *   node --experimental-strip-types src/main.ts serve [--port n]    serve packages/portal/dist on 127.0.0.1 with the answers endpoint
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { check, expect, passed } from "#src/modules/check/service.ts";
import { renderSite } from "#src/modules/render/service.ts";
import { buildSite } from "#src/modules/site/service.ts";
import type { SiteInput } from "#src/modules/site/types.ts";
import { twinsOf } from "#src/modules/twins/service.ts";
import type { Assets } from "#src/modules/render/types.ts";
import { LLMS_FILE } from "#src/modules/twins/types.ts";

import { assetsOf, extraPagesOf, load, ownerNeedsOf, planPagesOf, ROOT, type Result } from "./load.ts";
import { listen } from "./serve.ts";

export { assetsOf, extraPagesOf, load, ownerNeedsOf, planPagesOf, ROOT };
export type { Result };

/** The whole site as file path to content: the pages, the stylesheet and script, the twins and `llms.txt`. */
export const generate = (input: SiteInput, assets: Assets): ReadonlyMap<string, string> => {
  const site = buildSite(input);
  return new Map([...renderSite(site, assets), ...twinsOf(site)]);
};

/** Writes the site. It replaces `outDir` only when that folder is absent, empty, or a site this generator wrote. */
const write = (outDir: string, files: ReadonlyMap<string, string>): Result<number> => {
  if (existsSync(outDir) && readdirSync(outDir).length > 0 && !existsSync(join(outDir, LLMS_FILE))) {
    return { ok: false, error: `${outDir} holds files this generator did not write; it is left as it is` };
  }
  rmSync(outDir, { recursive: true, force: true });
  const made = new Set<string>();
  for (const [file, content] of files) {
    const folder = dirname(join(outDir, file));
    if (!made.has(folder)) {
      mkdirSync(folder, { recursive: true });
      made.add(folder);
    }
    writeFileSync(join(outDir, file), content);
  }
  return { ok: true, value: files.size };
};

/** Runs one command and returns the lines to print and the exit code. */
const run = async (args: readonly string[]): Promise<{ readonly lines: readonly string[]; readonly code: number }> => {
  const [command, outDir] = args;
  if (command !== "check" && !(command === "generate" && outDir !== undefined)) {
    return { lines: ["usage: main.ts generate <outDir> | main.ts check | main.ts serve [--port n]"], code: 2 };
  }
  const loaded = await load(ROOT);
  if (!loaded.ok) return { lines: [loaded.error], code: 1 };
  const input = loaded.value;
  const assets = assetsOf();
  const files = generate(input, assets);
  if (command === "generate" && outDir !== undefined) {
    const written = write(resolve(outDir), files);
    if (!written.ok) return { lines: [written.error], code: 1 };
    const pages = [...files.keys()].filter((f) => f.endsWith(".html")).length;
    return {
      lines: [`${pages} pages, ${written.value} files written to ${resolve(outDir)} at commit ${input.commit} ` +
        `(${input.blueprint.records.size} records, ${input.blueprint.problems.length} problems, ${input.blueprint.gaps.length} gaps)`],
      code: 0,
    };
  }
  const outcomes = check(files, generate(input, assets), expect(input.blueprint, input.waits, input.status, {
    problems: (input.plan?.problems ?? []).map((p) => `${p.at}: ${p.why}`), tasks: input.plan?.plan.tasks.length ?? null,
    ownerNeeds: ownerNeedsOf(input), pages: planPagesOf(input),
  }, extraPagesOf(input)));
  return {
    lines: [
      ...outcomes.flatMap((o) => [
        `${o.failures === 0 ? "pass" : "FAIL"}  ${o.check}${o.failures === 0 ? "" : ` (${o.failures})`}`,
        ...o.detail.map((d) => `      ${d}`),
      ]),
      passed(outcomes) ? `portal check passed: ${files.size} files` : "portal check FAILED",
    ],
    code: passed(outcomes) ? 0 : 1,
  };
};

/** `serve [--port n]`: the site from packages/portal/dist and the answers endpoint, on 127.0.0.1. Stays running. */
const serve = async (args: readonly string[]): Promise<number> => {
  const at = args.indexOf("--port");
  const port = at >= 0 ? Number(args[at + 1]) : 4391;
  if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error("usage: main.ts serve [--port n]"); return 2; }
  const loaded = await load(ROOT);
  if (!loaded.ok) { console.error(loaded.error); return 1; }
  /** Extra hosts the server answers on, for a private proxy in front of it (a tailnet address). Never a public one. */
  const extraHosts = (process.env.PORTAL_ALLOW_HOSTS ?? "").split(",").map((h) => h.trim()).filter((h) => h !== "");
  const started = await listen(loaded.value, ROOT, port, extraHosts, Number(process.env.PORTAL_RUNS_PORT) || undefined, () => load(ROOT));
  if (!started.ok) { console.error(started.error); return 1; }
  console.log(`Serving packages/portal/dist at ${started.value.url} (127.0.0.1 only). ${started.value.closed ?? "Answers are appended to plan/answers.jsonl."}`);
  return 0;
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === "serve") {
      process.exitCode = await serve(process.argv.slice(3));
    } else {
      const { lines, code } = await run(process.argv.slice(2));
      console.log(lines.join("\n"));
      process.exitCode = code;
    }
  } catch (cause) {
    console.error(cause instanceof Error ? cause.stack ?? cause.message : String(cause));
    process.exitCode = 1;
  }
}
