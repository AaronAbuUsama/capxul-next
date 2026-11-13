// org.member.grant, claim 5: the proposal mints the officer hat to the member's Safe, and takes one more seat first
// when every seat is worn. The executed transaction's logs from the world's Hats are exactly the mint's
// TransferSingle, preceded by a HatMaxSupplyChanged to supply + 1 when, at the block before, every seat was worn.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { scenario } from "../scenario.ts";
import { same } from "../support/expect.ts";
import { isAddress, logsOf } from "../support/chain.ts";
import { grantSigned } from "../support/grants.ts";
import { mintedToSam } from "../support/hats.ts";
import { northwind } from "../support/world.ts";

export const orgMemberGrant5 = scenario(
  { operation: "org.member.grant", claim: 5 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const { world, org } = yield* northwind;
    const { sent } = yield* grantSigned(org, "sam", "manage-books");
    const minted = yield* mintedToSam(world, sent.transaction);
    const before = yield* capxul.chain.hat({
      hats: world.contracts.hats,
      hat: minted.hat,
      block: minted.sent.block - 1,
    });
    const full = before.supply >= before.maxSupply;
    const fromHats = Arr.filter(minted.sent.logs, (log) => isAddress(log.address, world.contracts.hats));
    yield* same(
      `the Hats logs of the grant's transaction (every seat worn before it: ${full})`,
      Arr.map(fromHats, (log) => log._tag),
      full ? ["HatMaxSupplyChanged", "TransferSingle"] : ["TransferSingle"],
    );
    for (const change of logsOf(fromHats, "HatMaxSupplyChanged"))
      yield* same(
        "the seat taken first",
        { hat: change.hatId, newMaxSupply: change.newMaxSupply },
        { hat: minted.hat, newMaxSupply: before.supply + 1 },
      );
  }),
);
