// The bench host's first-boot script (EC2 user data), as a pure function of the data volume's id so a test can read it.
// It runs once, as root, on Amazon Linux 2023:
//
// 1. Waits for the data volume (attached after the machine starts), formats it only if it holds no filesystem, and
//    mounts it at /var/lib/docker. Everything Docker keeps (images, build cache, containers, the MariaDB and sites
//    volumes) is therefore on a disk that survives restarts and a replaced machine, and goes only when the stack is
//    destroyed.
// 2. Installs Docker and makes it listen on the machine's loopback as well as its socket. Nothing outside the machine
//    can reach that port (the security group has no inbound rule); the deployer reaches it through an SSM port forward
//    (bin/forward.sh), which IAM decides who may open. The SSM agent ships with the image.
//
// A change to this script replaces the machine (EC2 runs user data only once), so it is kept to what cannot be done
// later through Docker.
import * as Arr from "effect/Array";
import * as Str from "effect/String";

export const DOCKER_LOOPBACK_PORT = 2375;
export const DATA_LABEL = "capxul-data";

/** The device name under which Amazon's NVMe driver shows an EBS volume: its id without the dash. */
export const volumeDevice = (volumeId: string) =>
  `/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_${Str.replace("-", "")(volumeId)}`;

export const userData = (volumeId: string) =>
  Arr.join(
    [
      "#!/bin/bash",
      "# Capxul bench host, first boot (packages/platform/src/user-data.ts).",
      "set -euxo pipefail",
      `DEV=${volumeDevice(volumeId)}`,
      'for _ in $(seq 1 180); do [ -e "$DEV" ] && break; sleep 5; done',
      "[ -e \"$DEV\" ] || { echo 'the data volume never appeared' >&2; exit 1; }",
      `blkid "$DEV" || mkfs.xfs -L ${DATA_LABEL} "$DEV"`,
      "mkdir -p /var/lib/docker",
      `grep -q ${DATA_LABEL} /etc/fstab || echo 'LABEL=${DATA_LABEL} /var/lib/docker xfs defaults,nofail 0 2' >>/etc/fstab`,
      "systemctl daemon-reload",
      "mount /var/lib/docker",
      "dnf install -y docker",
      "mkdir -p /etc/systemd/system/docker.service.d",
      // The engine takes its unix socket from docker.socket (`-H fd://`; Amazon Linux's docker.service has
      // Requires=docker.socket, which no drop-in can remove, so masking the socket stops the engine from starting) and
      // adds a loopback listener for bin/forward.sh. Tried on the bench host on 14 November 2026: both answer.
      "cat >/etc/systemd/system/docker.service.d/10-capxul.conf <<'UNIT'",
      "[Unit]",
      "RequiresMountsFor=/var/lib/docker",
      "[Service]",
      "ExecStart=",
      `ExecStart=/usr/bin/dockerd -H fd:// -H tcp://127.0.0.1:${DOCKER_LOOPBACK_PORT} ` +
        "--containerd=/run/containerd/containerd.sock $OPTIONS",
      "UNIT",
      "systemctl daemon-reload",
      "systemctl enable --now docker",
      "docker info --format '{{.ServerVersion}} {{.DockerRootDir}}'",
      "",
    ],
    "\n",
  );
