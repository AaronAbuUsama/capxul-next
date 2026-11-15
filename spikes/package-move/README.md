# Package move spike

The scripts that moved `packages/world/src` into its agreed layout (15 November 2026, `docs/design/world.md`,
pull requests #296 and #297) and built the "World Layout" explorer page that Aaron agreed it from. Kept as a spike
so the next package's move starts from them; to graduate, they become a tool that takes a package and its table.

- `moves.py`: the table, every old path to its new path with a one-line reason. The only hand-written part, and
  the part Aaron agrees for each package.
- `build.py`: reads the package and the table, rewrites every file's relative imports, `import.meta.dirname` paths
  and path mentions in comments for its new place (splitting an import when a file is split), and writes the
  explorer page (`page.html` with the data in it): before and after trees, each file's content, where it came from
  and why.
- `apply.py`: applies the same rewrite to the working tree with `git mv`, and fixes outside references (the ratchet
  lists, `.oxlintrc.json`, shell scripts that read moved files).
- `pages.py`: the new README, the docs pages cut from the old README, the layout test and the design page text.

Run from a checkout: `python3 spikes/package-move/build.py`, then `python3 spikes/package-move/apply.py`, then
`pnpm format && pnpm check`. `build.py` names `packages/world` by absolute path; change `PKG` for another package.

What a move still needed by hand after `apply.py` (each found by `pnpm check`): Effect service keys follow the
file's path (`deterministic-keys`); a ratchet entry keyed by a split file moves to the piece that holds the finding;
`os.path.normpath` drops a trailing `/` in a rewritten `import.meta.dirname` path.
