import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import { component_bundler_paymaster, component_devnet, environment_devnet } from "../shared/foundation.ts";

export const decision_devnet_canary_alto = defineDecision({
  id: "devnet.canary-alto",
  title: "The canary supplies foreground Alto and an on-chain accept-all sponsor",
  question: "How does the world run a genuine sponsored Safe UserOperation without confusing the devnet mock with staging's signed sponsor?",
  options: [
    { label: "on-chain-mock", text: "Pin Alto 0.0.21, bind to a world-assigned loopback port, pass explicit child environment and use funded dedicated executor/utility accounts. Deploy or reuse the devnet-only MockPaymaster and top up its EntryPoint v0.7 deposit. Probe eth_supportedEntryPoints before use. Safe operations carry empty paymasterData, and travel through eth_sendUserOperation without a direct handleOps fallback." },
    { label: "signed-server", text: "Add the upstream signed ERC-7677 sponsor and change operation construction to request and sign its sponsorship data." },
  ],
  chosen: "on-chain-mock",
  why: "thin-line.bundler asks for Alto and a mock paymaster, not a staging policy replica. The existing MockPaymaster and Safe operation builder already agree on empty sponsor data; the upstream signed server does not. The host owns process lifetime and receipt-first preparation, while a typed supplied-process configuration keeps signing and operator credentials out of inherited environment. Account setup only tops up deficits and can reuse a verified sponsor after a world restart. A send occurs once and uncertain answers are resolved by the independently computed hash; invalid hashes or receipt shapes fail closed. This component proof does not score the complete dynamic same-run journey, nor ERC-7677 sponsorship policy conformance.",
  source: "thin-line.bundler; integration:bundler; packages/contracts/test/mocks/MockPaymaster.sol; supplied-process runtime contract, 12 November 2026; Xelmar-tech/infrastructure integration/factory 0d2be303ed3df643aa6ad08434149fff8cea72e4 AA setup inspected as reference only",
  affects: [component_bundler_paymaster, component_devnet, environment_devnet],
});
