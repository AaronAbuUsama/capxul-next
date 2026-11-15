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
  their one owner.
- `src/gate.ts` declares the gate's rungs; `src/maps.ts` checks that every package has its generated map. What other
  packages may import gives them, `PACKAGES` and each rule's `description` to `pnpm generate` for the docs.
- `src/unmigrated.ts` holds the unmigrated lists of the three typed-once rules (below), and `src/rules/ratchet.ts`
  the ratchet they share.
- `oxfmt.json` is oxfmt's configuration: 120 columns, the rest oxfmt's defaults (here, as the top level is closed).
- `test/` holds the tests: each rule runs through oxlint's own `RuleTester`, and the shape check on made-up trees.

## The rules, from each one's `description` in `src/rules/`

<!-- generated:lint-rules start -->
<!-- Written by `pnpm generate` from each rule's `description` in packages/lint/src/rules/; never edit it. -->
- `capxul/blueprint-owns-names`: an operation, a refusal (a tagged error), an event or a starting world is declared only
  in `packages/blueprint`.
- `capxul/effect-only`: no `async`, `await`, `new Promise`, `try`, `throw`, `process.env`, `Date.now`, `new Date()` or
  `console` in TypeScript outside entry files. Entry files are listed in `.oxlintrc.json` under
  `settings.capxul.entries`, each with its reason.
- `capxul/import-door`: another package is imported only through its door, `src/door.ts` (`src/index.ts` in the
  blueprint and its toolkit), or by its bare name.
- `capxul/no-json-text`: no `JSON.parse`, `JSON.stringify`, `Schema.parseJson` or string schema documented as JSON
  outside entry files and the edges listed under `settings.capxul.jsonEdges`.
- `capxul/owned-values`: a raw schema (`Schema.String`, `Schema.Literals`, ...) only in the blueprint's values files,
  machines and telemetry vocabulary, and there only as a named value, never as a field; elsewhere only in entry files
  and the edges listed under `settings.capxul.schemaEdges`, each with its reason.
- `capxul/declared-names`: a name the blueprint declares (an operation, a refusal, an event, an outcome, a starting
  world) is imported, never written as a string outside the blueprint, except where the compiler checks it (an object's
  key, a computed member, the tag given to `catchTag`, `Match.tag` or `isTagged`).
- `capxul/decoded-rows`: no `sql<Row>` cast outside the blueprint; rows are decoded with the blueprint's schemas.
<!-- generated:lint-rules end -->

## Typed once, with a ratchet

The last three come from step 3.3 (`docs/roadmap.md`, "Typed once, by check" and "New formats by a ratchet"). Each
exempts generated files: a file whose first line is a comment starting `// Generated`, written by `pnpm generate` and
never edited. `owned-values` also counts `ids.ts` and `Schema.Int`; `declared-names` also allows `Match.tagStartsWith`,
and the rules' own tests, which hold declared names on purpose, are excepted in `.oxlintrc.json`.

What each rule found when it was turned on is on its list in `src/unmigrated.ts`: a file, and how many findings it
may still hold. A listed file with more findings than its count fails (the count must not grow); one with fewer fails
too, saying to lower the count. So when you migrate a file, lower its count to what the rule now finds there (remove
the entry at zero), and lower the rule's ceiling in `test/owned-values.test.ts` by the same amount. A new file is
never added to a list: new work is born compliant.

To add a package, add it to `PACKAGES` in `src/shape.ts` with a one-line reason, in the same pull request. To add an
entry file, add its path to `settings.capxul.entries` with a reason and to the entry override in `.oxlintrc.json`.
