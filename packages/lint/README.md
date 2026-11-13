# lint

The repository's own checks, and the formatter's settings. The ladder that runs them is in `AGENTS.md`.

- `src/shape.ts` is the shape of the repository: what may sit at the top level, which packages may exist (each with
  a reason), that only `docs/roadmap.md` lives under `docs/`, that every package and spike has a `README.md`, that no
  source file under `packages/` is over 300 lines, and that the two lists of entry files in `.oxlintrc.json` agree.
  `pnpm shape` runs it through `src/shape.entry.ts`.
- `src/plugin.ts` is the `capxul` oxlint plugin; its rules are in `src/rules/`. `.oxlintrc.json` loads it.
- `oxfmt.json` is oxfmt's configuration: 120 columns, the rest oxfmt's defaults. It lives here because the top level
  is closed.
- `test/` holds the tests: each rule runs through oxlint's own `RuleTester`, and the shape check on made-up trees.

To add a package, add it to `PACKAGES` in `src/shape.ts` with a one-line reason, in the same pull request. To add an
entry file, add its path to `settings.capxul.entries` with a reason and to the entry override in `.oxlintrc.json`.
