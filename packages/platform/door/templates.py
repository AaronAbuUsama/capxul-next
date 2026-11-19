"""Bench templates and their lifetime (decision "Bench templates never change", 14 November 2026). pool.py keeps their
ready copies and claim.py hands them out; door.py checks the tokens.

A template is a starting world's company sites, kept on the bench and never served: for each company label, a
database and a site folder under `<REGISTRY>/templates/<template>/<label>/`. It is made once from a ready site of a
world (that world made it from nothing, `POST /sites`, and ran the starting world's steps) or from a world's saved
backup (`POST /world/backup`), and then only copied from.

- **Never changed.** A second `POST /templates` of a name that exists makes nothing and answers the template as it is
  (`made: false`), whoever asks: two runs that make one name at once make it once, the second waiting on the
  template's lock for the first's copy and then answered with it. A template is made in a folder of its own,
  `<template>.making`, and renamed into place only when every site of it is copied, so a template that exists is
  whole. Callers name a template by what it holds (packages/world, `templateName`), never by a name another run uses
  for something else.
- **Removed by age.** Every claim marks the template used (`used`, Unix seconds; its making counts as a use). The
  sweep (`POST /templates/sweep {idle_s}`) removes a template only when it was last used more than `idle_s` ago, and
  never one whose lock is held (being made, copied from with the pool empty, or refilled). `idle_s` may not be under
  MIN_IDLE_S. No run removes a template by name; `DELETE /templates/<template>` is for a person.
"""

import glob
import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
import time

import db
from sites import BENCH, REGISTRY, Refused, read_entry, site_lock

TEMPLATE = re.compile(r"^[a-z][a-z0-9-]{0,39}$")
TEMPLATES = f"{REGISTRY}/templates"
MAKING = ".making"  # a template being made: renamed into place once whole
BLANK = "blank-"  # the door's own blank company templates (blank.py): no world makes, claims or sweeps one
COMPANY = "co-"  # the door's own company templates (company.py): the same
MIN_IDLE_S = int(os.environ.get("DOOR_TEMPLATE_MIN_IDLE_S", "3600"))
_template_locks, _locks_guard = {}, threading.Lock()
_app_version = []


def template_lock(template):
    with _locks_guard:
        return _template_locks.setdefault(template, threading.Lock())


def name_of(template):
    if not TEMPLATE.match(template or ""):
        raise Refused(400, "template-invalid", "a-z first, then a-z, 0-9 and -, up to 40")
    return template


def worlds_name(template):
    """A name a world may make or claim: any template's but the door's own blanks and company templates."""
    if name_of(template).startswith(BLANK):
        raise Refused(400, "template-reserved", f"{BLANK}… names the door's blank company templates")
    if template.startswith(COMPANY):
        raise Refused(400, "template-reserved", f"{COMPANY}… names the door's company templates")
    return template


def names():
    """Every whole template's name; one being made (`<template>.making`) is not one yet."""
    return sorted(n for n in (os.path.basename(p) for p in glob.glob(f"{TEMPLATES}/*")) if TEMPLATE.match(n))


def template_sites(template):
    """The template's sites: [{label, company, db, folder, …}], from each label's meta.json."""
    return _sites_in(f"{TEMPLATES}/{template}")


def _sites_in(home):
    found = []
    for path in sorted(glob.glob(f"{home}/*/meta.json")):
        with open(path) as f:
            found.append({**json.load(f), "folder": f"{os.path.dirname(path)}/site"})
    return found


def mark_used(template, at=None):
    with open(f"{TEMPLATES}/{template}/used", "w") as f:
        f.write(str(int(at if at is not None else time.time())))


def used_at(template):
    """When the template was last claimed from, or made; None for one that holds no site."""
    try:
        with open(f"{TEMPLATES}/{template}/used") as f:
            return int(f.read().strip())
    except (FileNotFoundError, ValueError):
        made = [m.get("made_at") or 0 for m in template_sites(template)]
        return max(made) if made else None


def claimable(template):
    """The template's sites, marked used under its lock so a sweep that has not begun yet keeps it; [] for none."""
    with template_lock(template):
        metas = template_sites(template)
        if metas:
            mark_used(template)
        return metas


def _public(metas):
    return [{k: v for k, v in m.items() if k != "folder"} for m in metas]


def make_template(c, body):
    """Makes a template from a ready site of the token's world, or from the world's saved backup; one that exists is
    answered as it is."""
    import pool

    template = worlds_name(body.get("template"))
    t0, made = time.monotonic(), []
    sources = _sources(c, body)
    with template_lock(template):
        held = template_sites(template)
        if held:
            print(f"door: template {template} exists (made by {held[0].get('made_by')}); left as it is", flush=True)
            return {"template": template, "sites": _public(held), "ms": db.ms_since(t0), "pool_size": pool.POOL_SIZE,
                    "made": False}
        making = f"{TEMPLATES}/{template}{MAKING}"
        remove_making(making)
        try:
            for source in sources:
                made.append(_copy_source(c, body, template, source, f"{making}/{source['label']}"))
            os.rename(making, f"{TEMPLATES}/{template}")
            mark_used(template)
        except BaseException:
            remove_making(making)
            raise
    pool.refill_soon(template)
    print(f"door: template {template} made from {made[0]['made_from']} in {db.ms_since(t0)} ms", flush=True)
    return {"template": template, "sites": made, "ms": db.ms_since(t0), "pool_size": pool.POOL_SIZE, "made": True}


def _sources(c, body):
    """What a template is made from, checked before any work: one ready site of the world, or its saved backup."""
    from sites import DOMAIN

    if body.get("site"):
        entry = read_entry(body["site"])
        if entry is None or entry.get("world") != c["world"]:
            raise Refused(403, "site-not-in-world", f"{body['site']} is not a site of world {c['world']}")
        if entry.get("state") != "ready":
            raise Refused(409, "site-not-ready", body["site"])
        label = entry["site"][: -len(f"-{c['world']}.{DOMAIN}")]
        return [{"label": label, "company": entry.get("company"), "site": entry["site"]}]
    if body.get("snapshot"):
        from snapshots import _snapshot_dir

        folder, sources = _snapshot_dir(c["world"], body["snapshot"]), []
        for path in sorted(glob.glob(f"{folder}/*/meta.json")):
            with open(path) as f:
                meta = json.load(f)
            sources.append({"label": meta["label"], "company": meta.get("company"),
                            "dump": f"{os.path.dirname(path)}/{meta['dump']}", "encryption_key": meta["encryption_key"]})
        if not sources:
            raise Refused(404, "backup-not-found", f"{c['world']} saved no site as {body['snapshot']}")
        return sources
    raise Refused(400, "template-source-missing", "name a ready site of the world, or a snapshot it saved")


def _copy_source(c, body, template, source, home):
    """One site of the template, copied into `home`. Its meta.json, naming its database, is written before the copy
    begins, so a copy cut short is found and removed with the rest of `<template>.making`."""
    import pool

    s0, copied = time.monotonic(), db.new_name()
    os.makedirs(home, exist_ok=True)
    meta = {"template": template, "label": source["label"], "company": source["company"], "db": copied,
            "made_from": source.get("site") or f"{c['world']}/{body['snapshot']}", "made_by": c["world"],
            "made_at": int(time.time()), "ms": None}
    write_meta(home, meta)
    if "site" in source:
        with site_lock(source["site"]):
            name = db.site_config(f"{BENCH}/sites/{source['site']}")["db_name"]
            db.copy(name, copied)
            pool.site_folder_copy(f"{BENCH}/sites/{source['site']}", f"{home}/site")
    else:
        _load_dump(source, copied, f"{home}/site", c["world"])
    meta["ms"] = db.ms_since(s0)
    write_meta(home, meta)
    return meta


def write_meta(home, meta):
    with open(f"{home}/meta.json", "w") as f:
        json.dump(meta, f)


def _load_dump(source, name, folder, world):
    """A template site from a saved backup: its dump loaded into database `name`, a folder with its encryption key."""
    db.run([f"create database {db.q(name)}"])
    with open(source["dump"], "rb") as dump:
        unzip = subprocess.Popen(["gzip", "-dc"], stdin=dump, stdout=subprocess.PIPE)
        load = subprocess.run(["mariadb", "-h", "mariadb", "-uroot", name], stdin=unzip.stdout, capture_output=True,
                              env={**os.environ, "MYSQL_PWD": db.DB_ROOT}, timeout=900)
        unzip.stdout.close()
        if unzip.wait() != 0 or load.returncode != 0:
            raise Refused(500, "template-load-failed", load.stderr.decode(errors="replace")[-300:])
    os.makedirs(f"{folder}/public/files", exist_ok=True)
    os.makedirs(f"{folder}/private/files", exist_ok=True)
    db.write_site_config(folder, {"db_name": name, "db_type": "mariadb", "encryption_key": source["encryption_key"],
                                  "capxul_world": world})


def remove_making(making):
    """A template that was never made whole: the databases its meta files name, and its folder."""
    for meta in _sites_in(making):
        if re.match(r"^[A-Za-z0-9_]+$", meta.get("db") or ""):
            db.drop(meta["db"])
    shutil.rmtree(making, ignore_errors=True)


def drop_template(template, locked=False):
    """Removes a template, its pool and their databases."""
    import pool

    lock = template_lock(name_of(template))
    if not locked:
        lock.acquire()
    try:
        gone = template_sites(template)
        for meta in gone:
            db.drop(meta["db"])
        pool.remove_pool(template)
        shutil.rmtree(f"{TEMPLATES}/{template}", ignore_errors=True)
        return {"template": template, "removed": [m["label"] for m in gone]}
    finally:
        if not locked:
            lock.release()


def sweep(c, body):
    """Removes every template last used more than `idle_s` ago, skipping one whose lock is held; `dry_run` only says
    which it would remove."""
    idle = body.get("idle_s")
    if not isinstance(idle, int) or isinstance(idle, bool) or idle < MIN_IDLE_S:
        raise Refused(400, "sweep-idle-invalid", f"idle_s: whole seconds, at least {MIN_IDLE_S}")
    dry, now = body.get("dry_run") is True, int(time.time())
    removed, kept, busy = [], [], []
    for template in names():
        if template.startswith((BLANK, COMPANY)):  # the door's own: blank.py and company.py remove them at its start
            kept.append({"template": template, "idle_s": None, "door": True, "blank": template.startswith(BLANK)})
            continue
        lock = template_lock(template)
        if not lock.acquire(blocking=False):
            busy.append(template)
            continue
        try:
            last = used_at(template)
            idle_for = None if last is None else now - last
            if idle_for is not None and idle_for < idle:
                kept.append({"template": template, "idle_s": idle_for})
                continue
            if not dry:
                drop_template(template, locked=True)
            removed.append({"template": template, "idle_s": idle_for})
        finally:
            lock.release()
    print(f"door: sweep of templates idle over {idle} s: removed {len(removed)}, kept {len(kept)}, busy {len(busy)}",
          flush=True)
    return {"idle_s": idle, "dry_run": dry, "removed": removed, "kept": kept, "busy": busy}


def app_version():
    """What the bench's sites are made with, as a template's fingerprint reads it (packages/world): a hash of the
    capxul app's files and of every other app's package `__init__.py` (which holds its version). Read once."""
    if not _app_version:
        digest, apps = hashlib.sha256(), f"{BENCH}/apps"
        for app in sorted(os.listdir(apps)) if os.path.isdir(apps) else []:
            for path in _app_files(f"{apps}/{app}", app):
                digest.update(f"{os.path.relpath(path, apps)}\0".encode())
                with open(path, "rb") as f:
                    digest.update(f.read())
        _app_version.append(digest.hexdigest()[:16] if os.path.isdir(apps) else "none")
    return _app_version[0]


def _app_files(root, app):
    if app != "capxul":
        return [p for p in (f"{root}/{app}/__init__.py",) if os.path.isfile(p)]
    found = []
    for folder, subfolders, files in os.walk(root):
        subfolders[:] = sorted(d for d in subfolders if d not in ("__pycache__", "node_modules", ".git"))
        found.extend(f"{folder}/{name}" for name in sorted(files) if not name.endswith(".pyc"))
    return found
