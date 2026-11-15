// What a call carries besides its payload: its credential and the person it acts as, and how the SDK and the
// journeys' `Capxul` make one call. Declarations only. A call carries no idempotency key: the old door's `callId`
// was never tried and no promise needs one; the documents journey will decide whether retries need it.
import type { OperatorRole, PersonId } from "../common/values.ts";

/**
 * The header that carries a call's credential, as `Bearer <token>`: the world's door token for a call through a
 * world's door, or the operator's token for a call to the platform. The sign-in middlewares read it. The SDK sends
 * it on every call; nothing logs it.
 */
export const CREDENTIAL_HEADER = "authorization";

/**
 * The header naming the person a call acts as, inside one world. In private and shared worlds it is honoured only
 * with a credential that acts as the world's owner (below), and only for a person of the world's cast. Without it,
 * such a call acts as the world's owner. Real worlds use real sign-in, which is not designed yet (roadmap phase 4).
 *
 * Two credentials act as a world's owner at its door: the world's door token, and the token of the operator who owns
 * the world. The second is how a caller reaches a world it has just made or restored, whose door token it was never
 * given: a token in `world.create`'s answer would be written into every run record, and the operator is already who
 * the caller is. Any other operator's token is not signed in at that door.
 */
export const PERSON_HEADER = "capxul-person";

/**
 * How one call is made, by the SDK and by the scenarios' `Capxul`. Every field may be left out.
 */
export interface CallOptions {
  /** The person of the world's cast the call acts as (`PERSON_HEADER`). Left out, it acts as the world's owner. */
  readonly as?: typeof PersonId.Type;
  /**
   * The operator whose credential signs the call: the platform's operations, and a call `at` another world's door.
   * Left out, `first`. A call through the client's own world's door uses that world's door token instead.
   */
  readonly operator?: typeof OperatorRole.Type;
  /**
   * Another world's door, as `world.create`, `world.show` or `world.snapshot.restore` answered it: the call (an
   * operation of a world, or a chain read) goes there, signed in with the operator's credential. Left out, it goes
   * to the door of the world the client was made for. Platform operations take no `at`.
   */
  readonly at?: string;
}
