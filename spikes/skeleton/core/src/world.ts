// A WORLD is one chain with every company on it, sharing one clock (the owner's word, 10 November). This process runs in one world: its name
// comes from CAPXUL_WORLD (set by main.ts from --world; default `main`), and the world's own state directory, chain, and Core are chosen by the
// same loader (see worlds.ts). The world's clock is an offset from the host's time (state/clock.json): world time = host time + offset, a
// running clock. `world clock set|advance` tells the chain and every site of the world the same offset (clock.ts).
import { loadJson, saveJson } from "./store.ts";

export const world = process.env.CAPXUL_WORLD ?? "main";
// A company's site: `acme.localhost` in the default world, `acme.<world>.localhost` in any other (the world is in the name).
export const siteOf = (slug: string): string => (world === "main" ? `${slug}.localhost` : `${slug}.${world}.localhost`);

type Clock = { offsetMs: number; changedAt: string; rate?: number };
export const clock = (): Clock => loadJson<Clock>("clock.json", { offsetMs: 0, changedAt: "" });
export const offsetMs = (): number => clock().offsetMs;
export const worldNowMs = (): number => Date.now() + offsetMs();
export const worldIso = (): string => new Date(worldNowMs()).toISOString();
export function setOffset(ms: number): void { saveJson("clock.json", { ...clock(), offsetMs: ms, changedAt: new Date().toISOString() }); }
