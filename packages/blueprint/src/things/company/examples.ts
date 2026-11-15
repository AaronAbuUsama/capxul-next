// Example data the company's verbs share with others and with the starting points.
import * as Str from "effect/String";
import { exampleAddress as address } from "../world/examples.ts";
import { Founded } from "./values.ts";

/**
 * @internal An approval of the examples, shared by the verbs that ask for one.
 */
export const approval = (id: string, signer: string, n: number) => ({
  id,
  signer,
  signerAddress: address(n),
  digest: `0x${Str.repeat(32)("ab")}`,
  expiresAt: "2026-11-14T09:00:00Z",
});

/** The company `northwind`, as `org.create`'s first example founds it. */
export const northwindFounded = Founded.make({
  org: "org_northwind1",
  handle: "northwind",
  profile: { name: "Northwind Trading", country: "NL", bio: null, size: null },
  safe: address(21),
  founder: "dana",
  founderSafe: address(11),
  board: { directors: ["dana", "eli"], threshold: 2 },
  members: ["sam", "pat"],
  capital: { asset: "USDC", amount: "1000" },
  approvals: [approval("apr_setup1", "dana", 1), approval("apr_setup2", "eli", 2)],
});
