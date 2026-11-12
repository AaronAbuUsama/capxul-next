// The provisioner's command line, its composition root: the only place that reads argv and the environment.
//   provisioner deploy|park|resume|destroy <world> [--placement docker]
import { resolve } from "node:path";
import * as Effect from "effect/Effect";
import { provisioner, type Placement } from "./provisioner/door.ts";

const VERBS = ["deploy", "park", "resume", "destroy"] as const;
type Verb = (typeof VERBS)[number];

const usage = "usage: provisioner deploy|park|resume|destroy <world> [--placement docker]";

const main = async (argv: readonly string[]): Promise<number> => {
  const [verb, world, ...rest] = argv;
  if (!VERBS.includes(verb as Verb) || world === undefined) {
    process.stderr.write(`${usage}\n`);
    return 2;
  }
  const flag = rest.indexOf("--placement");
  const placement = (flag >= 0 ? rest[flag + 1] : "docker") as Placement;
  const root = resolve(import.meta.dirname, "../../..");
  const env = process.env;
  const proxy = Object.fromEntries(
    ["HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy"]
      .filter((k) => env[k] !== undefined)
      .map((k) => [k, env[k] as string]),
  );
  const p = provisioner(placement, {
    stateDir: env.CAPXUL_PROVISIONER_STATE ?? resolve(root, "var/provisioner"),
    image: env.CAPXUL_WORLD_BOX_IMAGE ?? "docker:28-dind",
    // A cloud container reaches the internet through a proxy on its own loopback, with its own CA.
    ...(Object.keys(proxy).length ? { hostNetwork: true, environment: proxy } : {}),
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
