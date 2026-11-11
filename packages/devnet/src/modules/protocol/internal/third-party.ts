// The third-party contracts the protocol sits on, at the addresses test/fork/Addresses.sol pins on Base Sepolia.
// All have code in the seeded state (state/pin.json).

import type { ThirdParty } from "../types.ts";

export const THIRD_PARTY: ThirdParty = {
  createCall: "0x9b35Af71d77eaf8d7e40252370304687390A1A52",
  multiSend: "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526",
  multiSendCallOnly: "0x9641d764fc13c8B624c04430C7356C1C7C8102e2",
  safeProxyFactory: "0x14F2982D601c9458F93bd70B218933A6f8165e7b",
  safeSingleton: "0xEdd160fEBBD92E350D4D398fb636302fccd67C7e",
  fallbackHandler: "0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4",
  safe4337Module: "0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226",
  safeModuleSetup: "0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47",
  moduleProxyFactory: "0x000000000000aDdB49795b0f9bA5BC298cDda236",
  rolesMastercopy: "0xF2964CE6161ce0e75964Fe7927cE114cb0B283D5",
  hats: "0x3bc1A0Ad72417f2d411118085256fC53CBdDd137",
};
