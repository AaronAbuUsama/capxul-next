// Pure v4 CREATE2 addresses shared by access, parties and organizations; no directory or RPC.
import { concat, encodeAbiParameters, encodeFunctionData, encodePacked, getContractAddress, keccak256, parseAbi, stringToHex, type Address, type Hex } from "viem";

export type PersonalSafeConfig = { companiesHouse: Address; namespace: string };
const factory: Address = "0x14F2982D601c9458F93bd70B218933A6f8165e7b";
const singleton: Address = "0xEdd160fEBBD92E350D4D398fb636302fccd67C7e";
const module: Address = "0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226";
const setup: Address = "0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47";
const multi: Address = "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526";
const zero: Address = "0x0000000000000000000000000000000000000000";
// Safe v1.5.0 proxy creation code, identical to CompaniesHouseClaimer/CompanySafeMinter.
const proxy: Hex = "0x608060405234801561001057600080fd5b506040516101b63803806101b68339818101604052602081101561003357600080fd5b8101908080519060200190929190505050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260228152602001806101946022913960400191505060405180910390fd5b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff16021790555050607b806101196000396000f3fe608060405260005463a619486e60003560e01c14156024578060601b606c5260206060f35b3660008037600080366000845af43d6000803e806040573d6000fd5b3d6000f3fea2646970667358221220e61834ebd2d8cd909d362bf67c47ef58fd665df38e6dd036ce65611101d072e964736f6c63430007060033496e76616c69642073696e676c65746f6e20616464726573732070726f7669646564";
const abi = parseAbi(["function setup(address[],uint256,address,bytes,address,address,uint256,address)"]);
function derive(initializer: Hex, saltNonce: Hex) {
  return getContractAddress({ from: factory, opcode: "CREATE2", salt: keccak256(concat([keccak256(initializer), saltNonce])),
    bytecode: concat([proxy, encodeAbiParameters([{ type: "address" }], [singleton])]) }).toLowerCase();
}
export function personalSafeAddress(config: PersonalSafeConfig, mailbox: string) {
  const email = mailbox.trim().toLowerCase();
  const enable = encodeFunctionData({ abi: parseAbi(["function enableModules(address[])"]), functionName: "enableModules", args: [[module]] });
  const payload = encodePacked(["uint8", "address", "uint256", "uint256", "bytes"], [1, setup, 0n, BigInt((enable.length - 2) / 2), enable]);
  const data = encodeFunctionData({ abi: parseAbi(["function multiSend(bytes)"]), functionName: "multiSend", args: [payload] });
  return derive(encodeFunctionData({ abi, functionName: "setup", args: [[config.companiesHouse], 1n, multi, data, module, zero, 0n, zero] }), keccak256(stringToHex(`${config.namespace}:${email}`)));
}
export function companySafeAddress(config: PersonalSafeConfig, handle: string, founderSafe: Address) {
  return derive(encodeFunctionData({ abi, functionName: "setup", args: [[config.companiesHouse], 1n, zero, "0x", "0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4", zero, 0n, zero] }),
    keccak256(encodeAbiParameters([{ type: "string" }, { type: "string" }, { type: "address" }], [config.namespace, handle, founderSafe])));
}
