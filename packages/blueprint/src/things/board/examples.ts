// Example data the Board's and the Directors' verbs share.
import * as Str from "effect/String";
import { exampleAddress as address } from "../world/examples.ts";

/**
 * @internal The founder's approval of a Board change, in the examples.
 */
export const founderApproval = (id: string) => ({
  id,
  signer: "dana",
  signerAddress: address(1),
  digest: `0x${Str.repeat(32)("cd")}`,
  expiresAt: "2026-11-14T09:00:00Z",
});
