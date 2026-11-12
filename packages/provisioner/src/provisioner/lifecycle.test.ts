// The docker placement's whole life through Alchemy: deploy, Docker works inside, park keeps the disk, resume,
// redeploy changes nothing, destroy leaves nothing. Opt-in: needs a Docker daemon. Set CAPXUL_PROVISIONER_DOCKER=1;
// behind a TLS-inspecting proxy also set CAPXUL_BOX_TRUST_CA to its CA bundle.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { provisioner } from "./door.ts";

const enabled = process.env.CAPXUL_PROVISIONER_DOCKER === "1";
const docker = (...args: string[]) => {
  try {
    return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    throw new Error(`docker ${args.join(" ")}: ${String((error as { stderr?: unknown }).stderr ?? error)}`);
  }
};
const inBox = (box: string, ...args: string[]) => docker("exec", box, "docker", ...args);
const waitForDaemon = (box: string) => {
  for (let i = 0; i < 60; i++) {
    try {
      inBox(box, "info");
      return;
    } catch {
      execFileSync("sleep", ["1"]);
    }
  }
  throw new Error("the box's Docker daemon never answered");
};

test("a world box lives and dies as an Alchemy stage", { skip: !enabled && "set CAPXUL_PROVISIONER_DOCKER=1" }, async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "provisioner-"));
  const env = process.env;
  const p = provisioner("docker", {
    stateDir,
    image: "docker:28-dind",
    ...(env.CAPXUL_BOX_TRUST_CA ? { trustCa: env.CAPXUL_BOX_TRUST_CA } : {}),
  });
  const world = `life${process.pid % 100000000}`;
  try {
    const made = await Effect.runPromise(p.deploy(world));
    assert.equal(made.summary.create, 2);
    const box = made.output?.box ?? assert.fail("deploy returned no box");
    waitForDaemon(box);
    // A volume of the box's own daemon lives on the box's disk; no registry pull, so no rate limit.
    inBox(box, "volume", "create", "kept-across-park");

    const parked = await Effect.runPromise(p.park(world));
    assert.equal(parked.summary.update, 1);
    assert.equal(docker("inspect", "-f", "{{.State.Status}}", box), "exited");

    await Effect.runPromise(p.resume(world));
    assert.equal(docker("inspect", "-f", "{{.State.Status}}", box), "running");
    waitForDaemon(box);
    assert.match(inBox(box, "volume", "ls", "--format", "{{.Name}}"), /kept-across-park/, "the disk survived parking");

    const again = await Effect.runPromise(p.deploy(world));
    assert.equal(again.summary.noop, 2, "a second deploy changes nothing");
  } finally {
    const gone = await Effect.runPromise(p.destroy(world));
    assert.equal(gone.summary.delete, 2);
    assert.equal(docker("ps", "-a", "--filter", `name=capxul-world-${world}`, "--format", "{{.Names}}"), "");
    rmSync(stateDir, { recursive: true, force: true });
  }
});
