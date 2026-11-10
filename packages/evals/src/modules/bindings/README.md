# bindings

Which checks prove which evals. An eval is a claim the book derives; a check is a named step of an executable script, expected
to pass; a binding says "this eval holds when all of these checks pass". A near-miss says a check proves part of an eval, and
never scores. The files are `evals/bindings/<area>.json`.

```ts
const file = parseBindingFile("evals/bindings/sites.json", json);               // the shape
const loaded = loadBindings(files, { evals: bookEvalIds, scripts });            // against the book and the scripts' checks
const asked = selectEvals({ kind: "journey", id: "run_a_world" }, index, loaded.value);
const gaps = gapsOf(loaded.value, scripts, journeyEvalIds);                     // what has no check, and the checks no eval needs
```

`types.ts` is the module. `service.ts` is its door. Loading fails, naming every problem, on an eval the book does not derive, a
check the script does not list, a guard (a check that can only fail), an eval bound twice, a check named twice in one binding, a
script the runner does not know, and an eval that is both bound and a near-miss. Nothing here reads a file or runs a script;
`src/main.ts` does.
