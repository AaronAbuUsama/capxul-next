// The one secret-material pattern family (2026-09-01 ruling: "failures carry
// evidence"). `@capxul/errors` is the dependency-free bottom primitive
// (ADR-0004), so the family lives here and every runtime consumer reaches it
// from here: `chain-cause.ts` wraps it as `boundedEvidence`, and
// `@capxul/wire/secret-material` re-exports it for the backend and the SDK.
//
// One copy stays by hand in
// `packages/aa-gateway/src/modules/gateway/internal/` (`credential-fields.ts`,
// `text-redaction.ts`). That container installs no workspace package, so the
// gateway cannot import this module. `redaction-parity.test.ts` compares the
// copy with this module's output over a corpus, so the two cannot drift.
//
// The family masks credential material only. Telemetry is not PII-redacted.
// An Ethereum address, a transaction hash, a UserOperation hash, a block hash,
// calldata, and revert data are evidence, so a `0x`-prefixed hex value of any
// length passes through this text scan. The field classifier still protects
// private-key fields with a `0x` value. Unlabelled bare 64-hex text matches a
// private-key shape and stays masked; declared public digests need source context.
//
// `redactSecrets` composes field, token, and embedded-URL protection.
// `containsSensitiveMaterial` uses that same projection for rejection, so the
// two faces cannot disagree about which credential families are protected.

const CREDENTIAL_FIELDS = new Set([
  "password",
  "passwd",
  "pwd",
  "pass",
  "passphrase",
  "currentpassword",
  "newpassword",
  "confirmpassword",
  "passwordconfirmation",
  "passwordhash",
  "hashedpassword",
  "pin",
  "privatekey",
  "walletprivatekey",
  "secretkey",
  "signingkey",
  "signingsecret",
  "seed",
  "seedphrase",
  "mnemonic",
  "recoveryphrase",
  "recovery",
  "recoverycode",
  "recoverycodes",
  "keyshare",
  "signingmaterial",
  "recoverymaterial",
  "privatekeybytes",
  "signingprivatekey",
  "encryptionkey",
  "decryptionkey",
  "authtoken",
  "apitoken",
  "bearertoken",
  "oauthtoken",
  "csrftoken",
  "clientassertion",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "sessiontoken",
  "session",
  "sessionkey",
  "sessionsecret",
  "authsessionid",
  "sessioncredential",
  "sessioncredentials",
  "sessioncookie",
  "auth",
  "authentication",
  "authorization",
  "proxyauthorization",
  "cookie",
  "cookies",
  "setcookie",
  "apikey",
  "xapikey",
  "xauthtoken",
  "clientsecret",
  "secret",
  "secrets",
  "credential",
  "credentials",
  "signature",
  "otp",
  "otpcode",
  "totpsecret",
  "onetimecode",
  "onetimepassword",
  "verificationcode",
  "authcode",
  "authorizationcode",
  "oauthcode",
  "codeverifier",
  "devicecode",
  "usercode",
  "continuitytoken",
  "refreshattemptid",
  "revocationtoken",
]);

/** Match credential fields by meaning, without hiding token addresses or replay IDs. */
export function isCredentialField(name: string, context?: "authentication" | "header"): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/gu, "");
  return (
    CREDENTIAL_FIELDS.has(normalized) ||
    // Qualified names retain their credential meaning. Diagnostic suffixes do not.
    /(?:password(?:hash)?|passwd|passphrase|privatekey|signingkey|secretkey|secretaccesskey|apikey|clientsecret|accesstoken|refreshtoken|sessiontoken)$/u.test(
      normalized,
    ) ||
    (context === "authentication" && (normalized === "code" || normalized === "sessionid")) ||
    (context === "header" &&
      /(?:token|secret|apikey|privatekey|signingkey|password|authorization|cookie|session)$/u.test(
        normalized,
      ))
  );
}
