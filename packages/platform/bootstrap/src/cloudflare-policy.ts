// What CI's Cloudflare token may do, as data: what worlds (packages/world) and the platform (packages/platform) create,
// and Alchemy's shared state store, which both use. Pure, so test/cloudflare-policy.test.ts reads it.
//
// Account-wide, because Cloudflare scopes these to an account, not to names:
// - Workers, their Durable Objects and Containers (with the container registry), R2 buckets and Hyperdrive
//   configurations: a world's chain, index, door and Core;
// - Cloudflare Tunnel: the platform's tunnel and its ingress;
// - Secrets Store, edit: Alchemy's state store keeps its own bearer token there and reads it back through a preview
//   Worker on every run; binding a secret to a Worker needs Edit, Read is refused ("Secrets store binding
//   authorization failed");
// - Account Settings, read only: Alchemy resolves the account.
// One zone only, the platform's (abuusama.dev, later capxul.com): its DNS records, and reading the zone. Cloudflare
// cannot limit a token to the names under `worlds.`; the stacks create records only there (src/names.ts).
// Not granted: API tokens (CI can neither mint nor widen a token), Access, Zero Trust, the zone's settings or
// certificates, billing, members.

import type * as Cloudflare from "@alchemy.run/cloudflare";

type Permission = Cloudflare.ApiToken.PermissionGroupName;

export const ACCOUNT_PERMISSIONS: ReadonlyArray<Permission> = [
  "Account Settings Read",
  "Workers Scripts Write",
  "Workers Containers Write",
  "Workers R2 Storage Write",
  "Workers KV Storage Write",
  "Hyperdrive Write",
  "Cloudflare Tunnel Write",
  "Secrets Store Write",
];

export const ZONE_PERMISSIONS: ReadonlyArray<Permission> = ["Zone Read", "DNS Write"];

/** The token's policies. An account-owned token names a zone nested under its account, as Cloudflare requires. */
export const tokenPolicies = (accountId: string, zoneId: string): Array<Cloudflare.ApiToken.Policy> => [
  {
    effect: "allow",
    permissionGroups: [...ACCOUNT_PERMISSIONS],
    resources: { [`com.cloudflare.api.account.${accountId}`]: "*" },
  },
  {
    effect: "allow",
    permissionGroups: [...ZONE_PERMISSIONS],
    resources: { [`com.cloudflare.api.account.${accountId}`]: { [`com.cloudflare.api.account.zone.${zoneId}`]: "*" } },
  },
];
