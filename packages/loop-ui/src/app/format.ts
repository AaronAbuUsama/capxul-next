/** How numbers and times read on the page. */
export const tokens = (n: number): string => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : String(n);
export const duration = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
};
export const clock = (at: number | string | null): string => at === null ? "" : new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
export const firstLine = (text: string, cap = 96): string => { const l = text.split("\n")[0] ?? ""; return l.length > cap ? `${l.slice(0, cap - 1)}…` : l; };
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
