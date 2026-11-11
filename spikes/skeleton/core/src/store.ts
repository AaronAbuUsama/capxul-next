// Tiny JSON file persistence. Writes are atomic (temp file + rename) so a crash never leaves half a file.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.ts";

export function loadJson<T>(name: string, fallback: T): T {
  const path = `${config.stateDir}/${name}`;
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function saveJson(name: string, value: unknown): void {
  const path = `${config.stateDir}/${name}`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2));
  renameSync(`${path}.tmp`, path);
}
