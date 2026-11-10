/** The bindings module's door: parse and validate the binding files, say what a request means, list the gaps. See README.md. */
import { load } from "./internal/load.ts";
import { parseFile } from "./internal/parse.ts";
import { gaps, select } from "./internal/select.ts";
import type { ScriptChecks } from "./types.ts";

export const parseBindingFile = parseFile;
export const loadBindings = load;
export const selectEvals = select;
export const gapsOf = gaps;
export type { Binding, BindingFile, Bindings, Gaps, Index, Known, NearMiss, Result, ScriptChecks, What } from "./types.ts";

/** A script's `--list` output (`name<TAB>check|guard` per line) as what it checks. */
export const parseScriptList = (output: string): ScriptChecks => {
  const checks = new Set<string>();
  const guards = new Set<string>();
  for (const line of output.split("\n")) {
    const [name, kind] = line.split("\t");
    if (name && kind === "check") checks.add(name);
    else if (name && kind === "guard") guards.add(name);
  }
  return { checks, guards };
};
