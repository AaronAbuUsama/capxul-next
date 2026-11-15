// Where the seed's deployment puts everything, from the manifest, Companies House's configuration and the compiled
// contracts: Companies House is a Safe made by the pin's Safe proxy factory, its Roles module is made by the
// ModuleProxyFactory, and each manifest entry is created by Companies House through CreateCall's CREATE2, so every
// address is a function of the house, the entry's salt and its compiled init code. Pure: no chain, no disk.
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Result from "effect/Result";
import * as Str from "effect/String";
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  getContractAddress,
  isAddress,
  keccak256,
  pad,
  parseAbi,
  parseAbiParameters,
  toBytes,
  toHex,
  type AbiParameter,
  type Hex,
} from "viem";
import { THIRD_PARTY } from "./third-party.ts";

/** A literal, or a named tuple of them; `$Name` is an earlier entry's address or `$companiesHouse`. */
export type Argument = string | number | boolean | { readonly [name: string]: Argument };

/** One contract of `deploy/manifest.json`, in deployment order. */
export interface Entry {
  readonly name: string;
  /** Under the package's src/, for example `money/Payments.sol`. */
  readonly source: string;
  readonly salt: string;
  readonly constructorArguments: { readonly [name: string]: Argument };
}

/** A constructor parameter as the compiled ABI declares it. */
export interface Parameter {
  readonly name: string;
  readonly type: string;
  readonly components?: ReadonlyArray<Parameter>;
}

/** What `forge build` wrote for one entry: its creation code and its constructor's parameters. */
export interface Compiled {
  readonly creation: Hex;
  readonly inputs: ReadonlyArray<Parameter>;
}

/** An entry with its init code, its address and its constructor arguments resolved. */
export interface Planned {
  readonly name: string;
  readonly salt: Hex;
  readonly address: Hex;
  readonly initCode: Hex;
  readonly arguments: { readonly [name: string]: unknown };
}

/** Companies House's configuration (`deploy/devnet.json`). */
export interface HouseConfig {
  readonly owners: ReadonlyArray<Hex>;
  readonly threshold: number;
  readonly tiers: ReadonlyArray<{
    readonly tier: string;
    readonly namespace: string;
    readonly companyNamespace: string;
    readonly member: Hex;
  }>;
}

/** An entry's salt: `keccak256("capxul:v4:<Name>")`. */
export const saltOf = (name: string): Hex => keccak256(toBytes(`capxul:v4:${name}`));

/** Companies House's salt nonce: keccak256 of "capxul:companies-house:v1". */
export const HOUSE_SALT_NONCE = BigInt(keccak256(toBytes("capxul:companies-house:v1")));

const SAFE_SETUP = parseAbi([
  "function setup(address[] owners, uint256 threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
]);
export const FACTORY_ABI = parseAbi([
  "function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
  "function proxyCreationCode() pure returns (bytes)",
]);
const MODULE_FACTORY_ABI = parseAbi([
  "function deployModule(address masterCopy, bytes initializer, uint256 saltNonce) returns (address proxy)",
]);
const ROLES_SET_UP = parseAbi(["function setUp(bytes initializeParams)"]);
const ZERO: Hex = "0x0000000000000000000000000000000000000000";

/** Companies House's `setup` call: its Directors in ascending address order, so their listing does not matter. */
export const houseInitializer = (config: HouseConfig): Hex =>
  encodeFunctionData({
    abi: SAFE_SETUP,
    functionName: "setup",
    args: [
      Arr.sort(
        Arr.map(config.owners, (owner) => Str.toLowerCase(owner) as Hex),
        (a: Hex, b: Hex) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0),
      ),
      BigInt(config.threshold),
      ZERO,
      "0x",
      THIRD_PARTY.fallbackHandler,
      ZERO,
      0n,
      ZERO,
    ],
  });

/** The call that creates Companies House. */
export const createHouseData = (initializer: Hex): Hex =>
  encodeFunctionData({
    abi: FACTORY_ABI,
    functionName: "createProxyWithNonce",
    args: [THIRD_PARTY.safeSingleton, initializer, HOUSE_SALT_NONCE],
  });

/** Where a Safe proxy lands: CREATE2 from the factory over its proxy creation code and the singleton. */
export const safeProxyAddress = (proxyCreationCode: Hex, initializer: Hex): Hex =>
  getContractAddress({
    opcode: "CREATE2",
    from: THIRD_PARTY.safeProxyFactory,
    salt: keccak256(concat([keccak256(initializer), toHex(HOUSE_SALT_NONCE, { size: 32 })])),
    bytecode: concat([proxyCreationCode, pad(THIRD_PARTY.safeSingleton, { size: 32 })]),
  });

/** The Roles module on Companies House (owner, avatar and target the house), at salt nonce 0, and the call making it. */
export const houseRoles = (house: Hex): { readonly address: Hex; readonly deployData: Hex } => {
  const initializer = encodeFunctionData({
    abi: ROLES_SET_UP,
    functionName: "setUp",
    args: [encodeAbiParameters(parseAbiParameters("address, address, address"), [house, house, house])],
  });
  const initCode: Hex = `0x602d8060093d393df3363d3d373d3d3d363d73${Str.toLowerCase(Str.slice(2)(THIRD_PARTY.rolesMastercopy))}5af43d82803e903d91602b57fd5bf3`;
  return {
    address: getContractAddress({
      opcode: "CREATE2",
      from: THIRD_PARTY.moduleProxyFactory,
      salt: keccak256(concat([keccak256(initializer), pad("0x0", { size: 32 })])),
      bytecode: initCode,
    }),
    deployData: encodeFunctionData({
      abi: MODULE_FACTORY_ABI,
      functionName: "deployModule",
      args: [THIRD_PARTY.rolesMastercopy, initializer, 0n],
    }),
  };
};

const isTuple = (value: Argument): value is { readonly [name: string]: Argument } =>
  typeof value === "object" && value !== null;

/** One constructor argument as viem encodes it: a `$Name` is looked up, an integer is a bigint, a tuple an object. */
const resolve = (
  parameter: Parameter,
  value: Argument,
  refs: ReadonlyMap<string, Hex>,
): Result.Result<unknown, string> => {
  if (parameter.type === "tuple") {
    if (!isTuple(value)) return Result.fail(`${parameter.name}: expected an object`);
    return Result.map(
      Result.all(
        Arr.map(parameter.components ?? [], (component) =>
          Result.flatMap(
            Result.fromNullishOr(value[component.name], () => `${parameter.name}.${component.name}: missing`),
            (part) => Result.map(resolve(component, part, refs), (resolved) => [component.name, resolved] as const),
          ),
        ),
      ),
      (pairs) => Rec.fromEntries(pairs),
    );
  }
  if (typeof value === "string" && Str.startsWith("$")(value)) {
    return Result.fromNullishOr(
      refs.get(Str.slice(1)(value)),
      () => `${parameter.name}: ${value} names neither $companiesHouse nor an earlier entry`,
    );
  }
  if (/^u?int/.test(parameter.type)) {
    return typeof value === "boolean" || isTuple(value)
      ? Result.fail(`${parameter.name}: not an integer`)
      : Result.succeed(BigInt(value));
  }
  if (parameter.type === "address" && !(typeof value === "string" && isAddress(value))) {
    return Result.fail(`${parameter.name}: not an address`);
  }
  return Result.succeed(value);
};

/** Every entry's init code and address from `house`, in manifest order; the first problem, naming its entry, fails. */
export const planEntries = (
  house: Hex,
  entries: ReadonlyArray<Entry>,
  compiled: (entry: Entry) => Option.Option<Compiled>,
): Result.Result<ReadonlyArray<Planned>, string> =>
  Result.gen(function* () {
    const refs = new Map<string, Hex>([["companiesHouse", house]]);
    const planned: Array<Planned> = [];
    for (const entry of entries) {
      const salt = saltOf(entry.name);
      if (Str.toLowerCase(entry.salt) !== salt) {
        return yield* Result.fail(`${entry.name}: its salt must be keccak256("capxul:v4:${entry.name}")`);
      }
      const artifact = yield* Result.fromOption(compiled(entry), () => `${entry.name}: not compiled`);
      const extra = Arr.filter(
        Rec.keys(entry.constructorArguments),
        (key) => !Arr.some(artifact.inputs, (input) => input.name === key),
      );
      if (extra.length > 0) return yield* Result.fail(`${entry.name}'s constructor has no ${Arr.join(extra, ", ")}`);
      const values = yield* Result.all(
        Arr.map(artifact.inputs, (input) =>
          Result.flatMap(
            Result.fromNullishOr(
              entry.constructorArguments[input.name],
              () => `${entry.name} needs constructor argument ${input.name}`,
            ),
            (given) => Result.mapError(resolve(input, given, refs), (problem) => `${entry.name}: ${problem}`),
          ),
        ),
      );
      const initCode = concat([
        artifact.creation,
        encodeAbiParameters(artifact.inputs as ReadonlyArray<AbiParameter>, values),
      ]);
      const address = getContractAddress({ opcode: "CREATE2", from: house, salt, bytecode: initCode });
      refs.set(entry.name, address);
      planned.push({
        name: entry.name,
        salt,
        address,
        initCode,
        arguments: Rec.fromEntries(Arr.map(artifact.inputs, (input, index) => [input.name, values[index]] as const)),
      });
    }
    return planned;
  });
