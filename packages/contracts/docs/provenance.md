# Where the contracts came from

What was brought from the old repository, what was changed to build here, and what was left behind. Nothing here
changes contract logic.

## The source

`Xelmar-tech/infrastructure`, branch `integration/factory`, commit **62e49471019d19f13536dde264cfd05c3dd5fedb**, folder
`packages/contracts/v4`, brought with `git archive` (nothing was checked out there or changed). No contract logic was changed.

**Brought:** `src/` (50 files, 9,666 lines: Companies House claimer and minter, Payments, Budgets, Agreements, EscrowFactory
and Escrow, the Installer, AgentOwner, and the equity contracts, which stay because the Installer and the tests depend on
them), `test/` (hermetic, fuzz, invariant, symbolic, exhaustive, fork and scenario tests, with their mocks and utilities),
`scenarios/` (read by the scenario tests), `certora/` and `halmos.toml` (the verification specs, not wired to a runner here),
`deploy/manifest.json` (the 15 contracts Companies House deploys, in order), `foundry.toml`.

**Changed, none of it contract logic:** `foundry.toml` points at `lib/` here (the old file pointed at pnpm's node_modules and a
sibling `../lib`); a `[profile.fork]` was added; `@beta/` now maps to `test/beta/`, which holds `CapxulPaymentsV3.sol` and
`CapxulEscrow.sol` copied from the old `packages/contracts/src`, because two differential fuzz tests compare v4 against them.
`deploy/devnet.json` (Companies House's Directors and the devnet tier) is a trimmed copy of the old tool's `devnet.json`.

**Left behind, and why:** the beta contracts other than those two (not v4); `deployments/devnet.json` of the old repository (its
addresses belong to the old build, see below; this package writes its own); `docs/planning/protocol-v4` (2.8 MB of plans and
specs that the test comments cite, such as `spec/installer.md`; read them at the source commit); `scripts/` (tool installers
and the old coverage and Halmos checkers, which need the old workspace); the ABI exports (`out/` is built, not committed).

## Dependencies

Vendored in `lib/`, so a build needs no network and no `node_modules`: `lib/forge-std` (v1.9.7, src only, as the old repository
vendored it) and `lib/openzeppelin` (contracts and contracts-upgradeable 5.6.1, the `.sol` files only). To rebuild
`lib/openzeppelin` from npm, checking each tarball against its published SHA-1, run `bash bin/vendor-deps.sh`. Solc 0.8.28 (Foundry
downloads it once). No git submodules.
