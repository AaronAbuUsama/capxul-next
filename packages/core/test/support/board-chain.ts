// A world's chain and bundler in memory, for the board's SQL test (test/board-sql.test.ts): just enough of the company
// Safe, the Hats protocol, the Signer Gate, the EntryPoint and the Safe4337Module to answer the reads the board
// operations and org.member.grant make, and to carry out the founder's UserOperation as the contracts would: a seat
// takes one more seat when every seat is worn, the mint adds a wearer, the Gate's claim adds an owner at the Gate's
// threshold (`min = target`), and its new config sets the threshold. It checks no signature: approval.sign has.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { concat, decodeFunctionData, encodeFunctionResult, type Hex, hexToBigInt, keccak256, size, slice } from "viem";
import { ENTRY_POINT, GATE, HATS, MULTI_SEND, SAFE, SAFE_4337_MODULE } from "../../src/chain/abi.ts";
import { hex, sameAddress } from "../../src/chain/hex.ts";
import { SEEDED } from "../../src/chain/seeded.ts";
import { ChainFailed, WorldChain } from "../../src/chain/WorldChain.ts";

/** A hat: how many wear it, how many may, and who. */
export interface Hat {
  readonly supply: number;
  readonly maxSupply: number;
  readonly wearers: ReadonlyArray<string>;
}

/** What the chain holds: the company Safe's owners and threshold, each hat by its id, and each call carried out. */
export interface ChainState {
  readonly owners: ReadonlyArray<string>;
  readonly threshold: number;
  readonly hats: Readonly<Record<string, Hat>>;
  readonly sent: ReadonlyArray<{ readonly sender: string; readonly calls: ReadonlyArray<string> }>;
}

const noHat: Hat = { supply: 0, maxSupply: 1, wearers: [] };
const ZERO = "0x0000000000000000000000000000000000000000";
const failed = (method: string, message: string) => ChainFailed.make({ reach: "answer", method, message });
const decoded = <A>(decode: () => A) => Option.liftThrowable(decode)();
const hatOf = (state: ChainState, id: bigint) => state.hats[id.toString()] ?? noHat;

/** Answers one `eth_call`. */
const read = (state: ChainState, to: string, data: Hex): Option.Option<Hex> => {
  const safe = decoded(() => decodeFunctionData({ abi: SAFE, data }));
  if (Option.isSome(safe) && !sameAddress(to, SEEDED.hats)) {
    const call = safe.value;
    if (call.functionName === "getOwners")
      return Option.some(
        encodeFunctionResult({ abi: SAFE, functionName: "getOwners", result: Arr.map(state.owners, hex) }),
      );
    if (call.functionName === "getThreshold")
      return Option.some(
        encodeFunctionResult({ abi: SAFE, functionName: "getThreshold", result: BigInt(state.threshold) }),
      );
    if (call.functionName === "nonce")
      return Option.some(encodeFunctionResult({ abi: SAFE, functionName: "nonce", result: 0n }));
  }
  const hats = decoded(() => decodeFunctionData({ abi: HATS, data }));
  if (Option.isSome(hats) && hats.value.functionName === "viewHat") {
    const hat = hatOf(state, hats.value.args[0]);
    const result = ["", hat.maxSupply, hat.supply, ZERO, ZERO, "", 0, true, true] as const;
    return Option.some(encodeFunctionResult({ abi: HATS, functionName: "viewHat", result }));
  }
  if (Option.isSome(hats) && hats.value.functionName === "isWearerOfHat") {
    const [user, id] = hats.value.args;
    const wears = Arr.some(hatOf(state, id).wearers, (each) => sameAddress(each, user));
    return Option.some(encodeFunctionResult({ abi: HATS, functionName: "isWearerOfHat", result: wears }));
  }
  const module = decoded(() => decodeFunctionData({ abi: SAFE_4337_MODULE, data }));
  if (Option.isSome(module) && module.value.functionName === "getOperationHash") {
    const [op] = module.value.args;
    const digest = keccak256(concat([op.sender, op.callData]));
    return Option.some(
      encodeFunctionResult({ abi: SAFE_4337_MODULE, functionName: "getOperationHash", result: digest }),
    );
  }
  // The EntryPoint's nonce of every key is 0: each operation has its own key.
  const entryPoint = decoded(() => decodeFunctionData({ abi: ENTRY_POINT, data }));
  if (Option.isSome(entryPoint) && entryPoint.value.functionName === "getNonce")
    return Option.some(encodeFunctionResult({ abi: ENTRY_POINT, functionName: "getNonce", result: 0n }));
  return Option.none();
};

/** The plain calls a MultiSendCallOnly batch packs: operation, to, value, length, data, each in turn. */
const unpacked = (packed: Hex): ReadonlyArray<{ readonly to: string; readonly data: Hex }> => {
  const calls: Array<{ readonly to: string; readonly data: Hex }> = [];
  let at = 0;
  while (at < size(packed)) {
    const to = slice(packed, at + 1, at + 21);
    const length = Number(hexToBigInt(slice(packed, at + 53, at + 85)));
    calls.push({ to, data: length === 0 ? "0x" : slice(packed, at + 85, at + 85 + length) });
    at += 85 + length;
  }
  return calls;
};

/** Carries out one call of the founder's Safe, as the Hats protocol and the Gate would. */
const apply = (state: ChainState, to: string, data: Hex): { readonly state: ChainState; readonly call: string } => {
  const hats = decoded(() => decodeFunctionData({ abi: HATS, data }));
  if (sameAddress(to, SEEDED.hats) && Option.isSome(hats)) {
    const call = hats.value;
    if (call.functionName === "changeHatMaxSupply") {
      const hat = hatOf(state, call.args[0]);
      const hatsNow = { ...state.hats, [call.args[0].toString()]: { ...hat, maxSupply: call.args[1] } };
      return { state: { ...state, hats: hatsNow }, call: `changeHatMaxSupply ${call.args[1]}` };
    }
    if (call.functionName === "mintHat") {
      const hat = hatOf(state, call.args[0]);
      const minted = { supply: hat.supply + 1, maxSupply: hat.maxSupply, wearers: [...hat.wearers, call.args[1]] };
      return { state: { ...state, hats: { ...state.hats, [call.args[0].toString()]: minted } }, call: "mintHat" };
    }
  }
  const gate = decoded(() => decodeFunctionData({ abi: GATE, data }));
  if (Option.isSome(gate) && gate.value.functionName === "claimSignerFor")
    return { state: { ...state, owners: [...state.owners, gate.value.args[1]] }, call: "claimSignerFor" };
  if (Option.isSome(gate) && gate.value.functionName === "setThresholdConfig")
    return {
      state: { ...state, threshold: Number(gate.value.args[0].target) },
      call: `setThresholdConfig ${gate.value.args[0].target}`,
    };
  return { state, call: `unknown ${to}` };
};

/** Carries out a UserOperation's `executeUserOp`: one call, or a MultiSendCallOnly batch. */
const execute = (state: ChainState, sender: string, callData: Hex): ChainState => {
  const op = decodeFunctionData({ abi: SAFE_4337_MODULE, data: callData });
  if (op.functionName !== "executeUserOp") return state;
  const [to, , data] = op.args;
  const calls = sameAddress(to, SEEDED.multiSendCallOnly)
    ? unpacked(decodeFunctionData({ abi: MULTI_SEND, data }).args[0])
    : [{ to, data }];
  const done = Arr.reduce(calls, { state, calls: [] as ReadonlyArray<string> }, (each, call) => {
    const next = apply(each.state, call.to, call.data);
    return { state: next.state, calls: [...each.calls, next.call] };
  });
  return { ...done.state, sent: [...done.state.sent, { sender, calls: done.calls }] };
};

const Call = Schema.Tuple([Schema.Struct({ to: Schema.String, data: Schema.String }), Schema.Unknown]);
const UserOp = Schema.Tuple([Schema.Struct({ sender: Schema.String, callData: Schema.String }), Schema.Unknown]);
const Hash = Schema.Tuple([Schema.String]);

/** The chain and bundler, on the state `held`. */
export const fakeChain = (held: Ref.Ref<ChainState>) =>
  Layer.succeed(
    WorldChain,
    WorldChain.of({
      rpc: (method, params = []) =>
        Effect.gen(function* () {
          if (method !== "eth_call") return yield* failed(method, "not in the fake chain");
          const [call] = yield* Schema.decodeUnknownEffect(Call)(params).pipe(Effect.orDie);
          const answered = read(yield* Ref.get(held), call.to, hex(call.data));
          if (Option.isNone(answered)) return yield* failed(method, `no read of ${call.to} answers ${call.data}`);
          return answered.value;
        }),
      bundler: (method, params = []) =>
        Effect.gen(function* () {
          if (method === "pimlico_getUserOperationGasPrice")
            return { fast: { maxFeePerGas: "0x3b9aca00", maxPriorityFeePerGas: "0x3b9aca00" } };
          if (method === "eth_sendUserOperation") {
            const [op] = yield* Schema.decodeUnknownEffect(UserOp)(params).pipe(Effect.orDie);
            yield* Ref.update(held, (state) => execute(state, op.sender, hex(op.callData)));
            return keccak256(hex(op.callData));
          }
          if (method === "eth_getUserOperationReceipt") {
            const [hash] = yield* Schema.decodeUnknownEffect(Hash)(params).pipe(Effect.orDie);
            return { success: true, reason: null, receipt: { transactionHash: hash, blockNumber: "0x10", logs: [] } };
          }
          return yield* failed(method, "not in the fake bundler");
        }),
    }),
  );
