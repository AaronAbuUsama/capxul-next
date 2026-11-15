# lint

The repository's own checks, and the formatter's settings. The gate that runs them is in `AGENTS.md`.

- `src/shape.ts` is the shape of the repository: what may sit at the top level, which packages may exist (each with
  a reason), that every package and spike has a `README.md`, that no source file under `packages/` is over 300 lines,
  and that the two lists of entry files in `.oxlintrc.json` agree.
- `src/docs.ts` is the shape of the docs (`docs/design/docs.md`): what may live under `docs/`, where else a Markdown
  file may live, that a README fits on a screen of 60 lines, that every relative link resolves, and that a design note
  says `Status: open`, `agreed` or `superseded` near its top. Its two lists of exceptions, `LONG_READMES` and
  `UNSTATED_NOTES`, may only shrink; take a file off when it complies.
- `pnpm shape` runs both through `src/shape.entry.ts` on the files git tracks (`git ls-files`), so nothing untracked or
  ignored, such as `node_modules` or a local run's records, ever counts.
- `src/plugin.ts` is the `capxul` oxlint plugin; its rules are in `src/rules/`. `.oxlintrc.json` loads it. The plugin
  imports `@capxul/blueprint` for `declaredNames`, the names `capxul/declared-names` guards, so the blueprint stays
  their one owner; oxlint's plugin host loads the blueprint like any other module.
- `src/unmigrated.ts` holds the unmigrated lists of the three typed-once rules (below), and `src/rules/ratchet.ts`
  the ratchet they share.
- `oxfmt.json` is oxfmt's configuration: 120 columns, the rest oxfmt's defaults. It lives here because the top level
  is closed.
- `test/` holds the tests: each rule runs through oxlint's own `RuleTester`, and the shape check on made-up trees.

## Typed once, with a ratchet

Step 3.3 (`docs/roadmap.md`, "Typed once, by check" and "New formats by a ratchet") adds three rules. Each exempts
generated files: a file whose first line is a comment starting `// Generated`, written by `pnpm generate` and never
edited.

- `capxul/owned-values`: a raw schema (`Schema.String`, `Schema.Literals`, `Schema.Int`, ...) appears only in the
  blueprint's values files (`values.ts`, `ids.ts`) and machines (`machines.ts`), and there only as the whole of a
  named value, never as a field of a struct, refusal or event. Elsewhere it is found wherever it is, except in entry
  files and in the edges listed under `settings.capxul.schemaEdges`, each with its reason: places whose schemas
  describe a format of their own (a run record's file, an infrastructure failure), not the contract's values.
- `capxul/declared-names`: a name the blueprint declares (an operation, a refusal's tag, an event's or an outcome's
  tag, a starting world) is not written as a string outside the blueprint. The compiler-checked places are allowed: an
  object's key, a computed member, and the tag given to `Effect.catchTag`, `Match.tag`, `Match.tagStartsWith` or
  `Predicate.isTagged`. The lint rules' own tests hold such names on purpose and are excepted in `.oxlintrc.json`.
- `capxul/decoded-rows`: no `sql<Row>` query outside the blueprint; a row is read untyped and decoded with the
  blueprint's schema.

What each rule found when it was turned on is on its list in `src/unmigrated.ts`: a file, and how many findings it
may still hold. A listed file with more findings than its count fails (the count must not grow); one with fewer fails
too, saying to lower the count. So when you migrate a file, lower its count to what the rule now finds there (remove
the entry at zero), and lower the rule's ceiling in `test/owned-values.test.ts` by the same amount. A new file is
never added to a list: new work is born compliant.

To add a package, add it to `PACKAGES` in `src/shape.ts` with a one-line reason, in the same pull request. To add an
entry file, add its path to `settings.capxul.entries` with a reason and to the entry override in `.oxlintrc.json`.
