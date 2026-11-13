// What the bundler and the proof agree on: the EntryPoint and the bundler's two keys.
// The keys are anvil's public test accounts 9 and 10, as the other line used (packages/devnet on main). Accounts 0 to
// 9 are in the seed with no code, so none carries the EIP-7702 delegation they have on Base Sepolia; 10 is not in the
// seed at all. They are funded by the proof with anvil_setBalance. A real world would make its own keys.
export const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as const;

export const BUNDLER_KEYS = {
  executor: "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6",
  utility: "0xf214f2b2cd398c806f84e317254e0f0b801d0643303237d97a22a48e01628897",
} as const;
