# protocol

Deploys and verifies the v4 contracts on a chain, the way a real chain gets them: Companies House (a Safe owned by
Directors, 2 of 3) is created, a Roles module is put on it with one claim role and one company role per tier, then every
contract in `packages/contracts/deploy/manifest.json` is created by Companies House through CreateCall, so an address
is a function of the house, the entry's salt and its compiled init code. Budgets is wired to Agreements.

This is the small version of the old `packages/tools` `companies-house apply` and `protocol deploy|verify`: no config
loader, no ceremony, no codegen, no impersonation. The Directors sign with real keys (`@capxul/sdk`'s
`localPrivateKeySigner`), and the batches are plain Safe transactions.

Re-running it deploys only what is missing. It writes nothing itself: `main.ts` writes the record it returns.

Needs a node whose state has the third-party contracts (`../../../contracts/state/pin.json`, or a fork).
