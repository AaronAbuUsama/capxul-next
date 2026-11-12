import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { parseAbi } from "viem";
import { connect, send } from "../modules/chain/service.ts";
import { canaryBundlerKeys, probeBundler } from "../modules/bundler/service.ts";
import { testKey } from "../modules/test-keys/service.ts";
import { runDevnet } from "./command.ts";
import { composeWorld } from "./composition.ts";
import { command } from "./processes.ts";
import { loopback, readConfig } from "./supervisor.ts";

test("fresh native creation persists the supplied sponsor across up and snapshot recovery", {
  skip: !process.env.WORLD_SUPPLIER_NATIVE && "WORLD_SUPPLIER_NATIVE is not set", timeout: 600_000,
}, async () => {
  const root = resolve(import.meta.dirname, "../../../.."), id = `s${Date.now().toString(36)}`;
  const file = join(root, "var/worlds", id, "config.json");
  const cli = (...args: string[]) => runDevnet(["world", ...args, "--config", file, "--json"]);
  assert.equal(await cli("init", id), 0);
  try {
    assert.equal(await cli("create"), 0);
    const c = await readConfig(file);
    assert(c.bundler?.paymaster, "fresh create must install a real supplied sponsor");
    assert.equal((await stat(file)).mode & 0o077, 0);
    assert.equal(c.bundler.argv[0], join(root, "packages/devnet/node_modules/.bin/alto"));
    assert.notEqual(c.bundler.url, loopback(c.ports.publicBundler));
    const deployment = await readFile(join(c.world.stateDir, "deployment.json"), "utf8");
    assert.equal(JSON.parse(deployment).paymaster, c.bundler.paymaster);
    const chain = await connect(loopback(c.ports.publicRpc));
    const entryPoint = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
    const paymaster = c.bundler.paymaster as `0x${string}`;
    assert(await chain.client.getCode({ address: paymaster }));
    const keys = canaryBundlerKeys(), utility = chain.walletFor(keys.utilityKey).account.address;
    // Alto legitimately spends utility gas deploying its CREATE2 simulation contracts on first startup.
    // Find the last native block before its first transaction and verify the funding contract there.
    let funded = BigInt(JSON.parse(deployment).deployedBlock), started = await chain.client.getBlockNumber();
    while (funded + 1n < started) {
      const middle = (funded + started) / 2n;
      if (await chain.client.getTransactionCount({ address: utility, blockNumber: middle }) === 0) funded = middle;
      else started = middle;
    }
    for (const key of Object.values(keys)) {
      assert(await chain.client.getBalance({ address: chain.walletFor(key).account.address, blockNumber: funded }) >= 10n ** 19n);
    }
    const balances = async () => ({
      deposit: String(await chain.client.readContract({ address: entryPoint, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [paymaster] })),
      accounts: await Promise.all([testKey("deployer").key, ...Object.values(keys)].map(async (key) => {
        const address = chain.walletFor(key).account.address;
        return { address, nonce: await chain.client.getTransactionCount({ address }), balance: String(await chain.client.getBalance({ address })) };
      })),
    });
    const before = await balances();
    assert(BigInt(before.deposit) >= 10n ** 18n);
    await probeBundler(loopback(c.ports.publicBundler));
    assert.equal(await cli("stop"), 0);
    assert.equal(await cli("up"), 0);
    assert.deepEqual(await balances(), before, "up must not redeploy or top up accounts");
    const snapshot = `sponsor_${id}`;
    assert.equal(await cli("snapshot", "save", snapshot), 0);
    await (await composeWorld(file)).inspect();
    assert.equal(await cli("snapshot", "read", snapshot), 0);
    await send(chain, { from: testKey("deployer").key, to: testKey("payee").address, data: "0x", value: 7n });
    assert.notDeepEqual(await balances(), before);
    assert.equal(await cli("snapshot", "restore", snapshot), 0);
    const restored = await composeWorld(file);
    assert.equal((await restored.inspect()).world.epoch, 2);
    await probeBundler(loopback(c.ports.publicBundler));
    assert.deepEqual(await balances(), before, "restore must recover native sponsor balances and nonces without preparation");
    assert.equal(await readFile(join(c.world.stateDir, "deployment.json"), "utf8"), deployment);
    assert.deepEqual((await readConfig(file)).bundler, c.bundler);
  } finally {
    assert.equal(await cli("stop"), 0);
    // Keep the native world and host-local snapshot for inspection; never drop a failed recovery.
  }
});

test("fresh bench authenticates a tenant socket through its internal callback before any restart", {
  skip: !process.env.WORLD_SUPPLIER_NATIVE && "WORLD_SUPPLIER_NATIVE is not set", timeout: 600_000,
}, async () => {
  const root = resolve(import.meta.dirname, "../../../.."), id = `c${Date.now().toString(36)}`;
  const file = join(root, "var/worlds", id, "config.json"), site = `${id}.localhost`;
  const cli = (...args: string[]) => runDevnet(["world", ...args, "--config", file, "--json"]);
  assert.equal(await cli("init", id), 0);
  try {
    assert.equal(await cli("create"), 0);
    const c = await readConfig(file);
    // A minimal Frappe site needs no company/payment fixture or acceptance credit.
    await command(["docker", "compose", ...c.bench.composeArgs, "run", "--rm", "-T", "--no-deps", "site-admin", "bash", "-ec",
      'bench new-site "$1" --mariadb-user-host-login-scope="%" --db-root-password "$MARIADB_ROOT_PASSWORD" --admin-password "$CAPXUL_ADMIN_PASSWORD"', "_", site], root);
    const headers = { Origin: loopback(c.ports.socket), "X-Frappe-Site-Name": site, Cookie: "sid=Guest" };
    // This creates Frappe's native socket secret; without it get_user_info deliberately returns {}.
    assert.equal((await fetch(`${loopback(c.ports.bench)}/api/method/frappe.realtime.get_user_info`, { headers })).status, 200);
    const url = `${loopback(c.ports.socket)}/socket.io/?EIO=4&transport=polling`;
    const open = await (await fetch(url, { headers, signal: AbortSignal.timeout(10000) })).text();
    assert.equal(open[0], "0");
    const session = `${url}&sid=${encodeURIComponent(JSON.parse(open.slice(1)).sid)}`;
    try {
      assert.equal((await fetch(session, { method: "POST", headers, body: `40/${site},`, signal: AbortSignal.timeout(10000) })).status, 200);
      const connected = await (await fetch(session, { headers, signal: AbortSignal.timeout(10000) })).text();
      assert(connected.startsWith(`40/${site},`), `native namespace callback refused: ${connected}`);
    } finally {
      await fetch(session, { method: "POST", headers, body: "1", signal: AbortSignal.timeout(10000) });
    }
  } finally {
    assert.equal(await cli("stop"), 0);
    // Retain failed native fixtures; never repair/restart them to manufacture a green result.
  }
});
