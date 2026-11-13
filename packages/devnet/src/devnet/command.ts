import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { inspect } from "node:util";
import { initializeConfig } from "./local-config.ts";
import { checkCodeVersion } from "./processes.ts";
import { readConfig, stop, up, writeConfig, type Config } from "./supervisor.ts";
import { checkFollowers } from "./door.ts";
import { psqlAdmin } from "./postgres.ts";
import type { composeWorld } from "./composition.ts";

type Stack = Awaited<ReturnType<typeof composeWorld>>;
async function acquire(lock: string) {
  try { await mkdir(lock); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new Error("another world operation holds the lock; inspect before clearing a stale lock");
  }
}

/** The same exclusive `.operation` lock the CLI takes, so the control server and the CLI serialize mutations. Reads never take it. */
export async function withWorldLock<T>(c: Config, run: () => Promise<T>): Promise<T> {
  const lock = join(c.controlDir, ".operation");
  await acquire(lock);
  try { return await run(); } finally { await rm(lock, { recursive: true }); }
}

/** Restores snapshot `id` of the caller's (source-locked) stack into a distinct initialized target world. */
export async function restoreAs(stack: Stack, targetConfigFile: string, id: string, options: { followers?: readonly string[] } = {}) {
  const targetFile = resolve(targetConfigFile);
  const target = await readConfig(targetFile).catch(async (error) => {
    // readConfig's own permission check runs first; only then is a malformed id named as the caller's input error.
    const named = await readFile(targetFile, "utf8").then((text) => JSON.parse(text)?.world?.id, () => undefined);
    if (typeof named === "string" && !/^[a-z][a-z0-9]{0,11}$/.test(named)) throw new Error("INVALID_INPUT: a world id is 1 to 12 lowercase letters and digits, starting with a letter");
    throw error;
  });
  if (target.world.id === stack.c.world.id || target.world.database === stack.c.world.database) throw new Error(`INVALID_INPUT: world id ${target.world.id} is taken`);
  const taken = await psqlAdmin(stack.c.database.admin)(`SELECT row_to_json(d) FROM (SELECT 1 FROM pg_database WHERE datname='${target.world.database.replaceAll("'", "''")}') d`);
  if (taken.length || await stat(target.world.stateDir).then(() => true, () => false)) throw new Error(`INVALID_INPUT: world id ${target.world.id} is taken`);
  if (target.controlDir === stack.c.controlDir) throw new Error("--as requires a distinct initialized target world");
  const manifest = await stack.read(id);
  checkFollowers(manifest, options.followers);
  if (target.snapshots !== stack.c.snapshots || target.codeVersion !== stack.c.codeVersion || new URL(target.database.admin).host !== new URL(stack.c.database.admin).host ||
      Object.values(target.ports).some((port) => Object.values(stack.c.ports).includes(port))) throw new Error("clone must share this host's snapshot/code version and use separate ports");
  return withWorldLock(target, async () => {
    target.world.sites = manifest.sites.map((site) => ({ company: site.company, name: `${site.company}-${target.world.id}.${target.bench.baseDomain}` }));
    // Native site backups keep the source delivery secret and encryption key; implicit rekey is not recovery.
    target.secret = stack.c.secret;
    await writeConfig(targetFile, target);
    const { composeWorld } = await import("./composition.ts");
    const clone = await composeWorld(targetFile);
    await clone.host.benchUp();
    await clone.restore(id);
    return { snapshot: manifest.id, world: clone.c.world.id, epoch: clone.c.world.epoch };
  });
}

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
    if (!nested) { await acquire(candidate); locks.push(candidate); }
    if (commandName !== "stop") await checkCodeVersion(config);
    const { composeWorld, createWorld } = await import("./composition.ts");
    if (commandName === "create" && !rest.length) { await createWorld(configFile); console.log(JSON.stringify({ state: "running" })); return 0; }
    const stack = await composeWorld(configFile);
    if (commandName === "up" && !rest.length) await up(stack.c, stack.host);
    else if (commandName === "stop" && !rest.length) await stop(stack.c, stack.host);
    else if (commandName === "inspect" && !rest.length) { console.log(JSON.stringify(await stack.inspect())); return 0; }
    else if (commandName === "snapshot" && rest.length === 2 && ["save", "read", "restore"].includes(rest[0]!)) {
      const manifest = await stack[rest[0] as "save" | "read" | "restore"](rest[1]!);
      console.log(JSON.stringify({ id: manifest.id, world: manifest.world, epoch: manifest.epoch, cut: manifest.cut })); return 0;
    } else if (commandName === "snapshot" && rest.length === 4 && rest[0] === "restore" && rest[2] === "--as") {
      console.log(JSON.stringify(await restoreAs(stack, rest[3]!, rest[1]!))); return 0;
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
    } else throw new Error("usage: world init <id>; world create|up|stop|inspect; world show [ID]; world provision <slug>; world snapshot save|read|restore <id> [--as CONFIG]; world run slice-zero [--slug SLUG] --config FILE [--json]");
    console.log(JSON.stringify({ world: stack.c.world.id, state: commandName === "stop" ? "stopped" : "running" }));
    return 0;
  } catch (error) {
    // Nested startup/cleanup failures must retain their causes privately, without leaking argv or credentials to stdout.
    if (diagnostics) await writeFile(diagnostics, inspect(error, { depth: 10 }), { mode: 0o600 });
    const message = (error as Error).message;
    const code = message.startsWith("CLI_USAGE:") ? "CLI_USAGE" : message.startsWith("INVALID_INPUT:") ? "INVALID_INPUT" : "WORLD_RUNTIME_ERROR";
    console.error(JSON.stringify({ error: { code, message } }));
    // Declared input refusals exit 2 (blueprint vocabulary); undeclared runtime failures exit 1.
    return code === "WORLD_RUNTIME_ERROR" ? 1 : 2;
  } finally { for (const lock of locks.reverse()) await rm(lock, { recursive: true }); }
}
