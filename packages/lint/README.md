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

## The rules

What each rule finds is listed once, in `AGENTS.md` ("Our lint rules"), written there by `pnpm generate` from each
rule's `description` in `src/rules/`.

## Typed once, with a ratchet

`owned-values`, `declared-names` and `decoded-rows` come from step 3.3 (`docs/roadmap.md`, "Typed once, by check"
and "New formats by a ratchet"). Each exempts generated files: a file whose first line is a comment starting
`// Generated`, written by `pnpm generate` and never edited. `owned-values` also counts `ids.ts` and `Schema.Int`; `declared-names` also allows `Match.tagStartsWith`,
and the rules' own tests, which hold declared names on purpose, are excepted in `.oxlintrc.json`.

What each rule found when it was turned on is on its list in `src/unmigrated.ts`: a file, and how many findings it
may still hold. A listed file with more findings than its count fails (the count must not grow); one with fewer fails
too, saying to lower the count. So when you migrate a file, lower its count to what the rule now finds there (remove
the entry at zero), and lower the rule's ceiling in `test/owned-values.test.ts` by the same amount. A new file is
never added to a list: new work is born compliant.

To add a package, add it to `PACKAGES` in `src/shape.ts` with a one-line reason, in the same pull request. To add an
entry file, add its path to `settings.capxul.entries` with a reason and to the entry override in `.oxlintrc.json`.

`declared-steps` (step 4.1) is ratcheted the same way, its list in `src/unmigrated-steps.ts` and its ceiling in
`test/rules.test.ts`; its rule's comment says exactly what counts as a function that does work.
