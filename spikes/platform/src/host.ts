// The one place the stack names the machine it runs on. Every Docker resource of the platform is created through this
// context, so pointing the platform at another machine is this one setting: PLATFORM_DOCKER_HOST, a Docker endpoint
// such as `unix:///var/run/docker.sock` (this machine, the default) or `ssh://deploy@bench.example.com` (a server
// with Docker and an SSH key for a `deploy` user in the `docker` group).
//
// A stage's host is fixed when the stage is created. The pinned Docker provider compares contexts by name, not by
// endpoint: a new endpoint on a live stage updates the context in place, every resource on it plans an update
// (records/05-swap-host.txt), and each container's reconcile looks for it by name on the new machine, finds nothing
// and creates it there, leaving the old machine's containers and volumes behind with no state pointing at them (read
// from the provider's source, not run). Moving to another machine is a new stage on that machine, then a destroy of
// the old one (README, "Swap the host").
import * as Docker from "@alchemy.run/docker";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { names } from "./names.ts";

export const DEFAULT_ENDPOINT = "unix:///var/run/docker.sock";

export const Host = Effect.gen(function* () {
  const n = yield* names;
  const endpoint = yield* Config.String("PLATFORM_DOCKER_HOST").pipe(Config.withDefault(DEFAULT_ENDPOINT));
  const context = yield* Docker.Context("Host", {
    name: n.prefix,
    docker: `host=${endpoint}`,
    description: `Capxul platform rehearsal, stage ${n.stage}`,
  });
  return { context, endpoint };
});
