import { parseAbi } from "viem";

export const PAYMENT = parseAbi([
  "event PaymentSent(bytes32 indexed paymentId, address indexed sender, address indexed recipient, address token, uint256 amount, uint16 kind, bytes32 documentHash)",
]);
export const TOKEN = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
export const COMPANY = parseAbi([
  "event CompanySafeMinted(address indexed safe, address indexed founderSafe, string company, bool deployed)",
  "event CapxulSafeClaimed(address indexed safe, address indexed signer, bool deployed)",
]);
export const HATS = parseAbi(["event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)"]);
export const INSTALLER = parseAbi(["event MoneyDeployed(address indexed safe, address indexed founderSafe, (uint256 boardTopHat,uint256 shareholdersTopHat,uint256 directorHat,uint256[] officerHats,address roles,address gate) deployment)"]);
export const ENTRY_POINT = parseAbi([
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
]);
