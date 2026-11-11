/** Opening the harness on a run's SQLite file, with the coding tools, the confinement and an environment that inherits nothing. */
import { existsSync } from "node:fs";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createRegistry, Harness, type ToolRegistration } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools, createBashTool, createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-durable/tools";
import type { CodingTool, Host, HostOptions, Part, ProfileSpec } from "../types.ts";
import { confine } from "./policy.ts";

/** A local environment whose commands see exactly `clean` and the call's own variables, never the process's. */
class CleanEnv extends NodeExecutionEnv {
  readonly #clean: Record<string, string>;
  constructor(cwd: string, clean: Record<string, string>) { super({ cwd }); this.#clean = clean; }
  override exec: NodeExecutionEnv["exec"] = (command, options, context) =>
    super.exec(command, { ...options, inheritEnv: false, env: { ...this.#clean, ...options?.env } }, context);
}

export const openHost = async (o: HostOptions): Promise<Host> => {
  // Opening SQLite creates the file, and the folder with it: a reader must find the storage, never make one.
  if (o.readOnly && !existsSync(o.file)) throw new Error(`there is no storage at ${o.file}: a reader does not create one`);
  const registry = createRegistry();
  registry.install(CodingTools);
  const coding: Readonly<Record<CodingTool, ToolRegistration>> = { read: createReadTool(), write: createWriteTool(), edit: createEditTool(), bash: createBashTool() };
  const also = o.policy.tools ?? [];
  const specs: Readonly<Record<string, ProfileSpec>> = {
    ...o.profiles,
    write: { tools: ["read", "write", "edit", "bash"], bash: o.policy.bash.write, also, writes: true },
    read: { tools: ["read", "bash"], bash: o.policy.bash.read, also },
  };
  // Every profile's confinement is installed before the harness opens, so a conversation that is resumed finds its own.
  const profiles = new Map<string, Part>(Object.entries(specs).map(([name, spec]) => {
    const held = confine(name, { bash: spec.bash, denyWrite: o.policy.denyWrite, tools: spec.also, writes: spec.writes, hints: o.policy.hints });
    registry.install(held);
    return [name, { extensions: [CodingTools, held], tools: spec.tools.map((t) => coding[t]) }];
  }));
  const context = BACKGROUND_CONTEXT;
  const harness = await Harness.open(await openNodeSqliteStorage(o.file), {
    models: o.models, registry, readOnly: o.readOnly ?? false,
    settings: { retry: o.retry ?? { maxRetries: 3 }, restartLimit: 5 },
    env: ({ cwd }) => o.envFor?.(cwd ?? process.cwd()) ?? new CleanEnv(cwd ?? process.cwd(), { ...o.env }),
    identity: { attribution: null },
  }, context);
  const root = await harness.root(context);
  if (!o.readOnly) harness.resume();
  return { harness, registry, parts: { write: profiles.get("write")!, read: profiles.get("read")! }, profiles, root, context, notes: new Map(), close: () => harness.close(context) };
};

export const hostAs = (host: Host, name: string): Host | undefined => {
  const part = host.profiles.get(name);
  return part ? { ...host, parts: { write: part, read: part } } : undefined;
};
