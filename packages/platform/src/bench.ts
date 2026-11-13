// The shared Frappe bench as Docker resources on the platform's host: the bench's image (pinned Frappe and ERPNext
// plus the capxul app, bench/Containerfile) and the site door layered on it, one network, a persistent volume for
// MariaDB and one for the sites, and one container per process: MariaDB, Redis, the door (which also writes the
// bench's common config), web (gunicorn), the background worker and the scheduler.
//
// The image is the light bench first built in spikes/bench-clocks, not the hosted six-app image of
// packages/bench-image (no nginx, no built assets, no HR, CRM or WhatsApp): enough for the thin line's sites. Moving
// to the hosted image is a change of this file and of bench/.
import * as Docker from "@alchemy.run/docker";
import * as Alchemy from "alchemy";
import * as Arr from "effect/Array";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import { names } from "./stage.ts";

const MARIADB = "public.ecr.aws/docker/library/mariadb:11.8"; // Amazon's mirror of the official image (Docker Hub rate-limits)
const REDIS = "public.ecr.aws/docker/library/redis:7.4-alpine";
const BENCH_DIR = "/home/frappe/frappe-bench";
const WEB_PORT = 8000;
export const DOOR_PORT = 8100;

// The bench's pins, read from packages/bench-image/apps.lock.json by bin/run.sh (one owner for each pin).
const pins = Effect.all({
  BUILD_IMAGE: Config.String("PIN_BUILD_IMAGE"),
  FRAPPE_URL: Config.String("PIN_FRAPPE_URL"),
  FRAPPE_TAG: Config.String("PIN_FRAPPE_TAG"),
  FRAPPE_COMMIT: Config.String("PIN_FRAPPE_COMMIT"),
  ERPNEXT_URL: Config.String("PIN_ERPNEXT_URL"),
  ERPNEXT_COMMIT: Config.String("PIN_ERPNEXT_COMMIT"),
  HRMS_URL: Config.String("PIN_HRMS_URL"),
  HRMS_COMMIT: Config.String("PIN_HRMS_COMMIT"),
});

// Behind a TLS-inspecting proxy (an agent's container) the build uses the host network, the proxy variable and
// the proxy's CA bundle as a build secret. On a host with plain egress both are
// unset. The bundle goes by path (`--secret id=build_ca,src=…`): at 186 KB it is too long for one environment
// variable, which is how Alchemy's own `secrets` reach `docker build`. A certificate bundle is not a secret.
const buildNetwork = Effect.gen(function* () {
  const proxy = yield* Config.option(Config.String("PLATFORM_BUILD_PROXY"));
  const ca = yield* Config.option(Config.String("PLATFORM_BUILD_CA"));
  // No provenance attestation: BuildKit stamps it with the build's time, so with the containerd image store every
  // rebuild from a full cache got a new image id and every deploy replaced the bench (observed on the first runs).
  const options: string[] = [
    "--provenance=false",
    ...(Option.isSome(proxy) ? ["--network", "host"] : []),
    ...(Option.isSome(ca) ? ["--secret", `id=build_ca,src=${ca.value}`] : []),
  ];
  const args: Record<string, string> = Option.isSome(proxy)
    ? { HTTPS_PROXY: proxy.value, https_proxy: proxy.value }
    : {};
  return { options, args };
});

/**
 * The logical id of the door's signing key, an Alchemy.Random kept in the shared state. Whoever can read the platform's
 * state can mint a world's site token (src/token.ts, src/door-key.ts). A new generation (PLATFORM_DOOR_KEY_GENERATION)
 * is a new key: the door restarts with it and every token minted under the old one stops working.
 */
export const doorKeyId = Effect.map(
  Config.Int("PLATFORM_DOOR_KEY_GENERATION").pipe(Config.withDefault(1)),
  (generation) => `DoorKey-g${generation}`,
);

// The door writes the bench's common config before it serves; the other bench processes wait for that config.
const configure = Arr.join(
  [
    "bench set-config -g db_host mariadb",
    "bench set-config -g redis_cache redis://redis:6379/0",
    "bench set-config -g redis_queue redis://redis:6379/1",
    "bench set-config -g redis_socketio redis://redis:6379/2",
    "bench set-config -gp developer_mode 0",
  ],
  " && ",
);
const afterConfig = (exec: string) => [
  "bash",
  "-c",
  `until grep -q redis_socketio sites/common_site_config.json; do sleep 1; done; exec ${exec}`,
];

export const Bench = (context: Docker.Context) =>
  Effect.gen(function* () {
    const n = yield* names;
    const keyId = yield* doorKeyId;
    const doorKey = (yield* Alchemy.Random(keyId, { bytes: 32 })).text;
    const pin = yield* pins;
    const net = yield* buildNetwork;
    const appDir = yield* Config.String("PLATFORM_FRAPPE_APP_DIR");
    const dbRoot = yield* Alchemy.Random("DbRootPassword", { bytes: 24 });

    const image = yield* Docker.Image("BenchImage", {
      context,
      name: "cx-platform-bench",
      tag: n.stage,
      build: {
        context: "bench",
        dockerfile: "Containerfile",
        args: { ...pin, ...net.args },
        options: ["--build-context", `capxul-app=${appDir}`, ...net.options],
      },
    });
    const doorImage = yield* Docker.Image("DoorImage", {
      context,
      name: "cx-platform-door",
      tag: n.stage,
      build: {
        context: "door",
        dockerfile: "Containerfile",
        args: { BENCH_IMAGE: image.imageRef },
        options: ["--provenance=false"],
      },
    });

    const network = yield* Docker.Network("Network", { context, name: n.prefix });
    const db = yield* Docker.Volume("DbVolume", { context, name: `${n.prefix}-db` });
    const sites = yield* Docker.Volume("SitesVolume", { context, name: `${n.prefix}-sites` });
    const on = (alias: string) => [{ name: network.name, aliases: [alias] }];
    const sitesMount = [{ hostPath: sites.name, containerPath: `${BENCH_DIR}/sites` }];

    const mariadb = yield* Docker.Container("MariaDB", {
      context,
      name: n.container("mariadb"),
      image: MARIADB,
      command: [
        "--character-set-server=utf8mb4",
        "--collation-server=utf8mb4_unicode_ci",
        "--skip-character-set-client-handshake",
      ],
      environment: { MARIADB_ROOT_PASSWORD: dbRoot.text },
      volumes: [{ hostPath: db.name, containerPath: "/var/lib/mysql" }],
      networks: on("mariadb"),
      healthcheck: {
        cmd: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"],
        interval: "3 seconds",
        retries: 60,
      },
      restart: "unless-stopped",
      start: true,
    });
    const redis = yield* Docker.Container("Redis", {
      context,
      name: n.container("redis"),
      image: REDIS,
      networks: on("redis"),
      restart: "unless-stopped",
      start: true,
    });

    const bench = (role: string, command: string[]) =>
      Docker.Container(role, {
        context,
        name: n.container(Str.toLowerCase(role)),
        image,
        command,
        volumes: sitesMount,
        networks: on(Str.toLowerCase(role)),
        restart: "unless-stopped",
        start: true,
      });

    const doorLocalPort = yield* Config.Number("PLATFORM_DOOR_LOCAL_PORT").pipe(Config.withDefault(18100));
    const door = yield* Docker.Container("Door", {
      context,
      name: n.container("door"),
      image: doorImage,
      command: ["bash", "-c", `${configure} && exec env/bin/python -u /opt/door/door.py`],
      environment: {
        DOOR_KEY: doorKey,
        DB_ROOT_PASSWORD: dbRoot.text,
        PLATFORM_DOMAIN: n.domain,
        DOOR_PORT: `${DOOR_PORT}`,
        WEB_URL: `http://${n.container("web")}:${WEB_PORT}`,
      },
      ports: [{ external: `127.0.0.1:${doorLocalPort}`, internal: DOOR_PORT }],
      volumes: sitesMount,
      networks: on("door"),
      restart: "unless-stopped",
      start: true,
    });
    const web = yield* bench(
      "Web",
      afterConfig(
        Arr.join(
          [
            `${BENCH_DIR}/env/bin/gunicorn --chdir=${BENCH_DIR}/sites --bind=0.0.0.0:${WEB_PORT} --workers=2 --threads=4`,
            "--worker-class=gthread --worker-tmp-dir=/dev/shm --timeout=120 --preload --access-logfile=-",
            "frappe.app:application",
          ],
          " ",
        ),
      ),
    );
    const worker = yield* bench("Worker", afterConfig("bench worker --queue short,default,long"));
    const scheduler = yield* bench("Scheduler", afterConfig("bench schedule"));

    return {
      doorKeyId: keyId,
      network,
      image,
      doorLocalPort,
      volumes: [db, sites],
      containers: [mariadb, redis, door, web, worker, scheduler],
      webService: `http://${n.container("web")}:${WEB_PORT}`,
      doorService: `http://${n.container("door")}:${DOOR_PORT}`,
    };
  });
