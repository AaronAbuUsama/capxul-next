// The third-party contracts the seed's deployment calls, at the addresses `test/fork/Addresses.sol` pins on Base
// Sepolia; each has code in `state/pin.genesis.json`.
import type { Hex } from "viem";

export const THIRD_PARTY = {
  createCall: "0x9b35Af71d77eaf8d7e40252370304687390A1A52",
  multiSend: "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526",
  safeProxyFactory: "0x14F2982D601c9458F93bd70B218933A6f8165e7b",
  safeSingleton: "0xEdd160fEBBD92E350D4D398fb636302fccd67C7e",
  fallbackHandler: "0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4",
  moduleProxyFactory: "0x000000000000aDdB49795b0f9bA5BC298cDda236",
  rolesMastercopy: "0xF2964CE6161ce0e75964Fe7927cE114cb0B283D5",
} as const satisfies Record<string, Hex>;
