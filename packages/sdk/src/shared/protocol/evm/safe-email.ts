// The Safe salt's email rule, apart from the Safe derivation, so a reader that
// only normalizes a mailbox (the email binding) loads no Safe or viem code.

/**
 * Normalize an email for use as a Capxul Safe salt input.
 *
 * Trims surrounding whitespace and lowercases the address so that
 * `"  User+Demo@Example.COM  "` and `"user+demo@example.com"` derive
 * the same `safeAddress`. This is the canonical normalization rule —
 * any future change here would shift every existing user's Safe
 * address, so the rule is pinned by the fixture matrix in
 * `packages/config/tests/safe-address-conformance.test.ts`.
 *
 * @param email - The raw email address to normalize
 * @returns The trimmed, lowercased email
 */
export function normalizeSafeSaltEmail(email: string): string {
  return email.trim().toLowerCase();
}
