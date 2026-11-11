export type Service = { name: string; command: string; match: RegExp; port?: number; cwd?: string; prepare?: string };
export type Process = { pid: number; pgid?: number; command: string; cwd: string; started: number; ports: number[] };
export type Saved = { pid: number; command: string; checkout: string; started: number };
export type Result = { ok: true } | { ok: false; error: string };
export interface Ports {
  root: string;
  worktree: boolean;
  now(): number;
  table(): Promise<Process[]>;
  read(name: string): Saved | undefined;
  save(name: string, value: Saved): void;
  remove(name: string): void;
  prepare(command: string, cwd: string): Promise<void>;
  spawn(service: Service): Promise<number>;
  signal(pid: number, signal: "SIGTERM" | "SIGKILL", group: boolean): void;
  sleep(ms: number): Promise<void>;
  answering(port: number): Promise<boolean>;
  say(line: string): void;
}
