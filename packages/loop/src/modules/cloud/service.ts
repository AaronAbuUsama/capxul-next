/** GENERIC. The door of the cloud module: reach a box by its link, start one, serve one. See types.ts and README.md. */
export { boxOf } from "./internal/box.ts";
export { answers, cloudflare, docker, nameOf, running } from "./internal/launch.ts";
export { serveBox, type ServerOptions } from "./internal/server.ts";
export type * from "./types.ts";
