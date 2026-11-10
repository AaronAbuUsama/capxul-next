/** The address bar as the page's state: #/, #/runs/<run>, #/runs/<run>/<step>, #/agents, #/agents/<role>. */
import { useSyncExternalStore } from "react";

const subscribe = (fn: () => void): (() => void) => { window.addEventListener("hashchange", fn); return () => window.removeEventListener("hashchange", fn); };
export const useRoute = (): string[] => useSyncExternalStore(subscribe, () => window.location.hash).replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
export const href = (...parts: string[]): string => `#/${parts.map(encodeURIComponent).join("/")}`;
export const go = (...parts: string[]): void => { window.location.hash = href(...parts); };
