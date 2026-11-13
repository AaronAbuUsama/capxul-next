import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { inspect } from "node:util";
import { initializeConfig } from "./local-config.ts";
import { checkCodeVersion } from "./processes.ts";
import { readConfig, stop, up, writeConfig } from "./supervisor.ts";

/** World composition only; product provisioning remains the site's signed SDK command. */
export async function runDevnet(args: string[]): Promise<number> {
  const locks: string[] = [];
  let diagnostics: string | undefined;
  try {
    const index = args.indexOf("--config");
    if (index < 0 || !args[index + 1]) throw new Error("world commands require --config <private world JSON>");
    const configFile = resolve(args[index + 1]!);
    const words = args.filter((_, i) => i !== index && i !== index + 1 && args[i] !== "--json");
    const [world, commandName, ...rest] = words;
    if (world !== "world" && world !== "record") throw new Error("expected world or record command");
    if (world === "world" && commandName === "init" && rest.length === 1) {
      const config = await initializeConfig(configFile, rest[0]!, Number(process.env.CAPXUL_WORLD_PORT_BASE ?? 18000));
      console.log(JSON.stringify({ world: config.world.id, config: configFile })); return 0;
    }
    const config = await readConfig(configFile);
    diagnostics = join(config.controlDir, "last-error.log");
    await mkdir(config.controlDir, { recursive: true, mode: 0o700 });
    if (world === "record" || commandName === "show" || commandName === "snapshot" && rest[0] === "list") {
      const { readCatalogue } = await import("./catalogue-read.ts");
      console.log(JSON.stringify(await readCatalogue(config, words))); return 0;
    }
    const candidate = join(config.controlDir, ".operation");
    let nested = false;
    if (["fixture", "inspect", "prepare"].includes(commandName!) && process.env.CAPXUL_WORLD_RUN_TOKEN) {
      nested = await readFile(join(candidate, "token"), "utf8").then((token) => token === process.env.CAPXUL_WORLD_RUN_TOKEN, () => false);
    }
    if (commandName === "prepare" && !nested) throw new Error("prepare is a nested eval-harness command, not standalone fixture setup");
    if (!nested) {
      try { await mkdir(candidate); } catch { throw new Error("WRONG_STATE: another world operation holds the lock; inspect before clearing a stale lock"); }
      locks.push(candidate);
    }
    if (commandName !== "stop") await checkCodeVersion(config);
    const { composeWorld, createWorld } = await import("./composition.ts");
    if (commandName === "create" && !rest.length) { await createWorld(configFile); console.log(JSON.stringify({ state: "running" })); return 0; }
    const stack = await composeWorld(configFile);
    if (commandName === "up" && !rest.length) await up(stack.c, stack.host);
    else if (commandName === "stop" && !rest.length) await stop(stack.c, stack.host);
    else if (commandName === "inspect" && !rest.length) { console.log(JSON.stringify(await stack.inspect())); return 0; }
    else if (commandName === "clock" && rest[0] === "warp") {
      const flags = rest.slice(1), named = flags[0] && !flags[0].startsWith("--") ? flags.shift() : undefined;
      if (named !== undefined && named !== stack.c.world.id) throw new Error(`INVALID_INPUT: no world named ${named} on this machine`);
      if (flags.length !== 2 || !["--by", "--to"].includes(flags[0]!) || flags[1] === undefined) throw new Error("CLI_USAGE: world clock warp [WORLD] --by DURATION | --to DATE");
      console.log(JSON.stringify(await stack.warp(flags[0] === "--by" ? { by: flags[1] } : { to: flags[1] }))); return 0;
    }
    else if (commandName === "snapshot" && rest.length === 2 && ["save", "read", "restore"].includes(rest[0]!)) {
      const manifest = await stack[rest[0] as "save" | "read" | "restore"](rest[1]!);
      console.log(JSON.stringify({ id: manifest.id, world: manifest.world, epoch: manifest.epoch, cut: manifest.cut })); return 0;
    } else if (commandName === "snapshot" && rest.length === 4 && rest[0] === "restore" && rest[2] === "--as") {
      const targetFile = resolve(rest[3]!), target = await readConfig(targetFile), manifest = await stack.read(rest[1]!);
      if (target.world.id === stack.c.world.id || target.controlDir === stack.c.controlDir) throw new Error("--as requires a distinct initialized target world");
      if (target.snapshots !== stack.c.snapshots || target.codeVersion !== stack.c.codeVersion || new URL(target.database.admin).host !== new URL(stack.c.database.admin).host ||
          Object.values(target.ports).some((port) => Object.values(stack.c.ports).includes(port))) throw new Error("clone must share this host's snapshot/code version and use separate ports");
      const targetLock = join(target.controlDir, ".operation");
      await mkdir(targetLock); locks.push(targetLock);
      target.world.sites = manifest.sites.map((site) => ({ company: site.company, name: `${site.company}-${target.world.id}.${target.bench.baseDomain}` }));
      // Native site backups keep the source delivery secret and encryption key; implicit rekey is not recovery.
      target.secret = stack.c.secret;
      await writeConfig(targetFile, target);
      const clone = await composeWorld(targetFile);
      await clone.host.benchUp();
      await clone.restore(rest[1]!);
      console.log(JSON.stringify({ snapshot: manifest.id, world: clone.c.world.id, epoch: clone.c.world.epoch })); return 0;
    } else if (commandName === "fixture" && rest.length === 2) {
      const { fixtureOperation } = await import("./faults.ts");
      await fixtureOperation(stack, rest[0]!, rest[1]!);
      console.log(JSON.stringify({ fixture: rest[0], target: rest[1], state: "complete" })); return 0;
    } else if (commandName === "prepare" && rest.length === 1) {
      const { prepareSlice } = await import("./preparation.ts");
      const result = await prepareSlice(stack, configFile, rest[0]!);
      console.log(JSON.stringify(result)); return 0;
    } else if (commandName === "provision" && rest.length === 1) {
      await up(stack.c, stack.host);
      const { provisionFixture } = await import("./fixture.ts");
      const f = await provisionFixture(stack.c, configFile, rest[0]!);
      console.log(JSON.stringify({ org: f.slug, site: f.site, safe: f.company.companySafe, state: "delivered" })); return 0;
    } else if (commandName === "run" && rest[0] === "slice-zero" && (rest.length === 1 || rest.length === 3 && rest[1] === "--slug")) {
      await up(stack.c, stack.host);
      const token = randomBytes(24).toString("hex");
      await writeFile(join(candidate, "token"), token, { mode: 0o600 });
      const { runGate } = await import("./gate.ts");
      return await runGate(stack.c, rest[2] ?? "harbourline", token, configFile);
    } else throw new Error("usage: world init <id>; world create|up|stop|inspect; world show [ID]; world clock warp [WORLD] --by DURATION|--to DATE; world provision <slug>; world snapshot save|read|restore <id> [--as CONFIG]; world run slice-zero [--slug SLUG] --config FILE [--json]");
    console.log(JSON.stringify({ world: stack.c.world.id, state: commandName === "stop" ? "stopped" : "running" }));
    return 0;
  } catch (error) {
    // Nested startup/cleanup failures must retain their causes privately, without leaking argv or credentials to stdout.
    if (diagnostics) await writeFile(diagnostics, inspect(error, { depth: 10 }), { mode: 0o600 });
    const message = (error as Error).message;
    const code = ["CLI_USAGE", "INVALID_INPUT", "WRONG_STATE", "WORK_DIED"].find((declared) => message.startsWith(`${declared}:`)) ?? "WORLD_RUNTIME_ERROR";
    console.error(JSON.stringify({ error: { code, message } }));
    // Declared refusals exit with their error record's code (blueprint vocabulary: WORK_DIED 5, the others 2); undeclared failures exit 1.
    return code === "WORLD_RUNTIME_ERROR" ? 1 : code === "WORK_DIED" ? 5 : 2;
  } finally { for (const lock of locks.reverse()) await rm(lock, { recursive: true }); }
}
