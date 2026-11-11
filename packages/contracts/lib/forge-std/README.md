# Vendored forge-std

This folder holds a copy of [forge-std](https://github.com/foundry-rs/forge-std),
the Forge standard library, at the tag and commit in `upstream.json`. The copy
holds upstream's `src/` tree and its two license files. Do not edit these files
by hand.

The copy replaces the former npm dependency
`github:foundry-rs/forge-std#v1.9.7`. pnpm resolved that dependency to a
`codeload.github.com` tarball, and the cloud agent environments refuse
`codeload.github.com` for a repository that is not attached to the session.
Only git reads of public repositories pass. A copy in the repository needs no
network at install time, so a plain `pnpm install --frozen-lockfile` works in
every environment.

## Update the copy

1. Set `tag` and `commit` in `upstream.json` to the new release. The commit
   must be the one the tag points at.
2. Run `vp run --filter @capxul/contracts vendor:forge-std`. The script clones
   the tag with git, checks the commit, and replaces `src/` and the licenses.
3. Run `vp run contracts:build` and `vp run test:contracts`.

`vp run --filter @capxul/contracts vendor:forge-std:check` compares the copy
with upstream and fails on a difference.
