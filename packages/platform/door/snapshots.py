"""A world's sites in its snapshots (blueprint decisions.md, 17): the bench's half of saving a world and restoring it
into a new one. door.py checks the tokens; this does the work.

A backup is every ready site of a world, saved under the snapshot's name: `bench backup` of its database, and what
its own site_config.json must carry over (the encryption key, which decrypts what the site stored encrypted). It lives
in the door's registry folder, `<REGISTRY>/backups/<world>/<snapshot>/<label>/`, and goes when the world's sites go
(`DELETE /world`). Saving under a name already held replaces it.

A restore makes, for each site of a backup, a new site of the token's world with the same label: a new site whose
database starts from the backup (`bench new-site --source-sql`), with the backup's encryption key, joined to the new
world (`capxul.world.rewrite`: its clock's world and its host name), set to the new world's clock, its own API user
given the new world's credential, and its scheduler on. The source world's token must be shown too, so a world restores
only backups it was let read.
"""

import glob
import json
import os
import re
import secrets
import shutil
import subprocess
import threading
import time

from sites import (BENCH, DB_ROOT, DOMAIN, REGISTRY, REGISTRY_LOCK, Refused, BENCH_LOCK, bench, entries_of, read_entry,
                   update_entry, write_entry)

SNAPSHOT = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
BACKUPS = f"{REGISTRY}/backups"

# Gives the site's own API user (made by sites.make_core_user in the world the site was saved in) the new world's
# credential. The key and secret reach it through its environment, never its arguments.
CORE_CREDENTIAL_SCRIPT = """
import os, frappe
frappe.init(site=os.environ["SITE"], sites_path=".")
frappe.connect()
user = frappe.get_doc("User", os.environ["CORE_USER"])
user.api_key = os.environ["CORE_KEY"]
user.api_secret = os.environ["CORE_SECRET"]
user.flags.ignore_permissions = True
user.save(ignore_permissions=True)
frappe.db.commit()
print(user.name)
"""


def _snapshot_dir(world, snapshot):
    if not SNAPSHOT.match(snapshot or ""):
        raise Refused(400, "snapshot-invalid", "1 to 63 of a-z, 0-9 and -")
    return f"{BACKUPS}/{world}/{snapshot}"


def _label_of(site, world):
    suffix = f"-{world}.{DOMAIN}"
    return site[: -len(suffix)] if site.endswith(suffix) else None


def _job_path(world, snapshot):
    return f"{_snapshot_dir(world, snapshot)}.job.json"


def _write_job(world, snapshot, job):
    path = _job_path(world, snapshot)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(f"{path}.tmp", "w") as f:
        json.dump(job, f)
    os.rename(f"{path}.tmp", path)


def start_backup(c, body):
    """Starts backing up every ready site of the token's world under `snapshot` and answers at once (202): a backup
    of a site with its files can outlast the 100 s Cloudflare allows a request through the tunnel. The caller asks
    `backup_state` until it is `saved` or `failed`."""
    world, snapshot = c["world"], body.get("snapshot")
    _snapshot_dir(world, snapshot)
    held = entries_of(world)
    if any(e.get("state") != "ready" for e in held):
        raise Refused(409, "site-not-ready", "every site of the world must be ready to be saved")
    _write_job(world, snapshot, {"state": "saving", "started_at": int(time.time())})

    def run():
        started = time.monotonic()
        try:
            saved = _backup(world, snapshot, held)
            job = {"state": "saved", "sites": saved, "ms": int((time.monotonic() - started) * 1000)}
        except Refused as r:
            job = {"state": "failed", "error": f"{r.code}: {r.detail}"[:600]}
        except Exception as e:  # noqa: BLE001 -- recorded for the caller, never a secret
            job = {"state": "failed", "error": repr(e)[-600:].replace(DB_ROOT, "<root>")}
        _write_job(world, snapshot, job)

    threading.Thread(target=run, daemon=True).start()
    return {"world": world, "snapshot": snapshot, "state": "saving"}


def backup_state(c, snapshot):
    """Where the token's world's backup `snapshot` is: saving, saved (with its sites) or failed (with why)."""
    try:
        with open(_job_path(c["world"], snapshot)) as f:
            return {"world": c["world"], "snapshot": snapshot, **json.load(f)}
    except FileNotFoundError:
        raise Refused(404, "backup-not-found", f"{c['world']} has no backup {snapshot} under way or done") from None


def tidy_backups():
    """A backup left `saving` by a door that stopped half-way is not being made any more."""
    for path in glob.glob(f"{BACKUPS}/*/*.job.json"):
        with open(path) as f:
            job = json.load(f)
        if job.get("state") == "saving":
            with open(path, "w") as f:
                json.dump({**job, "state": "failed", "error": "the door restarted while it was saving"}, f)


def _backup(world, snapshot, held):
    """Backs up every site of `held` (all ready) under `snapshot`, replacing a backup of that name."""
    target = _snapshot_dir(world, snapshot)
    ready = [e for e in held if e.get("state") == "ready"]
    staging = f"{target}.saving-{secrets.token_hex(4)}"
    saved = []
    with BENCH_LOCK:
        try:
            for entry in ready:
                site, label = entry["site"], _label_of(entry["site"], world)
                folder = f"{staging}/{label}"
                os.makedirs(folder, exist_ok=True)
                _, ms = bench("--site", site, "backup", "--backup-path", folder)
                dumps = glob.glob(f"{folder}/*-database.sql.gz")
                if len(dumps) != 1:
                    raise Refused(500, "backup-failed", f"{site}: {len(dumps)} database dumps")
                with open(f"{BENCH}/sites/{site}/site_config.json") as f:
                    key = json.load(f).get("encryption_key")
                meta = {"site": site, "label": label, "company": entry.get("company"), "dump": os.path.basename(dumps[0]),
                        "encryption_key": key, "saved_at": int(time.time())}
                with open(f"{folder}/meta.json", "w") as f:
                    json.dump(meta, f)
                for extra in glob.glob(f"{folder}/*"):
                    if not extra.endswith(("-database.sql.gz", "meta.json")):
                        os.remove(extra)
                saved.append({"site": site, "label": label, "ms": ms, "bytes": os.path.getsize(dumps[0])})
            shutil.rmtree(target, ignore_errors=True)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            if saved:
                os.rename(staging, target)
        finally:
            shutil.rmtree(staging, ignore_errors=True)
    print(f"door: {world} saved {len(saved)} sites as {snapshot}", flush=True)
    return saved


def restore_world(c, source, body):
    """Starts restoring every site of `source`'s backup `snapshot` into the token's world; answers them, creating."""
    folder = _snapshot_dir(source["world"], body.get("snapshot"))
    key, secret, clock = body.get("api_key", ""), body.get("api_secret", ""), body.get("clock") or {}
    metas = []
    for path in sorted(glob.glob(f"{folder}/*/meta.json")):
        with open(path) as f:
            metas.append({**json.load(f), "folder": os.path.dirname(path)})
    if not metas:
        raise Refused(404, "backup-not-found", f"{source['world']} saved no site as {body.get('snapshot')}")
    made = []
    with REGISTRY_LOCK:
        held = entries_of(c["world"])
        if len(held) + len(metas) > c["quota"]:
            raise Refused(403, "site-quota-reached", f"world {c['world']} holds {len(held)} of {c['quota']}")
        for meta in metas:
            site = f"{meta['label']}-{c['world']}.{DOMAIN}"
            if read_entry(site) is not None or os.path.exists(f"{BENCH}/sites/{site}"):
                raise Refused(409, "site-exists", site)
            entry = {"site": site, "world": c["world"], "company": meta.get("company"), "state": "creating", "steps": [],
                     "ms": None, "error": None, "asked_at": int(time.time()), "restored_from": meta["site"]}
            write_entry(entry)
            made.append((entry, meta))
    for entry, meta in made:
        threading.Thread(target=_restore, args=(entry["site"], c["world"], meta, key, secret, clock), daemon=True).start()
    return {"world": c["world"], "from": source["world"], "snapshot": body.get("snapshot"),
            "sites": [{"site": e["site"], "from": m["site"], "state": "creating"} for e, m in made]}


def _restore(site, world, meta, key, secret, clock):
    def credential():
        env = {**os.environ, "SITE": site, "CORE_USER": "capxul-core@service.invalid", "CORE_KEY": key,
               "CORE_SECRET": secret}
        out = subprocess.run([f"{BENCH}/env/bin/python", "-c", CORE_CREDENTIAL_SCRIPT], cwd=f"{BENCH}/sites",
                             capture_output=True, text=True, timeout=300, env=env)
        if out.returncode != 0:
            raise Refused(500, "bench-failed", f"core credential: {(out.stderr or out.stdout)[-600:]}")

    def encryption_key():
        path = f"{BENCH}/sites/{site}/site_config.json"
        with open(path) as f:
            conf = json.load(f)
        if meta.get("encryption_key"):
            conf["encryption_key"] = meta["encryption_key"]
        with open(path, "w") as f:
            json.dump(conf, f, indent=1)

    rewrite = {"world": world, "core_url": "", "browser_core_url": "", "site": site}
    world_clock = {"world": world, "offset_ms": int(clock.get("offset_ms", 0))}
    if "frozen_at_ms" in clock:
        world_clock["frozen_at_ms"] = int(clock["frozen_at_ms"])
    plan = [
        ("new-site from backup", lambda: bench("new-site", site, "--mariadb-user-host-login-scope=%", "--db-root-password",
                                               DB_ROOT, "--admin-password", secrets.token_hex(16), "--source-sql",
                                               f"{meta['folder']}/{meta['dump']}")),
        ("encryption key", encryption_key),
        ("join world", lambda: bench("--site", site, "execute", "capxul.world.rewrite", "--kwargs", json.dumps(rewrite))),
        ("world clock", lambda: bench("--site", site, "execute", "capxul.clock.write_world", "--kwargs",
                                      json.dumps(world_clock)) if clock else None),
        ("core user", credential),
        ("enable scheduler", lambda: bench("--site", site, "enable-scheduler")),
    ]
    steps, t0 = [], time.monotonic()
    with BENCH_LOCK:
        try:
            for name, run in plan:
                if (read_entry(site) or {}).get("state") != "creating":
                    return
                s0 = time.monotonic()
                run()
                steps.append({"step": name, "ms": round((time.monotonic() - s0) * 1000)})
                update_entry(site, steps=steps)
                print(f"door: {site} {name} {steps[-1]['ms']} ms", flush=True)
            update_entry(site, state="ready", steps=steps, ms=round((time.monotonic() - t0) * 1000))
            print(f"door: {site} restored from {meta['site']}", flush=True)
        except Exception as e:  # noqa: BLE001 -- a site that could not be restored says why
            detail = e.detail if isinstance(e, Refused) else repr(e)
            update_entry(site, state="failed", steps=steps, error=detail[-600:])
            print(f"door: {site} restore failed: {detail[-300:]}", flush=True)


def remove_backups(world):
    shutil.rmtree(f"{BACKUPS}/{world}", ignore_errors=True)
