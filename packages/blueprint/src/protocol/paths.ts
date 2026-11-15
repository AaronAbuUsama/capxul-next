// Where a call goes: the paths of a door's parts, and the chain reads a world's door answers. Declarations only.

/**
 * Where a door's parts answer, under its base address: the platform's group, a world's group, and a world's chain
 * JSON-RPC. A world's door (`WorldView.door`) is that base address. Declared here once; Core serves these paths and
 * the SDK builds every address from them, so a caller that holds only a world's view finds its operations and chain.
 */
export const PLATFORM_PATH = "/platform";
export const WORLD_PATH = "/world";
export const CHAIN_PATH = "/chain";

/**
 * The JSON-RPC methods a world's door answers at `CHAIN_PATH`, and the only ones: it reads the chain and never
 * writes it. Every transaction of a world is sent by an operation, never by a caller of the door.
 */
export const CHAIN_READ_METHODS = [
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getTransactionReceipt",
  "eth_getLogs",
  "eth_call",
] as const;
