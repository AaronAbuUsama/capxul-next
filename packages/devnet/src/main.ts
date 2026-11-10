// The devnet's one entry point: the composition root. It alone reads process.env and argv, reads and writes files, and
// prints. Everything else is a module that takes what it needs and answers a value.
//
//   node --experimental-strip-types packages/devnet/src/main.ts deploy [--rpc URL] [--out FILE]
//   node --experimental-strip-types packages/devnet/src/main.ts verify [--rpc URL] [--deployments FILE]
//   node --experimental-strip-types packages/devnet/src/main.ts prove  [--rpc URL] [--deployments FILE]
//   node --experimental-strip-types packages/devnet/src/main.ts seed-pin --upstream URL --block N --out FILE [--forge-cache FILE] [--anvil-dump FILE]

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { localPrivateKeySigner } from "@capxul/sdk";

import { connect } from "./modules/chain/service.ts";
import { deployProtocol, parseManifest, verifyProtocol, type CompaniesHouseConfig, type DeploymentRecord } from "./modules/protocol/service.ts";
import { genesisOf, readPinned, touchedFromAnvilDump, touchedFromForgeCache, unionTouched } from "./modules/chain-state/service.ts";
import { runProof } from "./modules/proof/service.ts";
import { testKey } from "./modules/test-keys/service.ts";

const ALL_ROLES = ["deployer", "directorOne", "directorTwo", "tierService", "founder", "second", "payee", "stranger", "agent"] as const;
const root = resolve(import.meta.dirname, "..", "..", "..");
const contracts = join(root, "packages", "contracts");

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? undefined : argv[at + 1];
};
const rpcUrl = flag("rpc") ?? process.env.CHAIN_RPC_URL ?? `http://127.0.0.1:${process.env.CHAIN_PORT ?? "18545"}`;

async function protocolInputs() {
  const manifest = parseManifest(await readFile(join(contracts, "deploy", "manifest.json"), "utf8"));
  const config = JSON.parse(await readFile(join(contracts, "deploy", "devnet.json"), "utf8")) as CompaniesHouseConfig;
  const artifacts: Record<string, unknown> = {};
  for (const entry of manifest.contracts) {
    const file = entry.source.split("/").pop() as string;
    artifacts[`${file}/${entry.name}`] = JSON.parse(await readFile(join(contracts, "out", file, `${entry.name}.json`), "utf8"));
  }
  return { manifest, config, artifacts };
}

async function main(): Promise<number> {
  const [command] = argv;
  if (command === "deploy") {
    const chain = await connect(rpcUrl);
    const { manifest, config, artifacts } = await protocolInputs();
    const owners = [testKey("deployer"), testKey("directorOne"), testKey("directorTwo")].map((k) => localPrivateKeySigner({ privateKey: k.key }));
    const { record, steps } = await deployProtocol({ chain, manifest, config, artifacts, sender: testKey("deployer").key, owners });
    for (const step of steps) console.log(`${step.status === "done" ? "deployed" : "already  "}  ${step.name}`);
    const out = resolve(flag("out") ?? join(contracts, "deployments", "devnet.json"));
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`chain ${chain.chainId}: ${Object.keys(record.contracts).length} contracts, record written to ${out}`);
    return 0;
  }
  if (command === "verify") {
    const chain = await connect(rpcUrl);
    const { manifest, config, artifacts } = await protocolInputs();
    const checks = await verifyProtocol({ chain, manifest, config, artifacts });
    for (const { check, ok } of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${check}`);
    const recordPath = resolve(flag("deployments") ?? join(contracts, "deployments", "devnet.json"));
    const record = JSON.parse(await readFile(recordPath, "utf8")) as DeploymentRecord;
    console.log(`record ${recordPath}: Companies House ${record.companiesHouse}`);
    return checks.every((c) => c.ok) ? 0 : 1;
  }
  if (command === "prove") {
    const chain = await connect(rpcUrl);
    const record = JSON.parse(await readFile(resolve(flag("deployments") ?? join(contracts, "deployments", "devnet.json")), "utf8")) as DeploymentRecord;
    const artifact = async (file: string, name: string) => JSON.parse(await readFile(join(contracts, "out", file, `${name}.json`), "utf8")) as unknown;
    const results = await runProof({
      chain,
      record,
      artifacts: { token: await artifact("MockERC20.sol", "MockERC20"), installer: await artifact("Installer.sol", "Installer") },
      keys: {
        deployer: testKey("deployer"),
        tierService: testKey("tierService"),
        founder: testKey("founder"),
        second: testKey("second"),
        payee: testKey("payee"),
        stranger: testKey("stranger"),
        agent: testKey("agent"),
      },
      report: (step) => console.log(`${step.ok ? "PASS" : "FAIL"}  ${step.name}\n      ${step.detail}`),
    });
    const failed = results.filter((step) => !step.ok).length;
    console.log(failed === 0 ? `PASS: all ${results.length} steps` : `FAIL: ${failed} of ${results.length} steps`);
    return failed === 0 ? 0 : 1;
  }
  if (command === "seed-pin") {
    const out = flag("out");
    const block = flag("block");
    const upstream = flag("upstream");
    if (out === undefined || block === undefined || upstream === undefined) throw new Error("seed-pin needs --upstream, --block and --out");
    const sets = [];
    const cache = flag("forge-cache");
    if (cache !== undefined) sets.push(touchedFromForgeCache(JSON.parse(await readFile(cache, "utf8"))));
    const dump = flag("anvil-dump");
    if (dump !== undefined) sets.push(touchedFromAnvilDump(JSON.parse(await readFile(dump, "utf8"))));
    const chain = await connect(upstream);
    const { header, accounts } = await readPinned(chain, BigInt(block), unionTouched(...sets));
    await writeFile(out, `${JSON.stringify(genesisOf(header, accounts, chain.chainId, ALL_ROLES.map((role) => testKey(role).address)), null, 1)}\n`);
    console.log(`pinned block ${block}: ${accounts.length} contracts, ${accounts.reduce((n, a) => n + Object.keys(a.storage).length, 0)} storage slots, written to ${out}`);
    return 0;
  }
  console.error("usage: main.ts deploy|verify|prove|seed-pin");
  return 2;
}

process.exitCode = await main();
