// The hub's stack: one Worker and its three container-backed Durable Object classes, deployed ONCE; every "world" of
// the prototype is then a Durable Object name plus a Neon branch made by the measuring scripts.
//
// Stack "CapxulSpikeWorldSpeed", stages "ws-*", state kept on this machine (.alchemy/, never committed). The images
// are the ones packages/world already published, referenced by digest, so nothing is built:
//   WS_MODE=fleet   each class has its own container application (as packages/world does per world)
//   WS_MODE=native  schedulingPolicy "durable_object": the application belongs to the class, the image is chosen at start
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const ref = (repository: string, digest: string) => `registry.cloudflare.com/${account}/${repository}@sha256:${digest}`;
const ANVIL = ref("capxulworld-anvil", "bb1777935f5ffaf6966cae1770807090823671b0cd2b0ea3fdc7ba88f0e15474");
const PONDER = ref("capxulworld-ponder", "46acfce74583a150332ef0343c34d3ecac012452d3263fbc02f10c26549dace9");
const ALTO = ref("capxulworld-alto", "2980e3139ccc5b9ee40246d313c59674b7916d11ed7c701d4de7b650b191f916");

const mode = process.env.WS_MODE === "native" ? "native" : "fleet";
const token = Redacted.make(process.env.WS_HUB_TOKEN ?? "");

const fleetEnv = () => ({
  ChainBox: Cloudflare.Container("Anvil", {
    image: ANVIL,
    className: "ChainBox",
    instanceType: "lite",
    maxInstances: 10,
    observability: { logs: { enabled: true } },
  }),
  IndexBox: Cloudflare.Container("Ponder", {
    image: PONDER,
    className: "IndexBox",
    instanceType: "basic",
    maxInstances: 10,
    constraints: { regions: ["WEUR"] },
    observability: { logs: { enabled: true } },
  }),
  BundlerBox: Cloudflare.Container("Alto", {
    image: ALTO,
    className: "BundlerBox",
    instanceType: "basic",
    maxInstances: 10,
    observability: { logs: { enabled: true } },
  }),
});

const nativeEnv = () => ({
  ChainBox: Cloudflare.DurableObject("ChainBox", {
    containers: [Cloudflare.Container("Anvil", { schedulingPolicy: "durable_object", image: ANVIL })],
  }),
  IndexBox: Cloudflare.DurableObject("IndexBox", {
    containers: [Cloudflare.Container("Ponder", { schedulingPolicy: "durable_object", image: PONDER })],
  }),
  BundlerBox: Cloudflare.DurableObject("BundlerBox", {
    containers: [Cloudflare.Container("Alto", { schedulingPolicy: "durable_object", image: ALTO })],
  }),
});

export default Alchemy.Stack(
  "CapxulSpikeWorldSpeed",
  { providers: Cloudflare.providers(), state: Alchemy.localState() },
  Effect.gen(function* () {
    const hub = yield* Cloudflare.Worker("Hub", {
      main: `${import.meta.dirname}/src/hub.ts`,
      observability: { enabled: true },
      env: { HUB_TOKEN: token, ...(mode === "native" ? nativeEnv() : fleetEnv()) },
    } as never);
    return { url: (hub as { url?: unknown }).url, mode };
  }),
);
