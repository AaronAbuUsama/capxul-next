// The door of the access concept's signing: what other code imports (system.layout, sys:imports).

export type { CapxulSigner, CapxulDigestSigner, SignerStatus, SignerStatusStore } from "./signing/signer.ts";
export { injectedWalletSigner, signerFailure, isEcdsaSignatureHex, UNOBSERVABLE_SIGNER_STATUS } from "./signing/signer.ts";
export type { AccountProvider, AccountProviderSource, AccountRequirement } from "./signing/account-providers.ts";
export { localPrivateKeyAccountProvider, eip1193AccountProvider } from "./signing/account-providers.ts";
export { devPrivateKeySigner, deriveDevPrivateKey, assertDevKeySignerIsTestnetOnly } from "./signing/dev-signer.ts";
export { localPrivateKeySigner } from "./signing/local-key-signer.ts";
export { createAccessClient, AccessClientError, type AccessSignIn, type PersonSignIn, type AgentSignIn, type AccessSession } from "./client.ts";
