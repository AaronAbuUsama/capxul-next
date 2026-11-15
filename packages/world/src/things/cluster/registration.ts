// A world on the hub: what the hub keeps of it, and where. Nothing here touches the outside world, and nothing here
// imports another package: the hub's Worker bundles this file.
//
// A world is registered by the world's create, with the hub's admin token, before anything of it starts: its chain's
// Durable Object keeps the registration (and checks every call's token against it), and the hub's bucket keeps a
// ledger entry, so the hub can say which worlds it holds. Forgetting a world removes all three of its Durable Objects'
// state, its containers and every object of it in the bucket, the ledger entry last.
import * as Schema from "effect/Schema";

/** What the hub is told of a world when it is registered. `secret` is the second half of the world's door token. */
export const Registration = Schema.Struct({
  stage: Schema.String,
  secret: Schema.String,
  owner: Schema.String,
  expiresAt: Schema.String,
});
export type Registration = typeof Registration.Type;

/** A world's stage as the hub accepts it: the world package's `w-` names. */
export const STAGE_PATTERN = /^w-[a-z0-9][a-z0-9-]{0,40}$/;

/**
 * The world's door token is `<stage>.<secret>`: one path segment, so every caller reaches the world as it reached a
 * world's own door, at `<door>/<token>/rpc`, and the hub reads which world is meant from the token itself.
 */
export const tokenOf = (stage: string, secret: string): string => `${stage}.${secret}`;

/** The stage and the secret a door token names; none for a token of no world's shape. */
export const splitToken = (token: string): { readonly stage: string; readonly secret: string } | undefined => {
  const found = /^(w-[a-z0-9][a-z0-9-]{0,40})\.([0-9a-f]{32,64})$/.exec(token);
  const [stage, secret] = [found?.[1], found?.[2]];
  return stage === undefined || secret === undefined ? undefined : { stage, secret };
};

/** Where everything of one world lives in the hub's bucket. */
export const worldPrefix = (stage: string): string => `worlds/${stage}/`;
/** The chain's own saved state. */
export const chainKey = (stage: string): string => `${worldPrefix(stage)}anvil.hex`;
/** The chain's state a snapshot saved. */
export const snapshotKey = (stage: string, snapshot: string): string =>
  `${worldPrefix(stage)}snapshots/${snapshot}.hex`;
/** The hub's ledger of the worlds it holds: one object per world, removed last when the world is forgotten. */
export const LEDGER_PREFIX = "ledger/";
export const ledgerKey = (stage: string): string => `${LEDGER_PREFIX}${stage}`;
