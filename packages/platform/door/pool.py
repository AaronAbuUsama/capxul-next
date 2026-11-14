"""Company sites from a pool (roadmap step 1.17; decision "Sites from a pool", 14 November 2026; measured in
spikes/site-speed, Q3a and Q3b). door.py checks the tokens; this does the work.

A template is a starting world's company sites, kept on the bench and never served: for each company label, a
database and a site folder under `<REGISTRY>/templates/<template>/<label>/`. It is made once from a ready site of a
world (that world made it from nothing, `POST /sites`, and ran the starting world's steps) or from a world's saved
backup (`POST /world/backup`), and is named after the starting world (the blueprint's `startingWorlds`: `founded`,
`office-holder`, …). Making it again replaces it and its pool.

The pool keeps POOL_SIZE ready copies of each template site under `<REGISTRY>/pool/<template>/<label>/<id>/`: a copy
of the template's database inside MariaDB, its own MariaDB user and the template's folder (about 4 s each). They are
refilled one at a time, bench-wide, in the background, off any claim's path. A copy is not a site the bench serves or
schedules (its folder is not at the top of `sites/`) until it is claimed.

A claim gives the token's world a copy of every site of a template, each `<label>-<world>.<domain>`: the copy's folder
renamed to the site's name, then one Python process of the bench that joins it to the world (`capxul.world.rewrite`:
its world and host name, its jobs settled on the world's time), sets the world's clock if one is given, gives the
site's own API user the world's credential and turns its scheduler on (about 1.1 s). With the pool empty the copy is
made on the claim's path from the template (about 4 s).
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

import db
from sites import BENCH, DOMAIN, REGISTRY, Refused, read_entry, site_lock

TEMPLATE = re.compile(r"^[a-z][a-z0-9-]{0,39}$")
COPY = re.compile(r"^[0-9a-f]{8}$")  # a ready copy's folder; one being made ends in .making
TEMPLATES = f"{REGISTRY}/templates"
POOL = f"{REGISTRY}/pool"
POOL_SIZE = int(os.environ.get("DOOR_POOL_SIZE", "2"))
REFILL = threading.Lock()  # one pool copy is made at a time, bench-wide
_template_locks, _locks_guard, _refilling = {}, threading.Lock(), set()
REFILLS = []  # the last 50 copies made, each with its time, for GET /templates


def template_lock(template):
    with _locks_guard:
        return _template_locks.setdefault(template, threading.Lock())


def _name(template):
    if not TEMPLATE.match(template or ""):
        raise Refused(400, "template-invalid", "a starting world's name: a-z first, then a-z, 0-9 and -, up to 40")
    return template


def template_sites(template):
    """The template's sites: [{label, company, db, folder, …}], from each label's meta.json."""
    found = []
    for path in sorted(glob.glob(f"{TEMPLATES}/{template}/*/meta.json")):
        with open(path) as f:
            found.append({**json.load(f), "folder": f"{os.path.dirname(path)}/site"})
    return found


def _site_folder_copy(src, dst):
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns("logs", "locks", "backups", "*.tmp"))
    os.makedirs(f"{dst}/logs", exist_ok=True)
    os.makedirs(f"{dst}/locks", exist_ok=True)


def _copy_site(src_db, src_folder, dst_folder, conn=None):
    """A copy of a site: its database copied inside MariaDB under a new name with a new user, its folder copied."""
    name, password = db.new_name(), secrets.token_hex(16)
    db.copy(src_db, name, conn)
    db.make_user(name, password, name, conn)
    _site_folder_copy(src_folder, dst_folder)
    conf = db.site_config(dst_folder)
    conf.update({"db_name": name, "db_user": name, "db_password": password})
    db.write_site_config(dst_folder, conf)
    return name


def _remove_copy(folder):
    """A copy's database, user and folder."""
    try:
        name = db.site_config(folder).get("db_name")
    except (FileNotFoundError, ValueError):
        name = None
    if name and re.match(r"^[A-Za-z0-9_]+$", name):
        db.drop(name)
        db.drop_user(name)
    shutil.rmtree(folder, ignore_errors=True)


def make_template(c, body):
    """Makes (or replaces) a template from a ready site of the token's world, or from the world's saved backup."""
    template = _name(body.get("template"))
    t0, made = time.monotonic(), []
    if body.get("site"):
        entry = read_entry(body["site"])
        if entry is None or entry.get("world") != c["world"]:
            raise Refused(403, "site-not-in-world", f"{body['site']} is not a site of world {c['world']}")
        if entry.get("state") != "ready":
            raise Refused(409, "site-not-ready", body["site"])
        label = entry["site"][: -len(f"-{c['world']}.{DOMAIN}")]
        sources = [{"label": label, "company": entry.get("company"), "site": entry["site"]}]
    elif body.get("snapshot"):
        from snapshots import _snapshot_dir

        folder = _snapshot_dir(c["world"], body["snapshot"])
        sources = []
        for path in sorted(glob.glob(f"{folder}/*/meta.json")):
            with open(path) as f:
                meta = json.load(f)
            sources.append({"label": meta["label"], "company": meta.get("company"),
                            "dump": f"{os.path.dirname(path)}/{meta['dump']}", "encryption_key": meta["encryption_key"]})
        if not sources:
            raise Refused(404, "backup-not-found", f"{c['world']} saved no site as {body['snapshot']}")
    else:
        raise Refused(400, "template-source-missing", "name a ready site of the world, or a snapshot it saved")
    with template_lock(template):
        drop_template(template, locked=True)
        for source in sources:
            s0 = time.monotonic()
            home = f"{TEMPLATES}/{template}/{source['label']}"
            os.makedirs(home, exist_ok=True)
            if "site" in source:
                with site_lock(source["site"]):
                    name = db.site_config(f"{BENCH}/sites/{source['site']}")["db_name"]
                    copied = db.new_name()
                    db.copy(name, copied)
                    _site_folder_copy(f"{BENCH}/sites/{source['site']}", f"{home}/site")
            else:
                copied = _load_dump(source, f"{home}/site", c["world"])
            meta = {"template": template, "label": source["label"], "company": source["company"], "db": copied,
                    "made_from": source.get("site") or f"{c['world']}/{body['snapshot']}", "made_by": c["world"],
                    "made_at": int(time.time()), "ms": db.ms_since(s0)}
            with open(f"{home}/meta.json", "w") as f:
                json.dump(meta, f)
            made.append(meta)
    refill_soon(template)
    print(f"door: template {template} made from {made[0]['made_from']} in {db.ms_since(t0)} ms", flush=True)
    return {"template": template, "sites": made, "ms": db.ms_since(t0), "pool_size": POOL_SIZE}


def _load_dump(source, folder, world):
    """A template site from a saved backup: its dump loaded into a new database, a folder with its encryption key."""
    name = db.new_name()
    db.run([f"create database {db.q(name)}"])
    with open(source["dump"], "rb") as dump:
        unzip = subprocess.Popen(["gzip", "-dc"], stdin=dump, stdout=subprocess.PIPE)
        load = subprocess.run(["mariadb", "-h", "mariadb", "-uroot", name], stdin=unzip.stdout, capture_output=True,
                              env={**os.environ, "MYSQL_PWD": db.DB_ROOT}, timeout=900)
        unzip.stdout.close()
        if unzip.wait() != 0 or load.returncode != 0:
            db.drop(name)
            raise Refused(500, "template-load-failed", load.stderr.decode(errors="replace")[-300:])
    os.makedirs(f"{folder}/public/files", exist_ok=True)
    os.makedirs(f"{folder}/private/files", exist_ok=True)
    db.write_site_config(folder, {"db_name": name, "db_type": "mariadb", "encryption_key": source["encryption_key"],
                                  "capxul_world": world})
    return name


def drop_template(template, locked=False):
    """Removes a template, its pool and their databases."""
    lock = template_lock(_name(template))
    if not locked:
        lock.acquire()
    try:
        gone = template_sites(template)
        for meta in gone:
            db.drop(meta["db"])
        for folder in glob.glob(f"{POOL}/{template}/*/*"):
            _remove_copy(folder)
        shutil.rmtree(f"{TEMPLATES}/{template}", ignore_errors=True)
        shutil.rmtree(f"{POOL}/{template}", ignore_errors=True)
        return {"template": template, "removed": [m["label"] for m in gone]}
    finally:
        if not locked:
            lock.release()


def ready_copies(template, label):
    return sorted(p for p in glob.glob(f"{POOL}/{template}/{label}/*") if COPY.match(os.path.basename(p)))


def list_templates():
    out = []
    for home in sorted(glob.glob(f"{TEMPLATES}/*")):
        name = os.path.basename(home)
        out.append({"template": name, "sites": [
            {k: m.get(k) for k in ("label", "company", "made_from", "made_by", "made_at", "ms")} |
            {"pool_ready": len(ready_copies(name, m["label"]))} for m in template_sites(name)]})
    return {"templates": out, "pool_size": POOL_SIZE, "refills": REFILLS[-20:]}


def refill_soon(template):
    """Starts topping the template's pool up to POOL_SIZE in the background, unless that is under way."""
    with _locks_guard:
        if template in _refilling:
            return
        _refilling.add(template)
    threading.Thread(target=_refill, args=(template,), daemon=True).start()


def _refill(template):
    try:
        while True:
            short = [m for m in template_sites(template) if len(ready_copies(template, m["label"])) < POOL_SIZE]
            if not short:
                return
            with REFILL, template_lock(template):
                meta = next((m for m in template_sites(template) if m["label"] == short[0]["label"]), None)
                if meta is None:
                    continue
                t0, home = time.monotonic(), f"{POOL}/{template}/{meta['label']}"
                making = f"{home}/{secrets.token_hex(4)}.making"
                os.makedirs(home, exist_ok=True)
                try:
                    _copy_site(meta["db"], meta["folder"], making)
                    os.rename(making, making[: -len(".making")])
                except Exception as e:  # noqa: BLE001 -- a failed copy is removed and the refill stops; a claim clones
                    _remove_copy(making)
                    print(f"door: pool {template}/{meta['label']} refill failed: {repr(e)[-300:]}", flush=True)
                    return
            REFILLS.append({"template": template, "label": meta["label"], "ms": db.ms_since(t0), "at": int(time.time())})
            del REFILLS[:-50]
            print(f"door: pool {template}/{meta['label']} +1 in {db.ms_since(t0)} ms", flush=True)
    finally:
        with _locks_guard:
            _refilling.discard(template)


def take(template, label, dest):
    """Moves a ready copy out of the pool to `dest` (a rename on the sites volume); False when the pool is empty."""
    with _locks_guard:
        for folder in ready_copies(template, label):
            try:
                os.rename(folder, dest)
                return True
            except FileNotFoundError:
                continue
    return False


def tidy():
    """At the door's start: copies left half-made by a door that stopped are removed, and every pool is refilled."""
    for folder in glob.glob(f"{POOL}/*/*/*.making"):
        _remove_copy(folder)
    for home in glob.glob(f"{TEMPLATES}/*"):
        refill_soon(os.path.basename(home))
