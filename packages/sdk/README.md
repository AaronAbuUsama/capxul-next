# @capxul/sdk (Core SDK, started)

For now only the key signing path, brought from `packages/sdk/src/signing` of `Xelmar-tech/infrastructure` at
`62e49471019d19f13536dde264cfd05c3dd5fedb`. Per decision `system.layout` this is the Core SDK package; signing belongs to the
`access` concept (`src/access/`), reached through its door `src/access/door.ts`.

**Brought:** `signer.ts` (`CapxulSigner`, `injectedWalletSigner`, `signerFailure`), `account-providers.ts` (`localPrivateKeyAccountProvider`,
`eip1193AccountProvider`), `dev-signer.ts` (`devPrivateKeySigner`, the testnet fence), and `localPrivateKeySigner`, which lived in the old
`src/node/index.ts` and is now `local-key-signer.ts`. With them, the 39 files of `@capxul/protocol` they truly need (errors, evm
model and hex, Safe constants, validation) under `src/shared/protocol/` at their old relative paths, 2 small shared helpers
(`failure-mode.ts`, `window-like.ts`) and `src/shared/results.ts`, which keeps only the `CapxulResult` type of the old
`platform/results.ts`. About 3,300 lines in all; the only dependency is `viem`.

**Changed:** imports (`#x` and `@capxul/protocol/x` became relative `.ts` paths); `BrowserStorageShape` is defined in `dev-signer.ts`
(it was in the old auth cache). Some brought files are over the 250-line guideline (`factories.ts` 356, `signer.ts` 300): left as they
were.

**Left behind:** Openfort (browser, embedded, credentials, readiness, recovery, storage), the on-disk auth cache, and everything else
of the SDK. Reaching the signing files by their old imports pulled in 542 files (about 90,000 lines) through the `#access` and
`#platform` barrels; the runtime closure of the plain-key path alone is 17 files, because those barrels were only used for types.

**Tests:** the three signing test files that apply, 48 tests, written for Vitest and run here on `node:test` through
`src/testing/expect.ts`, a small `describe`/`it`/`expect` shim. One test lost its dependency on the Openfort SDK's
`PasskeyUserCancelledError`: it uses an object with the same `error` field instead. `safe4337-split-sign.test.ts` and the
Openfort tests were left behind.
