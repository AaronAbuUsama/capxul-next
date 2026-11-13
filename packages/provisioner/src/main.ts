// The provisioner's command line, its composition root: the only place that reads argv and the environment.
//   provisioner deploy|park|resume|destroy <world> [--placement none|docker|e2b]
// The placement comes from --placement, else CAPXUL_WORLD_PLACEMENT. A box is optional (aaron.sandbox-optional): with
// none configured the world runs straight on the machine under the devnet supervisor, and this command does nothing.
import { resolve } from "node:path";
import * as Effect from "effect/Effect";
import { placementFrom, provisioner } from "./provisioner/door.ts";

const VERBS = ["deploy", "park", "resume", "destroy"] as const;
type Verb = (typeof VERBS)[number];

const usage = "usage: provisioner deploy|park|resume|destroy <world> [--placement none|docker|e2b]";

const main = async (argv: readonly string[]): Promise<number> => {
  const [verb, world, ...rest] = argv;
  if (!VERBS.includes(verb as Verb) || world === undefined) {
    process.stderr.write(`${usage}\n`);
    return 2;
  }
  const env = process.env;
  const flag = rest.indexOf("--placement");
  const placement = placementFrom(flag >= 0 ? (rest[flag + 1] ?? "") : env.CAPXUL_WORLD_PLACEMENT);
  if (placement === "none") {
    const note = "no box configured: the world runs on this machine under the devnet supervisor; nothing to provision";
    process.stdout.write(`${JSON.stringify({ verb, world, placement, note }, null, 2)}\n`);
    return 0;
  }
  if (placement === "e2b" && !env.E2B_API_KEY) {
    process.stderr.write("the e2b placement needs E2B_API_KEY in the environment\n");
    return 2;
  }
  const root = resolve(import.meta.dirname, "../../..");
  // A box keeps its own network, so the Docker inside it owns its own firewall rules. When this host reaches the
  // internet through a proxy on its loopback (a Claude cloud container), CAPXUL_BOX_PROXY is that proxy as the box sees
  // it (bin/proxy-relay.mjs serves it on the Docker bridge).
  const boxProxy = env.CAPXUL_BOX_PROXY;
  const proxy: Record<string, string> = boxProxy
    ? {
        HTTPS_PROXY: boxProxy,
        HTTP_PROXY: boxProxy,
        https_proxy: boxProxy,
        http_proxy: boxProxy,
        NO_PROXY: "localhost,127.0.0.1,.localhost,host.docker.internal",
        no_proxy: "localhost,127.0.0.1,.localhost,host.docker.internal",
      }
    : {};
  const p = provisioner(placement, {
    stateDir: env.CAPXUL_PROVISIONER_STATE ?? resolve(root, "var/provisioner"),
    image: env.CAPXUL_WORLD_BOX_IMAGE ?? "capxul-world-box:dev",
    ...(boxProxy ? { environment: proxy } : {}),
    ...(env.CAPXUL_BOX_TRUST_CA ? { trustCa: env.CAPXUL_BOX_TRUST_CA } : {}),
  });
  const applied = await Effect.runPromise(p[verb as Verb](world));
  process.stdout.write(`${JSON.stringify({ verb, world, placement, ...applied }, null, 2)}\n`);
  return 0;
};

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`);
    process.exit(1);
  },
);
