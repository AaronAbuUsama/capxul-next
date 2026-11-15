// `pnpm seed`'s builder: starts anvil from the pinned third-party state (`state/pin.genesis.json`, no network), sends
// the seed's eight transactions (src/seed/steps.ts), each in its own block at a fixed time with fixed fees and signed
// with anvil's public test keys, dumps the state, and writes `state/core.json`, `deployments/devnet.json` and
// `state/CHECKSUMS` where they changed. With --check (`pnpm seed:check`) it writes the rebuild to a temporary folder
// instead, compares it with the committed files and fails naming each that differs. The root scripts build the
// contracts first. An entry file: it runs a process, reads and writes the disk, parses JSON, sets the exit code.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { gunzipSync } from "node:zlib";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { createPublicClient, createTestClient, http, keccak256, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { FACTORY_ABI, houseInitializer, houseRoles, planEntries, safeProxyAddress } from "./seed/plan.ts";
import type { Argument, Compiled, Entry, HouseConfig, Parameter } from "./seed/plan.ts";
import { checksums, deploymentRecord } from "./seed/record.ts";
import { execData, joinSignatures, safeTxHash } from "./seed/safe.ts";
import { BLOCK_TIMES, deploySteps, maxFeePerGas, PRIORITY_FEE, type Step } from "./seed/steps.ts";
import { THIRD_PARTY } from "./seed/third-party.ts";
import { CHAIN_ID, CHECKSUMS, FIRST_ACCOUNT, OUT, RECORD, SEED, SEED_INPUTS, TEST_MNEMONIC } from "./sources.ts";

const root = join(import.meta.dirname, "../../..");
const check = process.argv.includes("--check");
const started = process.hrtime.bigint();

const fail = (problem: string): never => {
  throw new Error(`pnpm seed: ${problem}`);
};
const unwrap = <A>(result: Result.Result<A, string>): A => Result.getOrThrowWith(result, (problem) => fail(problem));

/** The file at `path`, decoded as `schema`; a file that is missing or of another shape stops the run. */
const read = <S extends Schema.Codec<unknown, unknown>>(path: string, schema: S): S["Type"] => {
  if (!existsSync(join(root, path))) return fail(`${path} is missing (build the contracts first)`);
  // oxlint-disable-next-line effecttsgo/schema-sync -- an entry file run once from the command line: a file of another shape stops the run with its reason.
  return Schema.decodeUnknownSync(schema)(JSON.parse(readFileSync(join(root, path), "utf8")));
};

const ArgumentSchema: Schema.Codec<Argument> = Schema.Union([
  Schema.String,
  Schema.Finite,
  Schema.Boolean,
  Schema.Record(
    Schema.String,
    Schema.suspend((): Schema.Codec<Argument> => ArgumentSchema),
  ),
]);
const Manifest = Schema.Struct({
  version: Schema.Literal("v4"),
  contracts: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      source: Schema.String,
      salt: Schema.String,
      constructorArguments: Schema.Record(Schema.String, ArgumentSchema),
    }),
  ),
});
const Address = Schema.TemplateLiteral(["0x", Schema.String]);
const House = Schema.Struct({
  owners: Schema.Array(Address),
  threshold: Schema.Int,
  tiers: Schema.Array(
    Schema.Struct({ tier: Schema.String, namespace: Schema.String, companyNamespace: Schema.String, member: Address }),
  ),
});
const ParameterSchema: Schema.Codec<Parameter> = Schema.Struct({
  name: Schema.String,
  type: Schema.String,
  components: Schema.suspend((): Schema.Codec<Parameter> => ParameterSchema).pipe(Schema.Array, Schema.optionalKey),
});
const Constructor = Schema.Struct({ type: Schema.Literal("constructor"), inputs: Schema.Array(ParameterSchema) });
const Artifact = Schema.Struct({
  abi: Schema.Array(Schema.Unknown),
  bytecode: Schema.Struct({ object: Address }),
});
const Pin = Schema.Struct({ timestamp: Schema.String });

const manifest = read(SEED_INPUTS.manifest, Manifest);
const config: HouseConfig = read(SEED_INPUTS.house, House);
const compiled = (entry: Entry): Option.Option<Compiled> => {
  const path = `${OUT}/${basename(entry.source)}/${entry.name}.json`;
  if (!existsSync(join(root, path))) return Option.none();
  const artifact = read(path, Artifact);
  const inputs = Option.match(Arr.findFirst(artifact.abi, Schema.is(Constructor)), {
    onNone: (): ReadonlyArray<Parameter> => [],
    onSome: (constructor) => constructor.inputs,
  });
  return Option.some({ creation: artifact.bytecode.object, inputs });
};

/** Anvil's test accounts 0 to 9, by address: the only keys the seed signs with. */
const testAccounts = Arr.map(Arr.range(0, 9), (index) => mnemonicToAccount(TEST_MNEMONIC, { addressIndex: index }));
const testAccount = (address: string) =>
  Option.getOrElse(
    Arr.findFirst(testAccounts, (account) => Str.toLowerCase(account.address) === Str.toLowerCase(address)),
    () => fail(`${address} is not one of anvil's test accounts, so the seed cannot sign for it`),
  );
const deployer = testAccount(FIRST_ACCOUNT);
const signers = Arr.map(Arr.take(config.owners, config.threshold), testAccount);

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const port = await freePort();
const url = `http://127.0.0.1:${port}`;
const anvil = spawn(
  "anvil",
  ["--port", String(port), "--chain-id", String(CHAIN_ID), "--silent", "--init", join(root, SEED_INPUTS.pin)],
  { stdio: "ignore" },
);
const client = createPublicClient({ transport: http(url), pollingInterval: 20 });
const test = createTestClient({ mode: "anvil", transport: http(url) });

/** Sends one step in the next block, at its fixed time with fixed fees, and fails when it reverts. */
const send = async (step: Step, index: number, head: bigint): Promise<void> => {
  const data =
    step._tag === "Call"
      ? step.data
      : execData(
          step.call,
          joinSignatures(
            await Promise.all(
              Arr.map(signers, async (signer) => ({
                owner: signer.address,
                signature: await signer.sign({ hash: safeTxHash(CHAIN_ID, step.safe, step.call, step.nonce) }),
              })),
            ),
          ),
        );
  const to = step._tag === "Call" ? step.to : step.safe;
  await test.setNextBlockTimestamp({ timestamp: head + BigInt(BLOCK_TIMES[index] ?? fail("no time for a step")) });
  const pending = await client.getBlock({ blockTag: "pending" });
  const serializedTransaction = await deployer.signTransaction({
    chainId: CHAIN_ID,
    type: "eip1559",
    nonce: await client.getTransactionCount({ address: deployer.address }),
    gas: await client.estimateGas({ account: deployer.address, to, data }),
    maxFeePerGas: maxFeePerGas(pending.baseFeePerGas ?? fail("the pending block has no base fee")),
    maxPriorityFeePerGas: PRIORITY_FEE,
    to,
    value: 0n,
    data,
  });
  const hash = await client.sendRawTransaction({ serializedTransaction });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") fail(`${step.name} (${hash}) reverted`);
  console.log(`block ${receipt.blockNumber}: ${step.name}`);
};

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const text = (value: unknown) =>
  `${JSON.stringify(value, (_, v: unknown) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`;

const build = async (): Promise<ReadonlyArray<readonly [string, Buffer]>> => {
  for (let tries = 0; ; tries++) {
    const up = await client.getChainId().then(
      () => true,
      () => false,
    );
    if (up) break;
    if (tries > 100) fail("anvil did not start");
    await sleep(100);
  }
  const pin = read(SEED_INPUTS.pin, Pin);
  const proxyCreationCode = await client.readContract({
    address: THIRD_PARTY.safeProxyFactory,
    abi: FACTORY_ABI,
    functionName: "proxyCreationCode",
  });
  const initializer = houseInitializer(config);
  const house = safeProxyAddress(proxyCreationCode, initializer);
  const planned = unwrap(planEntries(house, manifest.contracts, compiled));
  const steps = unwrap(deploySteps(config, initializer, house, planned));
  for (const [index, step] of steps.entries()) await send(step, index, BigInt(pin.timestamp));

  const codes = new Map<string, Hex>();
  for (const address of [house, ...Arr.map(planned, (entry) => entry.address)]) {
    const code = (await client.getCode({ address })) ?? "0x";
    if (code === "0x") fail(`no code at ${address} after the deployment`);
    codes.set(address, keccak256(code));
  }
  const record = deploymentRecord({
    chainId: CHAIN_ID,
    house,
    roles: houseRoles(house).address,
    config,
    planned,
    codeHash: (address) => codes.get(address) ?? fail(`no code hash for ${address}`),
  });
  const core = gunzipSync(Buffer.from(Str.slice(2)(await test.dumpState()), "hex"));
  return [
    [SEED, core],
    [RECORD, Buffer.from(text(record))],
    [
      CHECKSUMS,
      Buffer.from(
        checksums([
          { name: basename(SEED_INPUTS.pin), sha256: sha256(readFileSync(join(root, SEED_INPUTS.pin))) },
          { name: basename(SEED), sha256: sha256(core) },
        ]),
      ),
    ],
  ];
};

try {
  const files = await build();
  const seconds = (Number(process.hrtime.bigint() - started) / 1e9).toFixed(1);
  const stale = Arr.filter(files, ([path, bytes]) => {
    const file = join(root, path);
    return !existsSync(file) || !readFileSync(file).equals(bytes);
  });
  if (check) {
    const folder = mkdtempSync(join(tmpdir(), "seed-check-"));
    for (const [path, bytes] of stale) writeFileSync(join(folder, basename(path)), bytes);
    for (const [path] of stale) {
      console.error(`${path} is not what the seed rebuilds (rebuilt copy: ${join(folder, basename(path))})`);
    }
    if (stale.length === 0) rmSync(folder, { recursive: true });
    if (stale.length > 0) {
      console.error("run `pnpm seed` and commit what it writes");
      process.exitCode = 1;
    } else console.log(`seed:check: the committed seed is what the seed rebuilds (${seconds} s)`);
  } else {
    for (const [path, bytes] of stale) {
      writeFileSync(join(root, path), bytes);
      console.log(`wrote ${path}`);
    }
    console.log(`seed: ${stale.length === 0 ? "nothing changed" : `${stale.length} files written`} (${seconds} s)`);
  }
} finally {
  anvil.kill();
}
