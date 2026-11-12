// The docker placement: a world's box as one container that runs its own Docker daemon, so the devnet supervisor runs
// inside it unchanged (aaron.alchemy-provisioning). No --privileged: all capabilities, unconfined seccomp and AppArmor
// and a writable cgroup tree are enough for dockerd, and Alchemy can express each of them.
import * as Alchemy from "alchemy";
import * as Docker from "@alchemy.run/docker";
import * as Effect from "effect/Effect";
import { boxName, STACK, type Want, type WorldStage } from "./stage.ts";

export interface DockerBoxSpec {
  readonly stage: WorldStage;
  readonly want: Want;
  /** The world box image; it must start a Docker daemon and trust a CA mounted at BOX_CA (box/Containerfile does). */
  readonly image: string;
  /** A CA bundle the box's daemon must trust (a TLS-inspecting proxy), mounted read-only. */
  readonly trustCa?: string;
  /** Environment for the box (proxy settings, never secrets: Alchemy keeps props in its state). */
  readonly environment?: Readonly<Record<string, string>>;
}

/** Where the box finds an extra CA to trust; box/box-start.sh adds it to the system bundle at every start. */
export const BOX_CA = "/etc/ssl/certs/capxul-extra-ca.crt";

/** One world, one stage: its box and the volume that keeps the box's Docker data while the world is parked. */
export const dockerBoxStack = (spec: DockerBoxSpec) =>
  Alchemy.Stack(
    STACK,
    { providers: Docker.providers(), state: Alchemy.localState() },
    Effect.gen(function* () {
      const data = yield* Docker.Volume("BoxDocker", {
        labels: { "capxul.world": spec.stage.world },
      });
      // The checkout and the world's own files (/work): kept when the box is replaced, as the Docker disk is.
      const work = yield* Docker.Volume("BoxWork", {
        labels: { "capxul.world": spec.stage.world },
      });
      const box = yield* Docker.Container("Box", {
        name: boxName(spec.stage),
        image: spec.image,
        environment: {
          DOCKER_TLS_CERTDIR: "",
          ...(spec.trustCa ? { NODE_EXTRA_CA_CERTS: BOX_CA } : {}),
          ...spec.environment,
        },
        capAdd: ["ALL"],
        seccompProfile: "unconfined",
        appArmorProfile: "unconfined",
        volumes: [
          { hostPath: data.name, containerPath: "/var/lib/docker" }, { hostPath: work.name, containerPath: "/work" },
          { hostPath: "/sys/fs/cgroup", containerPath: "/sys/fs/cgroup" },
          ...(spec.trustCa ? [{ hostPath: spec.trustCa, containerPath: BOX_CA, readOnly: true }] : []),
        ],
        labels: { "capxul.world": spec.stage.world, "capxul.placement": "docker" },
        restart: "no",
        // Parking stops every running world inside cleanly before the box stops (box/box-start.sh).
        stopTimeout: "5 minutes",
        start: spec.want === "running",
      });
      return { world: spec.stage.world, box: box.name, volume: data.name };
    }),
  );
