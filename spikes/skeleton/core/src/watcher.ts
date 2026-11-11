// Reads the chain's logs and turns them into outbox events. The cursor (last block read) is persisted;
// event_key = chainId:blockHash:logIndex keeps a re-read after a crash from creating a second event.
import { decodeEventLog, type Log } from "viem";
import { abis, deployment, publicClient, fromUnits, orgId } from "./chain.ts";
import { byAddress } from "./people.ts";
import { enqueue, ensureOrg, orgByHash } from "./outbox.ts";
import { loadJson, saveJson } from "./store.ts";
import { config } from "./config.ts";

const log = (m: string) => console.log(`${new Date().toISOString()} [watcher] ${m}`);
let cursor = loadJson<{ block: number }>("cursor.json", { block: -1 }).block;
let polling: Promise<void> | undefined;

export function poll(): Promise<void> {
  // one poll at a time; a caller that arrives meanwhile waits for the running one, then runs another
  polling = (polling ?? Promise.resolve()).then(run, run);
  return polling;
}

async function run(): Promise<void> {
  const d = deployment();
  if (config.chainMode === "v4") return runV4(d.chainId, d.deployedBlock);
  const latest = Number(await publicClient.getBlockNumber());
  if (latest <= cursor) return;
  const from = BigInt(cursor + 1);
  const logs = await publicClient.getLogs({ address: [d.hats, d.orgs, d.payments], fromBlock: from, toBlock: BigInt(latest) });
  // OrgCreated first: a log only carries the org's hash, so the slug must be known before logs that name the hash,
  // whatever order the contract emitted them in.
  const isOrgLog = (l: Log) => l.address.toLowerCase() === d.orgs.toLowerCase();
  for (const l of [...logs.filter(isOrgLog), ...logs.filter((x) => !isOrgLog(x))]) await handle(l, d.chainId, d.hats, d.orgs, d.payments);
  cursor = latest;
  saveJson("cursor.json", { block: cursor });
}

const personData = (addr: string) => {
  const p = byAddress(addr);
  return { person_email: p?.email ?? null, person_name: p?.name ?? null, address: addr };
};

async function handle(l: Log, chainId: number, hats: string, orgs: string, payments: string): Promise<void> {
  const abi = l.address.toLowerCase() === hats.toLowerCase() ? abis.hats
    : l.address.toLowerCase() === orgs.toLowerCase() ? abis.orgs
    : l.address.toLowerCase() === payments.toLowerCase() ? abis.payments : undefined;
  if (!abi) return log(`log from unknown contract ${l.address}, ignored`);
  const ev = decodeEventLog({ abi, data: l.data, topics: l.topics as [`0x${string}`] });
  const key = `${chainId}:${l.blockHash}:${l.logIndex}`;
  const a = ev.args as Record<string, any>;

  if (ev.eventName === "OrgCreated") {
    ensureOrg(a.slug, orgId(a.slug), { safe: a.safe });
    return log(`org ${a.slug} seen on chain (held until its site exists)`);
  }
  const org = orgByHash(a.org);
  if (!org) return log(`ERROR ${ev.eventName} for an org this Core never saw created (${a.org}); not forwarded`);

  if (ev.eventName === "HatGranted" || ev.eventName === "HatRevoked") {
    const kind = ev.eventName === "HatGranted" ? "hat_granted" : "hat_revoked";
    enqueue(org.slug, key, kind, { hat: a.hat, ...personData(a.wearer), department: a.department || null, tx_hash: l.transactionHash });
  } else if (ev.eventName === "PaymentSent") {
    const block = await publicClient.getBlock({ blockNumber: l.blockNumber! });
    enqueue(org.slug, key, "payment_sent", {
      payment_id: a.paymentId, document_hash: a.documentHash, from_safe: a.from, to: a.to,
      amount: fromUnits(a.amount), asset: "USDC", tx_hash: l.transactionHash,
      block_time: new Date(Number(block.timestamp) * 1000).toISOString().replace(".000Z", "Z"),
    });
  }
}

// The real chain (CHAIN_MODE=v4): Hats' TransferSingle and Payments' PaymentSent, for the companies this Core made. Core
// made the company, so it knows it before any of its logs (no OrgCreated is needed). Reading starts at the block the
// chain was set up at: the seeded state has no logs before it.
async function runV4(chainId: number, deployedBlock: number): Promise<void> {
  const { v4Addresses, v4Decode } = await import("./v4.ts");
  const latest = Number(await publicClient.getBlockNumber());
  const start = Math.max(cursor, deployedBlock);
  if (latest <= start) return;
  const { hats, payments } = await v4Addresses();
  const logs = await publicClient.getLogs({ address: [hats, payments], fromBlock: BigInt(start + 1), toBlock: BigInt(latest) });
  for (const l of logs) {
    const ev = await v4Decode(l);
    if (!ev) continue;
    const key = `${chainId}:${l.blockHash}:${l.logIndex}`;
    const org = ensureOrg(ev.slug, orgId(ev.slug), { safe: ev.safe });
    if (ev.kind === "payment_sent") {
      const block = await publicClient.getBlock({ blockNumber: l.blockNumber! });
      enqueue(org.slug, key, "payment_sent", {
        payment_id: ev.paymentId, document_hash: ev.documentHash, from_safe: ev.from, to: ev.to,
        amount: fromUnits(ev.amount), asset: "USDC", tx_hash: l.transactionHash,
        block_time: new Date(Number(block.timestamp) * 1000).toISOString().replace(".000Z", "Z"),
      });
    } else {
      enqueue(org.slug, key, ev.kind, { hat: ev.hat, ...personData(ev.wearer), department: ev.department, tx_hash: l.transactionHash });
    }
  }
  cursor = latest;
  saveJson("cursor.json", { block: cursor });
}
