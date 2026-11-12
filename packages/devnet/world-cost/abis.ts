// The ABIs this app indexes: the v4 contracts from the committed ABI export (packages/contracts/abi/abi.json, the
// code's own truth), and the third-party Safe, Hats and ERC-20 events the blueprint's indexing records name.
import { parseAbi, type Abi } from "viem";

import exported from "../../contracts/abi/abi.json" with { type: "json" };

const v4 = (exported as unknown as { contracts: Record<string, { abi: Abi }> }).contracts;
const eventsOf = (name: string): Abi => (v4[name]?.abi ?? []).filter((x) => x.type === "event");

export const V4 = {
  CompaniesHouseClaimer: eventsOf("CompaniesHouseClaimer"),
  CompanySafeMinter: eventsOf("CompanySafeMinter"),
  Installer: eventsOf("Installer"),
  Budgets: eventsOf("Budgets"),
  Agreements: eventsOf("Agreements"),
  Payments: eventsOf("Payments"),
  EscrowFactory: eventsOf("EscrowFactory"),
  Escrow: eventsOf("Escrow"),
  AgentOwner: eventsOf("AgentOwner"),
  Captable: eventsOf("Captable"),
  Governor: eventsOf("Governor"),
  Options: eventsOf("Options"),
  Rounds: eventsOf("Rounds"),
  Exits: eventsOf("Exits"),
} as const;

/** Safe 1.4.1's owner, threshold, module, guard and execution events. */
export const SAFE = parseAbi([
  "event AddedOwner(address indexed owner)",
  "event RemovedOwner(address indexed owner)",
  "event ChangedThreshold(uint256 threshold)",
  "event EnabledModule(address indexed module)",
  "event DisabledModule(address indexed module)",
  "event ChangedGuard(address indexed guard)",
  "event ApproveHash(bytes32 indexed approvedHash, address indexed owner)",
  "event ExecutionSuccess(bytes32 indexed txHash, uint256 payment)",
  "event ExecutionFailure(bytes32 indexed txHash, uint256 payment)",
  "event ExecutionFromModuleSuccess(address indexed module)",
  "event ExecutionFromModuleFailure(address indexed module)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
]);

export const HATS = parseAbi([
  "event HatCreated(uint256 id, string details, uint32 maxSupply, address eligibility, address toggle, bool mutable_, string imageURI)",
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 amount)",
  "event WearerStandingChanged(uint256 hatId, address wearer, bool wearerStanding)",
  "event HatStatusChanged(uint256 hatId, bool newStatus)",
]);

export const ERC20 = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

/** The factory events whose child addresses are Capxul's Safes and clones. */
export const FACTORY = {
  companySafe: parseAbi(["event CompanySafeMinted(address indexed safe, address indexed founderSafe, string company, bool deployed)"])[0],
  personSafe: parseAbi(["event CapxulSafeClaimed(address indexed safe, address indexed signer, bool deployed)"])[0],
  agentSafe: parseAbi(["event AgentCreated(address indexed safe, address indexed owner, address indexed signer)"])[0],
  escrow: parseAbi(["event EscrowDeployed(address indexed escrow, address indexed ownerSafe, address indexed payeeSafe, bytes32 paymentId, bytes32 salt)"])[0],
  equity: (V4.Installer as readonly { type: string; name?: string }[]).find((x) => x.name === "EquityDeployed") as never,
};
