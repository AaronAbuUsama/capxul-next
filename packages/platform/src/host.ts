// The one place the platform stack names the machine the bench runs on. Every Docker resource of the platform is
// created through this context, so the stack is the same on every machine; only the context's endpoint differs.
//
// PLATFORM_HOST picks the machine:
// - `standin` (the default): a Docker engine the deployer reaches itself, PLATFORM_DOCKER_HOST, by default this
//   machine's own (`unix:///var/run/docker.sock`). The rehearsals run here.
// - `aws`: the bench host of host.run.ts. It accepts no inbound traffic, so its Docker engine, which listens on the
//   machine's loopback only, is reached through an SSM port forward that bin/forward.sh opens on the deployer's
//   loopback (`tcp://127.0.0.1:<PLATFORM_FORWARD_PORT>`). Who may open the forward is decided by IAM.
//
// A stage's host is fixed when the stage is created. The pinned Docker provider compares contexts by name, not by
// endpoint: a new endpoint on a live stage plans an update of every resource on it, and each container is then created
// on the new machine with the old machine's containers and volumes left behind with no state (records/spike/05).
// Moving machines is a new stage, then a destroy of the old one.
//
// A Docker context lives in the deployer's ~/.docker, not in the shared state, so a fresh CI runner has none.
// bin/run.sh creates it, with exactly this name, endpoint and description, before any alchemy command, so that a plan
// or a drift check from a fresh machine sees the context in sync.
import * as Docker from "@alchemy.run/docker";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { names } from "./stage.ts";

export const DEFAULT_ENDPOINT = "unix:///var/run/docker.sock";
export const DEFAULT_FORWARD_PORT = 23750;

export const hostKind = Config.Literals(["standin", "aws"], "PLATFORM_HOST").pipe(Config.withDefault("standin"));

/** The Docker endpoint of the platform's machine, as the deployer reaches it. */
export const endpoint = Effect.gen(function* () {
  const kind = yield* hostKind;
  if (kind === "aws") {
    const port = yield* Config.Port("PLATFORM_FORWARD_PORT").pipe(Config.withDefault(DEFAULT_FORWARD_PORT));
    return `tcp://127.0.0.1:${port}`;
  }
  return yield* Config.String("PLATFORM_DOCKER_HOST").pipe(Config.withDefault(DEFAULT_ENDPOINT));
});

/** The description bin/run.sh gives the context too; the two must agree, or a fresh machine plans an update. */
export const contextDescription = (stage: string) => `Capxul platform, stage ${stage}`;

export const Host = Effect.gen(function* () {
  const n = yield* names;
  const kind = yield* hostKind;
  const docker = yield* endpoint;
  const context = yield* Docker.Context("Host", {
    name: n.prefix,
    docker: `host=${docker}`,
    description: contextDescription(n.stage),
  });
  return { context, endpoint: docker, kind };
});
