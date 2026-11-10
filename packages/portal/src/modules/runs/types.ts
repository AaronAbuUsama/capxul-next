/**
 * The runs module: what is under `/runs/` is the loop's host, passed through. `types.ts` is the whole of it: where the
 * host is, which host names the portal answers to, and the two things a server hands over (a request, an upgrade).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

/** Everything the loop's host answers is under this path. */
export const RUNS_PREFIX = "/runs/";
/** Where `pnpm loop serve` listens unless told otherwise. */
export const DEFAULT_HOST_PORT = 4392;

export interface PassOptions {
  /** The port of the loop's host on 127.0.0.1. */
  readonly port: number;
  /** The `host` values the portal answers to, such as `127.0.0.1:4391`; a request that names another is refused. */
  readonly hosts: readonly string[];
}

export interface Pass {
  /** True when the path is the host's to answer. */
  readonly owns: (path: string) => boolean;
  /** Hands an HTTP request to the host and its answer back. */
  readonly request: (req: IncomingMessage, res: ServerResponse) => void;
  /** Hands a WebSocket upgrade to the host and joins the two sockets. */
  readonly upgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
}
