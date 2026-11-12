import { createHmac } from "node:crypto";
import type { composeBench } from "./bench.ts";
import type { Cut, Manifest, Runtime, World } from "./door.ts";

type Clock = Pick<Cut, "nowMs" | "clockMode" | "rate">;
type Component = "core" | "ponder" | "bundler" | "anvil";
export type Processes = {
  /** Fence ALL mutation entrances, including direct chain/bundler access; the admin route stays reachable. */
  fence(world: World, closed: boolean): Promise<void>;
  running(world: World, component: Component): Promise<boolean>;
  /** Must await graceful exit and reject forced kills; Anvil must flush --state to anvil-state.json. */
  stop(world: World, component: Component): Promise<void>;
  /** Await readiness; Core must start with CORE_START_PAUSED=true and never migrate restored state. */
  start(world: World, component: Component): Promise<void>;
};
export type CoreStore = {
  /** Both runtime roles connect to world.database and close their pools before this returns. */
  updateClock(world: World, clock: Clock): Promise<void>;
  rewrite(world: World, input: { worldId: string; epoch: number; clock: Clock;
    lineage: { snapshot: string; parentWorld: string; recordSeq: number; recordHead: string }; sites: Record<string, string> }): Promise<void>;
};
type CoreCut = { paused: true; activeRequests: number; activeDeliveries: number; world_id: string; epoch: number;
  clock: Clock; recordSeq: number; recordHead: string; heads: Cut["heads"] };

/** Host composition: process supervision is injected because an orb and a hosted bench use different supervisors. */
export function localRuntime(options: {
  bench: ReturnType<typeof composeBench>; processes: Processes; store: CoreStore;
  core(world: World): { url: string; secret: string };
  clock(world: World): Promise<Clock>;
}): Runtime {
  const { bench, processes, store } = options;
  const admin = async (world: World, operation: "pause" | "resume") => {
    const { url, secret } = options.core(world), body = "{}";
    const response = await fetch(new URL(`/admin/snapshot/${operation}`, url), { method: "POST", body,
      headers: { "Content-Type": "application/json", "X-Capxul-Signature": createHmac("sha256", secret).update(body).digest("hex") },
      signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`Core snapshot ${operation} refused (${response.status})`);
    return await response.json() as CoreCut | { paused: false };
  };
  const stop = async (world: World) => {
    // Keep Ponder connected until the chain has stopped; it can index the last flushed block.
    for (const component of ["bundler", "core", "anvil", "ponder"] as const) await processes.stop(world, component);
  };
  return {
    running: (world) => processes.running(world, "core"),
    async quiesce(world) {
      await processes.fence(world, true);
      await bench.pause();
      let cut: Cut | undefined;
      if (await processes.running(world, "core")) {
        const clock = await options.clock(world);
        await store.updateClock(world, clock);
        const paused = await admin(world, "pause");
        if (!paused.paused || paused.activeRequests !== 0 || paused.activeDeliveries !== 0 || paused.world_id !== world.id || paused.epoch !== world.epoch) {
          throw new Error("Core did not establish this world's drained snapshot cut");
        }
        cut = { ...paused.clock, recordSeq: paused.recordSeq, recordHead: paused.recordHead, heads: paused.heads };
      }
      await stop(world);
      return cut;
    },
    backup: bench.backup,
    restore: bench.restore,
    async rewrite(world: World, manifest: Manifest) {
      const clock = { nowMs: manifest.cut.nowMs, clockMode: manifest.cut.clockMode, rate: manifest.cut.rate };
      await store.rewrite(world, { worldId: world.id, epoch: world.epoch, clock,
        lineage: { snapshot: manifest.id, parentWorld: manifest.world, recordSeq: manifest.cut.recordSeq, recordHead: manifest.cut.recordHead },
        sites: Object.fromEntries(world.sites.map((s) => [s.company, s.name])) });
      for (const site of world.sites) await bench.rewrite(site, world.id, manifest.cut);
    },
    async resume(world) {
      if (!bench.ownsPause()) throw new Error("no owned bench pause to resume; inspect the recovery guard");
      try {
        for (const component of ["anvil", "ponder", "bundler", "core"] as const) await processes.start(world, component);
        await bench.resume();
        if ((await admin(world, "resume")).paused !== false) throw new Error("Core did not resume");
        await processes.fence(world, false);
      } catch (error) {
        await this.hold(world);
        throw error;
      }
    },
    async hold(world) {
      const results = await Promise.allSettled([processes.fence(world, true), bench.hold(),
        ...(["bundler", "core", "anvil", "ponder"] as const).map((c) => processes.stop(world, c))]);
      const errors = results.filter((r) => r.status === "rejected").map((r) => r.reason);
      if (errors.length) throw new AggregateError(errors, "world remains fenced; some components could not be stopped");
    },
  };
}
