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
  why: "thin-line.bundler asks for Alto and a mock paymaster, not a staging policy replica. The existing MockPaymaster and Safe operation builder already agree on empty sponsor data; the upstream signed server does not. The host owns process lifetime and receipt-first preparation, while a typed supplied-process configuration keeps signing and operator credentials out of inherited environment. Fresh-creation setup only tops up deficits and may reuse a verified sponsor on a setup retry; up and restore recover native chain state without preparation. A send occurs once and uncertain answers are resolved by the independently computed hash; invalid hashes or receipt shapes fail closed. Mined operations, including unsuccessful ones, return their carrying transaction to the existing payment-result decoder, which reports REVERTED with both hashes. Pre-inclusion validation failures remain provider errors, not mined payment results. This component proof does not score the complete dynamic same-run journey, nor ERC-7677 sponsorship policy conformance.",
  source: "thin-line.bundler; integration:bundler; packages/contracts/test/mocks/MockPaymaster.sol; supplied-process runtime contract, 12 November 2026; Xelmar-tech/infrastructure integration/factory 0d2be303ed3df643aa6ad08434149fff8cea72e4 AA setup inspected as reference only",
  affects: [component_bundler_paymaster, component_devnet, environment_devnet],
});

export const decision_devnet_create_sponsor = defineDecision({
  id: "devnet.create-sponsor",
  title: "Fresh local worlds persist their native sponsor before opening ingress",
  question: "Where does the selected supervisor install the supplied canary bundler without redeploying on recovery?",
  options: [{ label: "fresh-create-only", text: "New local configurations reserve eleven distinct loopback ports, including a private Alto port separate from its fenced public ingress. Fresh creation alone prepares dedicated executor/utility funding and the MockPaymaster EntryPoint deposit after Anvil starts. Persist the sponsor address in deployment.json and the supplied absolute foreground executable, private URL and isolated environment in the mode-0600 world config before starting the bundler. Save copies the native Anvil state and deployment unchanged; up and restore never call preparation or send funding/deployment transactions. A clone reconstructs its process slot from the saved sponsor and dedicated canary keys with its own ports, not the source URL. Existing worlds without a supplied slot remain inspectable/stoppable but cannot claim supplier preparation." }],
  chosen: "fresh-create-only",
  why: "The supplied Alto component is now reviewed, but the supervisor's old fresh-create path left its slot absent. Installing the real local mock is required to exercise supplier ingress; it does not establish signed sponsorship conformance or a full same-run acceptance. Native chain recovery, rather than deployment replay, must preserve the sponsor's address, deposit and account nonces.",
  source: "devnet.canary-alto; integrator fresh-create wiring assignment, 12 November 2026",
  affects: [component_bundler_paymaster, component_devnet, environment_devnet],
});
