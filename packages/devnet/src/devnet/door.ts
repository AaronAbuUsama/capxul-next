import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { checkFiles, inventory, type FileDigest } from "./bundle.ts";
import { checkTemplate, cloneDatabase, connections, dropDatabase, renameDatabase, type Admin, type Database } from "./postgres.ts";

export { cloneDatabase, dropDatabase, psqlAdmin, type Admin } from "./postgres.ts";
export { composeBench } from "./bench.ts";
export { localRuntime, type Processes, type CoreStore } from "./runtime.ts";
export { restoreAs, runDevnet, withWorldLock } from "./command.ts";
export { listSnapshots } from "./catalogue-read.ts";
export { readConfig, databaseUrl, type Config } from "./supervisor.ts";
export { readFixture, sitesEnvironment, type FixtureState } from "./fixture.ts";
export { migrateCatalogue, worldCatalogue, type WorldCatalogue, type WorldRow, type Command, type SnapshotRow, type CatalogueCut, type CatalogueHistory, type RestoreCatalogue } from "./catalogue.ts";
export { migrateMailSink, devnetMail, type DevnetMail, type MailSend, type MailFail } from "./mail.ts";
export type Site = { company: string; name: string };
export type World = { id: string; kind: "local" | "simulated"; database: string; stateDir: string; sites: Site[]; epoch: number };
export type Cut = { nowMs: number; clockMode: "stopped" | "running"; rate: number; recordSeq: number; recordHead: string;
  heads: { org_id: string; id: number; hash: string }[] };
export type Manifest = {
  schema: "capxul-world-snapshot/2"; id: string; world: string; codeVersion: string; createdAt: string;
  source: { database: string; stateDir: string }; epoch: number; cut: Cut; database: Database; sites: Site[]; files: Record<string, FileDigest>;
  /** Stateful followers that saved their own state under this name (devnet.stateful-followers); absent on older manifests. */
  followers?: string[];
};
export type SaveOptions = { replace?: boolean; followers?: readonly string[] };
export type RestoreOptions = { followers?: readonly string[] };
/** Lifecycle hooks are owned by the host supervisor, not by the product backend. */
export type Runtime = {
  /** Read-only save precondition: never activate a stopped world. */
  running(world: World): Promise<boolean>;
  /** Close ingress, drain Core/site jobs and deliveries, stop Core/Ponder/bundler/Anvil. Anvil must finish flushing its state file. */
  quiesce(world: World): Promise<Cut | undefined>;
  /** Back up each site's MariaDB, public/private files and full site_config while every bench writer is stopped. */
  backup(site: Site, directory: string): Promise<void>;
  /** Offline restore to a site's own database credentials, keeping the saved encryption key. */
  restore(site: Site, directory: string, inPlace: boolean): Promise<void>;
  /** Rewrite site world/host, clear sessions/queues, install clock, and append DB lineage before ANY service resumes. */
  rewrite(world: World, manifest: Manifest, abandonedDatabase: string | null): Promise<void>;
  /** Start chain, Ponder and Core only after all sites/configuration are ready; then reopen ingress. */
  resume(world: World): Promise<void>;
  /** Reclose ingress and stop every writer, including after a partially failed resume. */
  hold(world: World): Promise<void>;
};
export type Options = { root: string; codeVersion: string; admin: Admin; runtime: Runtime };
const stateFiles = ["anvil-state.json", "deployment.json"];
const name = (s: string) => { if (!/^[a-z][a-z0-9_-]{0,62}$/.test(s)) throw new Error("invalid world/snapshot name"); return s; };
/** The control protocol's snapshot name: lowercase letters, digits and hyphens, up to 40 characters. */
const snapshotName = (s: string) => {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(s)) throw new Error("INVALID_INPUT: a snapshot name is lowercase letters, digits and hyphens, up to 40 characters");
  return s;
};
const followerNames = (followers: readonly string[] = []) => {
  if (followers.some((f) => typeof f !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(f))) throw new Error("INVALID_INPUT: invalid stateful follower name");
  return [...new Set(followers)].sort();
};
/** Refuses before any restore step when a follower joined now did not save its state with this snapshot. */
export function checkFollowers(manifest: Manifest, followers: readonly string[] = []): void {
  const missing = followerNames(followers).filter((f) => !(manifest.followers ?? []).includes(f));
  if (missing.length) throw new Error(`WRONG_STATE: stateful follower ${missing.join(", ")} joined now is missing from snapshot ${manifest.id}`);
}
/** Exactly `.<id>.replaced-<uuid>`. Names never contain a dot, so no other name's aside or temp can match; an invalid name has none. */
const asidesOf = async (root: string, id: string) => {
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(id)) return [];
  const exact = new RegExp(`^\\.${id}\\.replaced-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`);
  return (await readdir(root).catch(() => [] as string[])).filter((entry) => exact.test(entry));
};
/** A replace that crashed between its two renames leaves the old snapshot only as `.<id>.replaced-<uuid>`. Call under the host lock. */
async function recoverReplaced(root: string, id: string): Promise<void> {
  const final = join(root, id);
  if (await stat(join(final, "manifest.json")).then(() => true, () => false)) return;
  const aside = await asidesOf(root, id);
  if (aside.length > 1) throw new Error(`WRONG_STATE: snapshot ${id} has several interrupted replacements (${aside.join(", ")}); inspect before saving`);
  if (aside.length === 1) {
    const kept = await readFile(join(root, aside[0]!, "manifest.json"), "utf8").then((text) => JSON.parse(text) as Manifest).catch(() => undefined);
    if (kept?.id !== id) throw new Error(`WRONG_STATE: ${aside[0]} does not hold snapshot ${id}; inspect before saving`);
    await rm(final, { recursive: true, force: true }); await rename(join(root, aside[0]!), final);
  }
}
const savedNames = async (root: string) => {
  const entries = await readdir(root).catch((error) => { if (error.code === "ENOENT") return []; throw error; });
  const names: string[] = [];
  for (const entry of entries.sort()) if (!entry.startsWith(".") && await stat(join(root, entry, "manifest.json")).then(() => true, () => false)) names.push(entry);
  return names;
};
const checkCut = (c: Cut) => {
  if (!Number.isSafeInteger(c.nowMs) || !["stopped", "running"].includes(c.clockMode) || !(c.rate >= 1 && c.rate <= 60) ||
    !Number.isSafeInteger(c.recordSeq) || c.recordSeq < 0 || !/^[0-9a-f]{64}$/.test(c.recordHead) || !Array.isArray(c.heads)) throw new Error("snapshot clock/record cut is invalid");
};
const checkWorld = (w: World) => {
  name(w.id);
  if (w.kind !== "local" && w.kind !== "simulated") throw new Error("snapshot is restricted to local/simulated worlds");
  if (!isAbsolute(w.stateDir) || !Number.isSafeInteger(w.epoch) || w.epoch < 1) throw new Error("invalid world directory/epoch");
  if (new Set(w.sites.map((s) => s.company)).size !== w.sites.length || new Set(w.sites.map((s) => s.name)).size !== w.sites.length ||
    w.sites.some((s) => !/^[a-z][a-z0-9-]*$/.test(s.company) || s.name.length > 253 || !s.name.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))) throw new Error("invalid site inventory");
};

async function copyIntents(from: string, to: string, source: { id: string; sites: Site[] }, target = source): Promise<void> {
  const files = await readdir(from).catch((error) => { if (error.code === "ENOENT") return []; throw error; });
  for (const file of files) {
    const intent = JSON.parse(await readFile(join(from, file), "utf8"));
    const site = source.sites.find((s) => s.name === intent.site && s.company === intent.org);
    if (!site || intent.world !== source.id || file !== `${site.name}.json`) throw new Error("site-service intent does not belong to this world/site inventory");
    const restored = target.sites.find((s) => s.company === site.company)!;
    await mkdir(to, { recursive: true, mode: 0o700 });
    await writeFile(join(to, `${restored.name}.json`), JSON.stringify({ ...intent, world: target.id, site: restored.name }), { mode: 0o600 });
  }
}

async function locked<T>(root: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lock = join(root, ".snapshot-lock");
  try { await mkdir(lock, { mode: 0o700 }); } catch { throw new Error("another snapshot/restore holds this host's lock; inspect before clearing a stale lock"); }
  try { return await fn(); } finally { await rm(lock, { recursive: true }); }
}

export async function saveSnapshot(options: Options, world: World, id: string, save: SaveOptions = {}): Promise<Manifest> {
  checkWorld(world); snapshotName(id);
  const followers = followerNames(save.followers);
  return locked(options.root, async () => {
    const final = join(options.root, id), temp = join(options.root, `.${id}-${randomUUID()}`);
    // The host lock serializes saves; an existing name refuses before the world is touched.
    await recoverReplaced(options.root, id);
    const previous = await stat(join(final, "manifest.json")).then(() => true, () => false);
    if (previous && !save.replace) throw new Error(`WRONG_STATE: a snapshot named ${id} exists; replace was not asked`);
    if (previous) {
      // Snapshot names are host-wide: one world never replaces (and drops the template of) another world's snapshot.
      const old = await readFile(join(final, "manifest.json"), "utf8").then((text) => JSON.parse(text) as Manifest).catch(() => undefined);
      if (!old || typeof old.world !== "string" || typeof old.database?.name !== "string") throw new Error(`WRONG_STATE: snapshot ${id} has an unreadable manifest; it is not replaced`);
      if (old.id !== id) throw new Error(`WRONG_STATE: snapshot ${id}'s manifest names snapshot ${old.id}; it is not replaced`);
      if (old.world !== world.id) throw new Error(`WRONG_STATE: snapshot ${id} belongs to world ${old.world}; only that world may replace it`);
    }
    if (!await options.runtime.running(world)) throw new Error("source world must be running to establish a snapshot cut");
    let database: Database | undefined, published = false, replaced: string | undefined;
    const errors: unknown[] = [];
    try {
      await mkdir(temp, { mode: 0o700 });
      const cut = await options.runtime.quiesce(world);
      if (!cut) throw new Error("source world must be running to establish a snapshot cut");
      checkCut(cut);
      database = await cloneDatabase(options.admin, world.database, `snap_${randomUUID().replaceAll("-", "")}`);
      await mkdir(join(temp, "state"));
      for (const file of stateFiles) await copyFile(join(world.stateDir, file), join(temp, "state", file));
      await copyIntents(join(world.stateDir, "site-service"), join(temp, "site-service"), world);
      for (const site of world.sites) {
        const directory = join(temp, "sites", site.company);
        await mkdir(directory, { recursive: true });
        await options.runtime.backup(site, directory);
      }
      const manifest: Manifest = { schema: "capxul-world-snapshot/2", id, world: world.id, codeVersion: options.codeVersion,
        source: { database: world.database, stateDir: resolve(world.stateDir) }, createdAt: new Date().toISOString(), epoch: world.epoch, cut, database, sites: world.sites,
        files: await inventory(temp), ...(followers.length ? { followers } : {}) };
      await writeFile(join(temp, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
      // Rename never overwrites a non-empty directory; a replaced snapshot moves aside before the new one is published.
      if (previous) { replaced = join(options.root, `.${id}.replaced-${randomUUID()}`); await rename(final, replaced); }
      await rename(temp, final); published = true;
      if (replaced) {
        // The new snapshot is published. A cleanup failure must not report it failed; the moved-aside
        // previous snapshot keeps its manifest naming its template for operator cleanup.
        try {
          const old = JSON.parse(await readFile(join(replaced, "manifest.json"), "utf8")) as Manifest;
          // Drop only the exact fenced template the manifest recorded, never a database that merely shares its name.
          await checkTemplate(options.admin, old.database);
          await dropDatabase(options.admin, old.database.name);
          await rm(replaced, { recursive: true });
        } catch { /* retained under .<id>.replaced-* */ }
      }
      return manifest;
    } catch (error) {
      errors.push(error);
      throw error;
    } finally {
      try {
        // Each rollback step runs on its own; restoring the previous snapshot comes first.
        if (!published) for (const step of [
          async () => { if (replaced) await rename(replaced, final); },
          () => rm(temp, { recursive: true, force: true }),
          async () => { if (database) await dropDatabase(options.admin, database.name); },
        ]) {
          try { await step(); } catch (error) { errors.push(error); }
        }
      } catch (error) {
        errors.push(error);
      }
      try {
        // Attempt recovery after partial quiesce without masking its failure if resume refuses.
        await options.runtime.resume(world);
      } catch (error) {
        errors.push(error);
      }
      if (errors.length > 1) throw new AggregateError(errors, "snapshot save encountered multiple failures", { cause: errors[0] });
      if (errors.length === 1) throw errors[0];
    }
  });
}

export async function readSnapshot(options: Options, id: string): Promise<Manifest> {
  const directory = join(options.root, id);
  const text = /^[a-z0-9][a-z0-9_-]{0,62}$/.test(id) ? await readFile(join(directory, "manifest.json"), "utf8").catch((error) => { if (error.code === "ENOENT") return undefined; throw error; }) : undefined;
  if (text === undefined) {
    const aside = await asidesOf(options.root, id);
    if (aside.length) throw new Error(`WRONG_STATE: snapshot ${id} was interrupted while being replaced (${aside.join(", ")}); the next save of ${id} recovers it`);
    const saved = await savedNames(options.root);
    throw new Error(`INVALID_INPUT: no snapshot named ${JSON.stringify(id)}; saved here: ${saved.length ? saved.join(", ") : "none"}`);
  }
  const manifest = JSON.parse(text) as Manifest;
  if (manifest.schema !== "capxul-world-snapshot/2" || manifest.id !== id) throw new Error("snapshot schema/identity mismatch");
  if (manifest.codeVersion !== options.codeVersion) throw new Error(`WRONG_STATE: snapshot ${id} was saved with other backend code (${manifest.codeVersion}), not ${options.codeVersion}`);
  checkCut(manifest.cut);
  await checkFiles(directory, manifest.files);
  for (const file of stateFiles) if (!manifest.files[`state/${file}`]) throw new Error(`snapshot is missing ${file}`);
  await checkTemplate(options.admin, manifest.database);
  return manifest;
}

export async function restoreSnapshot(options: Options, id: string, target: World, restore: RestoreOptions = {}): Promise<Manifest> {
  checkWorld(target);
  return locked(options.root, async () => {
    if (/^[a-z0-9][a-z0-9_-]{0,62}$/.test(id)) await recoverReplaced(options.root, id);
    const manifest = await readSnapshot(options, id);
    checkFollowers(manifest, restore.followers);
    const companies = manifest.sites.map((s) => s.company).sort();
    if (JSON.stringify(target.sites.map((s) => s.company).sort()) !== JSON.stringify(companies)) throw new Error("a restore must include every company of the snapshot");
    if (target.database === manifest.database.name) throw new Error("cannot restore over the snapshot template");
    const inPlace = target.id === manifest.world;
    if (inPlace ? target.database !== manifest.source.database || resolve(target.stateDir) !== manifest.source.stateDir ||
      target.sites.some((s) => !manifest.sites.some((saved) => saved.company === s.company && saved.name === s.name)) :
      target.database === manifest.source.database || resolve(target.stateDir) === manifest.source.stateDir || target.sites.some((s) => manifest.sites.some((saved) => saved.name === s.name))) {
      throw new Error("restore target must use its own database, directory and sites; in-place must match the source");
    }
    const stagedName = `restore_${randomUUID().replaceAll("-", "")}`;
    await cloneDatabase(options.admin, manifest.database.name, stagedName);
    let installed = false;
    try {
      await options.runtime.quiesce(target);
      await mkdir(target.stateDir, { recursive: true, mode: 0o700 });
      const abandoned = inPlace ? `abandoned_${randomUUID().replaceAll("-", "")}` : null;
      await writeFile(join(target.stateDir, "restore-pending.json"), JSON.stringify({ snapshot: id, stagedName, abandoned }), { mode: 0o600 });
      if (inPlace) await renameDatabase(options.admin, target.database, abandoned!);
      // For a separate world, target.database must not exist. PostgreSQL enforces that without dropping data.
      await renameDatabase(options.admin, stagedName, target.database); installed = true;
      for (const file of stateFiles) await copyFile(join(options.root, id, "state", file), join(target.stateDir, file));
      await rm(join(target.stateDir, "site-service"), { recursive: true, force: true });
      await copyIntents(join(options.root, id, "site-service"), join(target.stateDir, "site-service"), { id: manifest.world, sites: manifest.sites }, target);
      for (const site of target.sites) await options.runtime.restore(site, join(options.root, id, "sites", site.company), inPlace);
      await connections(options.admin, target.database, true);
      const restored = { ...target, epoch: inPlace ? target.epoch + 1 : 1 };
      await options.runtime.rewrite(restored, manifest, abandoned);
      await options.runtime.resume(restored);
      await rm(join(target.stateDir, "restore-pending.json"));
      return manifest;
    } catch (error) {
      // Do not restart a partially restored world. Keep the marker and old DB for operator recovery.
      try { await options.runtime.hold(target); }
      finally { if (!installed) await dropDatabase(options.admin, stagedName); }
      throw error;
    }
  });
}
