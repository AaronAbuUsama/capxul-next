import { ponder } from "ponder:registry";
import { pings } from "ponder:schema";

ponder.on("Pinger:Ping", async ({ event, context }) => {
  await context.db.insert(pings).values({
    id: event.id,
    block_number: event.block.number,
    block_hash: event.block.hash,
    tx_hash: event.transaction.hash,
  });
});
