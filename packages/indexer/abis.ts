import { parseAbi, type Abi } from "viem";
import exported from "../contracts/abi/abi.json" with { type: "json" };

const v4 = (exported as unknown as { contracts: Record<string, { abi: Abi }> }).contracts;
export const BUDGETS = v4.Budgets!.abi;
export const AGREEMENTS = v4.Agreements!.abi;
export const AGENT_OWNER = v4.AgentOwner!.abi;

export const PAYMENT = parseAbi([
  "event PaymentSent(bytes32 indexed paymentId, address indexed sender, address indexed recipient, address token, uint256 amount, uint16 kind, bytes32 documentHash)",
]);
export const TOKEN = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
export const COMPANY = parseAbi([
  "event CompanySafeMinted(address indexed safe, address indexed founderSafe, string company, bool deployed)",
  "event CapxulSafeClaimed(address indexed safe, address indexed signer, bool deployed)",
]);
export const HATS = parseAbi([
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
  "event HatCreated(uint256 id, string details, uint32 maxSupply, address eligibility, address toggle, bool mutable_, string imageURI)",
  "event WearerStandingChanged(uint256 hatId, address wearer, bool wearerStanding)",
  "event HatStatusChanged(uint256 hatId, bool newStatus)",
  "event HatDetailsChanged(uint256 hatId, string newDetails)",
  "event HatEligibilityChanged(uint256 hatId, address newEligibility)",
  "event HatToggleChanged(uint256 hatId, address newToggle)",
  "event HatMutabilityChanged(uint256 hatId)",
  "event HatMaxSupplyChanged(uint256 hatId, uint32 newMaxSupply)",
  "event HatImageURIChanged(uint256 hatId, string newImageURI)",
  "function viewHat(uint256 hatId) view returns (string details,uint32 maxSupply,uint32 supply,address eligibility,address toggle,string imageURI,uint16 lastHatId,bool mutable_,bool active)",
  "function balanceOf(address wearer,uint256 hatId) view returns (uint256)",
  "function isInGoodStanding(address wearer,uint256 hatId) view returns (bool)",
  "function isWearerOfHat(address wearer,uint256 hatId) view returns (bool)",
]);
export const SAFE = parseAbi([
  "event AddedOwner(address indexed owner)", "event RemovedOwner(address indexed owner)",
  "event ChangedThreshold(uint256 threshold)", "event EnabledModule(address indexed module)",
  "event DisabledModule(address indexed module)", "event ChangedGuard(address indexed guard)",
  "event ApproveHash(bytes32 indexed approvedHash,address indexed owner)",
  "event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)",
  "event ExecutionFailure(bytes32 indexed txHash,uint256 payment)",
  "event ExecutionFromModuleSuccess(address indexed module)", "event ExecutionFromModuleFailure(address indexed module)",
  "event SafeMultiSigTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures,bytes additionalInfo)",
  "function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function getModulesPaginated(address start,uint256 pageSize) view returns (address[] array,address next)",
  "function getStorageAt(uint256 offset,uint256 length) view returns (bytes)",
]);
export const INSTALLER = parseAbi(["event MoneyDeployed(address indexed safe, address indexed founderSafe, (uint256 boardTopHat,uint256 shareholdersTopHat,uint256 directorHat,uint256[] officerHats,address roles,address gate) deployment)"]);
export const ENTRY_POINT = parseAbi([
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
]);
