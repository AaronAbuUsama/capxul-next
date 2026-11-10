import { isRecord, readField } from "./protocol/primitives/record.ts";

interface WindowLike {
  readonly localStorage?: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  };
}

type BrowserStorage = NonNullable<WindowLike["localStorage"]>;

/**
 * The browser's `localStorage`, when this runtime has one. The DOM lib types
 * `window` as always present; outside a browser it is absent, so it is read
 * as unknown and checked here.
 */
export function globalLocalStorage(): BrowserStorage | undefined {
  const storage = readField(readField(globalThis, "window"), "localStorage");
  return isBrowserStorage(storage) ? storage : undefined;
}

function isBrowserStorage(value: unknown): value is BrowserStorage {
  return (
    isRecord(value) &&
    typeof value.getItem === "function" &&
    typeof value.setItem === "function" &&
    typeof value.removeItem === "function"
  );
}
