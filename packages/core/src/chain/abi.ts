// The contract functions Core's chain operations call and the logs they read, as viem's parsed ABIs. viem is used as a
// pure codec (decisions.md, 34): it encodes and decodes, and every byte reaches the chain through `WorldChain`.
import { parseAbi } from "viem";

export const ROLES = parseAbi([
  "function execTransactionWithRole(address to, uint256 value, bytes data, uint8 operation, bytes32 roleKey, bool shouldRevert) returns (bool)",
]);

export const MINTER = parseAbi([
  "function mint(string namespace, string company, address founderSafe) returns (address)",
  "function companySafeAddressFor(address owner, string namespace, string company, address founderSafe) pure returns (address)",
]);

export const ERC20 = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address holder) view returns (uint256)",
]);

export const SAFE = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
  "function setup(address[] owners, uint256 threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
]);

export const SAFE_MODULE_SETUP = parseAbi(["function enableModules(address[] modules)"]);

export const SAFE_PROXY_FACTORY = parseAbi([
  "function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address)",
]);

export const MULTI_SEND = parseAbi(["function multiSend(bytes transactions)"]);

export const INSTALLER = parseAbi([
  "struct ThresholdConfig { uint8 thresholdType; uint120 min; uint120 target; }",
  "struct Officer { string details; uint32 maxSupply; }",
  "struct MoneyDeploy { address safe; address founderSafe; address[] coDirectors; ThresholdConfig threshold; Officer[] officers; bytes32 salt; }",
  "struct MoneyDeployment { uint256 boardTopHat; uint256 shareholdersTopHat; uint256 directorHat; uint256[] officerHats; address roles; address gate; }",
  "struct Token { address token; uint128 ceiling; uint8 budgetPeriod; uint128 topAmount; uint256 topHat; }",
  "struct MoneyInstall { address safe; address founderSafe; address[] coDirectors; MoneyDeployment deployment; Token[] tokens; }",
  "struct Call { address to; uint256 value; bytes data; }",
  "function deployMoney(MoneyDeploy p) returns (MoneyDeployment d)",
  "function buildMoney(MoneyInstall p) view returns (Call[] calls)",
  "event MoneyDeployed(address indexed safe, address indexed founderSafe, MoneyDeployment deployment)",
]);

export const HATS = parseAbi([
  "function createHat(uint256 admin, string details, uint32 maxSupply, address eligibility, address toggle, bool mutable_, string imageURI) returns (uint256 newHatId)",
  "function mintHat(uint256 hatId, address wearer) returns (bool)",
  "function changeHatMaxSupply(uint256 hatId, uint32 newMaxSupply)",
  "function isWearerOfHat(address user, uint256 hatId) view returns (bool)",
  "function viewHat(uint256 hatId) view returns (string details, uint32 maxSupply, uint32 supply, address eligibility, address toggle, string imageURI, uint16 lastHatId, bool mutable_, bool active)",
  "function buildHatId(uint256 admin, uint16 newHat) pure returns (uint256 id)",
]);

/** The company's Signer Gate (Hats Signer Gate v2): what the wearer of its owner hat, the Shareholders' top hat, calls. */
export const GATE = parseAbi([
  "struct ThresholdConfig { uint8 thresholdType; uint120 min; uint120 target; }",
  "function claimSignerFor(uint256 hatId, address signer)",
  "function setThresholdConfig(ThresholdConfig thresholdConfig)",
]);

const PACKED_USER_OPERATION =
  "(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)";

export const SAFE_4337_MODULE = parseAbi([
  "function executeUserOp(address to, uint256 value, bytes data, uint8 operation)",
  `function getOperationHash(${PACKED_USER_OPERATION} userOp) view returns (bytes32)`,
]);

export const ENTRY_POINT = parseAbi([
  "function getNonce(address sender, uint192 key) view returns (uint256)",
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
  "event UserOperationRevertReason(bytes32 indexed userOpHash, address indexed sender, uint256 nonce, bytes revertReason)",
]);

export const BUDGETS = parseAbi([
  "struct Budget { address safe; uint256 parent; uint256 hat; address token; uint8 period; uint8 depth; bool closed; uint128 amount; uint128 childrenAmount; uint128 ownSpent; uint128 ownCommitted; uint128 spent; uint128 committed; uint64 periodIndex; }",
  "function createChildBudget(uint256 parent, uint128 amount, uint256 hat) returns (uint256 id)",
  "function budgetOf(uint256 id) view returns (Budget b)",
  "function leftOf(uint256 id) view returns (uint128)",
  "function childrenOf(uint256 id) view returns (uint256[])",
  "event BudgetCreated(address indexed safe, uint256 indexed id, uint256 indexed parent, address token, uint8 period, uint128 amount, uint256 hat)",
]);
