/** Validates parsed binding files against the blueprint's evals and the scripts' checks, and indexes them by eval. */
import type { Binding, BindingFile, Bindings, Known, Result } from "../types.ts";

export const load = (files: readonly BindingFile[], known: Known): Result<Bindings> => {
  const errors: string[] = [];
  const byEval = new Map<string, { file: BindingFile; binding: Binding }>();
  const nearOf = new Map<string, string>();
  for (const file of files) {
    const script = known.scripts.get(file.script);
    if (!script) errors.push(`${file.source}: script ${file.script} is not one the runner knows`);
    const checkNames = (where: string, id: string, names: readonly string[]): void => {
      if (!known.evals.has(id)) errors.push(`${file.source}: ${where} ${id}: the blueprint derives no such eval`);
      names.forEach((name, i) => {
        if (names.indexOf(name) !== i) errors.push(`${file.source}: ${where} ${id}: check ${name} is named twice`);
        else if (script?.guards.has(name)) errors.push(`${file.source}: ${where} ${id}: ${name} is a guard, which only ever fails, so it proves nothing`);
        else if (script && !script.checks.has(name)) errors.push(`${file.source}: ${where} ${id}: ${file.script} has no check ${name}`);
      });
    };
    for (const b of file.bindings) {
      checkNames("binding", b.eval, b.checks);
      const had = byEval.get(b.eval);
      if (had) errors.push(`${file.source}: eval ${b.eval} is bound twice (also in ${had.file.source})`);
      else byEval.set(b.eval, { file, binding: b });
    }
    for (const n of file.near) {
      checkNames("near-miss", n.eval, n.checks);
      const had = nearOf.get(n.eval);
      if (had) errors.push(`${file.source}: eval ${n.eval} has two near-misses (also in ${had})`);
      else nearOf.set(n.eval, file.source);
    }
  }
  for (const [id, source] of nearOf) if (byEval.has(id)) errors.push(`${source}: eval ${id} is a near-miss and is bound: it is one or the other`);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { files, byEval } };
};
