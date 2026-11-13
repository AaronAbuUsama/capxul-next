export const lower = (s: string) => s.toLowerCase() as `0x${string}`;
export const hatHex = (id: bigint) => `0x${id.toString(16).padStart(64, "0")}`;

// The receipt ordinal survives re-inclusion in another block. The block-global index does not.
export async function identity(event: any, context: any) {
  const receipt = await context.client.getTransactionReceipt({ hash: event.transaction.hash });
  const ordinal = receipt.logs.findIndex((l: { logIndex: number }) => l.logIndex === event.log.logIndex);
  if (ordinal < 0) throw new Error("indexed log missing from its receipt");
  return {
    log_id: `${context.chain.id}:${lower(event.transaction.hash)}:${ordinal}`,
    chain_id: context.chain.id, block_number: event.block.number, block_hash: lower(event.block.hash),
    block_time: event.block.timestamp * 1000n, tx_hash: lower(event.transaction.hash),
    tx_log_ordinal: ordinal, log_index: event.log.logIndex,
  };
}

export function decoded(args: unknown): any {
  return JSON.parse(JSON.stringify(args, (_key, value) => typeof value === "bigint" ? value.toString()
    : typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value) ? value.toLowerCase() : value));
}
