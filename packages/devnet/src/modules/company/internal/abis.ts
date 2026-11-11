import { parseAbi } from "viem";

export const CLAIMER = parseAbi([
  "function claim(string namespace, string email, address signer) returns (address safe)",
  "function safeAddressFor(address owner, string namespace, string email) pure returns (address)",
]);

export const MINTER = parseAbi([
  "function mint(string namespace, string company, address founderSafe) returns (address safe)",
  "function companySafeAddressFor(address owner, string namespace, string company, address founderSafe) pure returns (address)",
]);

export const HATS = parseAbi([
  "function mintHat(uint256 hatId, address wearer) returns (bool success)",
  "function isWearerOfHat(address user, uint256 hatId) view returns (bool)",
  "function setHatWearerStatus(uint256 hatId, address wearer, bool eligible, bool standing) returns (bool updated)",
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 amount)",
]);

export const BUDGETS = parseAbi([
  "function createChildBudget(uint256 parent, uint128 amount, uint256 hat) returns (uint256 id)",
  "function setAmount(uint256 id, uint128 amount)",
  "function spend(uint256 id, address recipient, uint128 amount, uint16 kind, bytes32 documentHash, bytes32 jobNonce) returns (bytes32 paymentId)",
  "function budgetCount() view returns (uint256)",
  "function leftOf(uint256 id) view returns (uint128)",
  "function configs(address safe) view returns (address roles, bytes32 payoutRoleKey)",
  "function authorised(uint256 id, address who) view returns (bool)",
  "event Spent(address indexed safe, uint256 indexed id, address indexed recipient, uint128 amount, uint16 kind, bytes32 documentHash, bytes32 paymentId)",
  "error NotAuthorised(uint256 id, address who)",
  "error OverBudget(uint256 id, uint128 left, uint128 requested)",
]);

export const PAYMENTS = parseAbi([
  "function paid(bytes32 id) view returns (bool)",
  "event PaymentSent(bytes32 indexed paymentId, address indexed sender, address indexed recipient, address token, uint256 amount, uint16 kind, bytes32 documentHash)",
]);

export const AGENT_OWNER = parseAbi([
  "function create(address signer, address owner) returns (address safe)",
  "function freeze(address safe)",
  "function safeAddressFor(address signer, address owner) view returns (address)",
  "function agentOf(address safe) view returns ((address owner, address signer, bool frozen, bool removed))",
  "error AgentSelfCall(address safe, address to, uint8 operation)",
]);

export const ERC20 = parseAbi(["function mint(address to, uint256 amount)", "function balanceOf(address who) view returns (uint256)"]);

