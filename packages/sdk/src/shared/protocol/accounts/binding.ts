import { Errors } from "../errors/factories.ts";
import { normalizeSafeSaltEmail } from "../evm/safe-email.ts";

/** Openfort `thirdPartyUserId` namespace for email bindings (epic #331 / #332). */
export const CAPXUL_BINDING_EMAIL_NAMESPACE = "capxul:binding:email:v1";

const BINDING_EMAIL_PREFIX = `${CAPXUL_BINDING_EMAIL_NAMESPACE}:`;

/**
 * Normalize a raw email for binding id + Safe salt derivation.
 * Delegates to {@link normalizeSafeSaltEmail} so binding resolution and
 * `deriveCapxulSafeAddress` never drift apart.
 */
export function normalizeBindingEmail(email: string): string {
  return normalizeSafeSaltEmail(email);
}

/**
 * Production Openfort player key for authenticated flows (#338).
 * Matches the BetterAuth ↔ Openfort browser bridge (`user._id`).
 * Hermetic smoke scripts may still pregen by normalized email directly.
 */
export function openfortThirdPartyUserIdForAuth(authUserId: string): string {
  return authUserId;
}

/**
 * Format the canonical Capxul email binding id (Convex + wire lookup key).
 *
 * `capxul:binding:email:v1:{normalizedEmail}` — pinned by the #332 conformance
 * matrix in `tests/binding.test.ts`. Openfort `thirdPartyUserId` for live SDK
 * flows uses {@link openfortThirdPartyUserIdForAuth}; unauthenticated smoke
 * scripts may still pass normalized email.
 */
export function formatEmailBindingId(email: string): string {
  return `${BINDING_EMAIL_PREFIX}${normalizeBindingEmail(email)}`;
}

/**
 * Parse a binding id back to the normalized email. Throws
 * {@link CapxulError} `INVALID_INPUT` when the id is not an email-binding
 * id for the v1 namespace.
 */
export function parseEmailBindingId(bindingId: string): string {
  if (!bindingId.startsWith(BINDING_EMAIL_PREFIX)) {
    throw Errors.invalidInput("bindingId", `must start with "${BINDING_EMAIL_PREFIX}"`);
  }
  const suffix = bindingId.slice(BINDING_EMAIL_PREFIX.length);
  if (suffix.length === 0) {
    throw Errors.invalidInput("bindingId", "must include a normalized email suffix");
  }
  if (normalizeBindingEmail(suffix) !== suffix) {
    throw Errors.invalidInput("bindingId", "email suffix must be canonical (normalized)");
  }
  return suffix;
}

/** True when `bindingId` is a v1 email binding id with a canonical suffix. */
export function isEmailBindingId(bindingId: string): boolean {
  if (!bindingId.startsWith(BINDING_EMAIL_PREFIX)) {
    return false;
  }
  const suffix = bindingId.slice(BINDING_EMAIL_PREFIX.length);
  return suffix.length > 0 && normalizeBindingEmail(suffix) === suffix;
}
