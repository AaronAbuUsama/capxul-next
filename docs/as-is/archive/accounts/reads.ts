// The as-is book of the old accounts concept: the reads area (packages/backend/src/accounts/reads/).
//
// The old `reads/` folder registers no operation: nothing under packages/backend/convex/accounts/
// exports from it. It holds the shared reads every area and other concepts use:
//   identity.ts, signup.ts, targets.ts, workspaces.ts, ledger.ts, proofs.ts
//     in-transaction door functions, booked as procedures in ./procedures.ts
//     (accounts.require-payment-account-in-tx, accounts.read-workspace-setup-signer-in-tx, ...);
//   safes.ts
//     the Safe row and Account helpers the areas share (`findSafe`, `requireSafe`, `reread`,
//     `findAccount`) and the action-side wrappers that run an internal operation
//     (`loadSafe` runs accounts.safes.readSafe, `readBinding` runs accounts.balances.readBinding),
//     booked on the operations that use them.
// So this area file defines no record. It exists so every area folder of the old concept has its
// file, and says where its functions are booked.

export {};
