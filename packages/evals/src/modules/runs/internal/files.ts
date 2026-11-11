/** The files a run leaves: the results file `packages/evals/src/record-status.ts` merges, and the evidence behind each verdict. */
import type { ResultsFile } from "@capxul/blueprint-engine";
import type { Row, RunInfo } from "../types.ts";

/** An eval id as a file name: `acc:doc.submit/1` is `acc-doc.submit-1`. */
export const fileNameOf = (id: string): string => id.replace(/[:/]/g, "-");

export const resultsFile = (info: RunInfo, rows: readonly Row[], evidenceOf: (id: string) => string): ResultsFile => ({
  commit: info.commit, at: info.at, run: info.run,
  results: rows.map((r) => ({ id: r.id, verdict: r.verdict, evidence: evidenceOf(r.id) })),
});

/** What a verdict rests on, in a few lines: the eval, the run, and each check with its verdict and detail. */
export const evidenceText = (info: RunInfo, row: Row, claim: string, why: string): string =>
  [
    `eval     ${row.id}`, `claim    ${claim}`, `verdict  ${row.verdict}`, `run      ${info.run}  at ${info.at}  commit ${info.commit}`,
    `script   ${info.script}  world ${info.world}  company ${info.slug}`, `why      ${why}`, "",
    ...(row.checks.length === 0 ? ["no check is bound to this eval, so nothing was run for it"] : row.checks.map((c) => `${c.verdict.toUpperCase()}  ${c.name}  x${c.times}  ${c.ms} ms\n      ${c.detail}`)),
    "",
  ].join("\n");

/** The text with every secret value replaced, so evidence can be committed. Values under 6 characters are not secrets worth hiding. */
export const redact = (text: string, secrets: readonly string[]): string =>
  secrets.filter((s) => s.length >= 6).reduce((t, s) => t.split(s).join("[redacted]"), text);

/** At most `max` characters: the start and the end are kept, with a marker where the middle went. */
export const cap = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, Math.floor(max / 2))}\n[... ${text.length - max} characters left out ...]\n${text.slice(text.length - Math.floor(max / 2))}`;
