# @capxul/sdk (Core SDK, started)

The key signing path was brought from `packages/sdk/src/signing` of `Xelmar-tech/infrastructure` at
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

**Site provisioning:** `createSitesClient({coreUrl,account}).provision({org})` signs a short-lived public request to Core. The account supplies `address` and `signMessage`, as a viem local account does. It does not receive or send bench passwords, the site-service token or Core's HMAC secret. This is the narrow post-chain-birth stage, not full company onboarding. See `packages/site-service/README.md` for registration, retry and delivery boundaries. The public CLI (`pnpm capxul org site provision --org <slug> --confirm --json`) calls this same method.

**Traces:** `createAccessClient`, `createSitesClient` and `createDocumentClient` take an optional `traceparent` (W3C, version 00) and send it on every request, so Core's rpc spans and the events they enqueue join the caller's trace; a malformed one is refused `INVALID_INPUT` before any request. `newTraceparent()`, `isTraceparent()` and `traceIdOf()` come from `src/shared/trace.ts`. The CLI makes one trace per command, or uses `CAPXUL_TRACEPARENT` when a harness names it.

**Public Access sessions:** `createAccessClient({coreUrl})` exports typed `sendCode`, `verifyCode`, `challenge`, `withKey`, `current(bearer)` and `revoke(bearer)` over the actual `/access/` HTTP routes. `verifyCode` returns `PersonSignIn`; `withKey` returns `AgentSignIn`; both include the one-time bearer, principal ID, Safe and ISO expiry. `current` returns `AccessSession`. The client uses no cookies, operator HMAC, directory identity or automatic redirects; malformed identity responses fail closed. `AccessClientError` exposes safe `code`, optional `triesLeft` and optional `retryAfterMs`, never a provider body.

This is the low-level public transport, not the browser wallet-recovery flow, automatic key-session renewal, actor factory or session store. The host stores actual returned tokens privately. For a person, call `sendCode`, obtain the delivered code from the real mailbox/devnet Mail sink, then `verifyCode` and `current`. For an agent, call `challenge({safe})`, sign its exact string locally with EIP-191, then `withKey({safe,challenge,signature,client})` and `current`. A fresh post-restore sign-in repeats those public calls against the restored world and obtains a new token; an old token's survival is not fresh proof. Only real organization/hat/agent operations establish authority; assigning a role label to a session never does. Runtime owns receipt-first setup and private run/world/epoch-bound actor persistence.
