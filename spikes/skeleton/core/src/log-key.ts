// The identity of one indexed log (decision indexing.log-identity): chain id, transaction hash and the log's ordinal in
// its transaction's receipt. A payment re-mined in a new block after a reorg keeps its transaction hash and its place in
// the receipt, so it keeps its key; the block hash and the block-global log index both change, so keying by them would
// enqueue it a second time and post it twice to a site.
export type ReceiptLog = { readonly logIndex: number | null };

export function logKey(chainId: number, txHash: string, receiptLogs: readonly ReceiptLog[], logIndex: number): string {
  const ordinal = receiptLogs.findIndex((r) => r.logIndex === logIndex);
  if (ordinal < 0) throw new Error(`log ${logIndex} is not in the receipt of ${txHash}`);
  return `${chainId}:${txHash.toLowerCase()}:${ordinal}`;
}
