# lint

The repository's own checks.

- `src/shape.ts` is the shape of the repository: what may sit at the top level, which packages may exist (each with
  a reason), that only `docs/roadmap.md` lives under `docs/`, that every package and spike has a `README.md`, and that
  no source file under `packages/` is over 300 lines. `pnpm shape` runs it through `src/shape.entry.ts`.
- `test/` holds the tests: `pnpm --filter @capxul/lint test`.

To add a package, add it to `PACKAGES` in `src/shape.ts` with a one-line reason, in the same pull request.
