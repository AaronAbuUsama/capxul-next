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
  /** The world box image; it must start a Docker daemon (docker:<version>-dind does). */
  readonly image: string;
  /** Share the host's network: a cloud container's agent proxy listens on the host's loopback. */
  readonly hostNetwork?: boolean;
  /** A CA bundle the box's daemon must trust (a TLS-inspecting proxy), mounted read-only. */
  readonly trustCa?: string;
  /** Environment for the box (proxy settings, never secrets: Alchemy keeps props in its state). */
  readonly environment?: Readonly<Record<string, string>>;
}

const BOX_CA = "/etc/ssl/certs/capxul-extra-ca.crt";

/** The box's start command: trust the extra CA if one is mounted, then hand over to the image's own entrypoint. */
const startCommand = (trustCa: boolean): string[] =>
  trustCa
    ? ["sh", "-c", `cat ${BOX_CA} >> /etc/ssl/certs/ca-certificates.crt && exec dockerd-entrypoint.sh`]
    : ["dockerd-entrypoint.sh"];

/** One world, one stage: its box and the volume that keeps the box's Docker data while the world is parked. */
export const dockerBoxStack = (spec: DockerBoxSpec) =>
  Alchemy.Stack(
    STACK,
    { providers: Docker.providers(), state: Alchemy.localState() },
    Effect.gen(function* () {
      const data = yield* Docker.Volume("BoxDocker", {
        labels: { "capxul.world": spec.stage.world },
      });
      const box = yield* Docker.Container("Box", {
        name: boxName(spec.stage),
        image: spec.image,
        command: startCommand(spec.trustCa !== undefined),
        environment: { DOCKER_TLS_CERTDIR: "", ...spec.environment },
        capAdd: ["ALL"],
        seccompProfile: "unconfined",
        appArmorProfile: "unconfined",
        volumes: [
          { hostPath: data.name, containerPath: "/var/lib/docker" },
          { hostPath: "/sys/fs/cgroup", containerPath: "/sys/fs/cgroup" },
          ...(spec.trustCa ? [{ hostPath: spec.trustCa, containerPath: BOX_CA, readOnly: true }] : []),
        ],
        ...(spec.hostNetwork ? { networkMode: "host" as const } : {}),
        labels: { "capxul.world": spec.stage.world, "capxul.placement": "docker" },
        restart: "no",
        start: spec.want === "running",
      });
      return { world: spec.stage.world, box: box.name, volume: data.name };
    }),
  );
