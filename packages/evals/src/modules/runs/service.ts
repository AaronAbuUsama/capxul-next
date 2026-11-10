/** The runs module's door: read a script's checks, score the evals, write the results and the evidence. See README.md. */
import { fold, parseLines, score } from "./internal/checks.ts";
import { cap, evidenceText, fileNameOf, redact, resultsFile } from "./internal/files.ts";

export const parseCheckLines = parseLines;
export const foldChecks = fold;
export const scoreEvals = score;
export { cap, evidenceText, fileNameOf, redact, resultsFile };
export type { CheckLine, Folded, Row, RunInfo, Scored } from "./types.ts";
