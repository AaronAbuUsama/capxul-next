/** Opening the harness on a run's SQLite file, with the coding tools, the confinement and an environment that inherits nothing. */
import { existsSync } from "node:fs";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools, createBashTool, createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-durable/tools";
import type { Host, HostOptions } from "../types.ts";
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
  const [cw, cr] = [confine("write", o.policy), confine("read", o.policy)];
  registry.install(cw);
  registry.install(cr);
  const [read, write, edit, bash] = [createReadTool(), createWriteTool(), createEditTool(), createBashTool()];
  const context = BACKGROUND_CONTEXT;
  const harness = await Harness.open(await openNodeSqliteStorage(o.file), {
    models: o.models, registry, readOnly: o.readOnly ?? false,
    settings: { retry: { maxRetries: 3 }, restartLimit: 5 },
    env: ({ cwd }) => new CleanEnv(cwd ?? process.cwd(), { ...o.env }),
    identity: { attribution: null },
  }, context);
  const root = await harness.root(context);
  if (!o.readOnly) harness.resume();
  const parts = { write: { extensions: [CodingTools, cw], tools: [read, write, edit, bash] }, read: { extensions: [CodingTools, cr], tools: [read, bash] } };
  return { harness, registry, parts, root, context, close: () => harness.close(context) };
};
