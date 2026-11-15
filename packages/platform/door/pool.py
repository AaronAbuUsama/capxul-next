"""Company sites from a pool (roadmap step 1.17; decision "Sites from a pool", 14 November 2026; measured in
records/site-speed, Q3a and Q3b). door.py checks the tokens; this does the work. The templates themselves, how they are
named, made once and removed by age, are templates.py's.

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
import os
import re
import secrets
import shutil
import threading
import time

import db
from sites import REGISTRY
from templates import (BLANK, MAKING, TEMPLATES, names, remove_making, template_lock, template_sites, used_at)

COPY = re.compile(r"^[0-9a-f]{8}$")  # a ready copy's folder; one being made ends in .making
POOL = f"{REGISTRY}/pool"
POOL_SIZE = int(os.environ.get("DOOR_POOL_SIZE", "2"))
# Ready blank copies: one company site for each journey founding at once in a run's shared world (roadmap 4.8, eight by
# default), at most BLANK_POOL_MAX, about 110 MiB of disk each.
BLANK_POOL_MAX = 10
BLANK_POOL_SIZE = max(0, min(int(os.environ.get("DOOR_BLANK_POOL_SIZE", "8")), BLANK_POOL_MAX))
REFILL = threading.Lock()  # one pool copy is made at a time, bench-wide
_guard, _refilling = threading.Lock(), set()
REFILLS = []  # the last 50 copies made, each with its time, for GET /templates


def site_folder_copy(src, dst):
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns("logs", "locks", "backups", "*.tmp"))
    os.makedirs(f"{dst}/logs", exist_ok=True)
    os.makedirs(f"{dst}/locks", exist_ok=True)


def copy_site(src_db, src_folder, dst_folder, conn=None):
    """A copy of a site: its database copied inside MariaDB under a new name with a new user, its folder copied."""
    name, password = db.new_name(), secrets.token_hex(16)
    db.copy(src_db, name, conn)
    db.make_user(name, password, name, conn)
    site_folder_copy(src_folder, dst_folder)
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


def remove_pool(template):
    """Every copy of the template's pool, made or being made. The template's lock is held by the caller."""
    for folder in glob.glob(f"{POOL}/{template}/*/*"):
        _remove_copy(folder)
    shutil.rmtree(f"{POOL}/{template}", ignore_errors=True)


def size_of(template):
    return BLANK_POOL_SIZE if template.startswith(BLANK) else POOL_SIZE


def ready_copies(template, label):
    return sorted(p for p in glob.glob(f"{POOL}/{template}/{label}/*") if COPY.match(os.path.basename(p)))


def list_templates():
    """Every whole template, its sites and their ready copies, when it was last used, and the last refills."""
    out, now = [], int(time.time())
    for name in names():
        used = used_at(name)
        out.append({"template": name, "used_at": used, "idle_s": None if used is None else now - used, "sites": [
            {k: m.get(k) for k in ("label", "company", "made_from", "made_by", "made_at", "ms")} |
            {"pool_ready": len(ready_copies(name, m["label"]))} for m in template_sites(name)]})
    return {"templates": out, "pool_size": POOL_SIZE, "blank_pool_size": BLANK_POOL_SIZE, "refills": REFILLS[-20:]}


def refill_soon(template):
    """Starts topping the template's pool up to its size (size_of) in the background, unless that is under way."""
    with _guard:
        if template in _refilling:
            return
        _refilling.add(template)
    threading.Thread(target=_refill, args=(template,), daemon=True).start()


def _refill(template):
    try:
        while True:
            size = size_of(template)
            short = [m for m in template_sites(template) if len(ready_copies(template, m["label"])) < size]
            if not short:
                return
            with REFILL, template_lock(template):
                # Looked for again under the lock: a sweep may have removed the template since.
                meta = next((m for m in template_sites(template) if m["label"] == short[0]["label"]), None)
                if meta is None:
                    continue
                t0, home = time.monotonic(), f"{POOL}/{template}/{meta['label']}"
                making = f"{home}/{secrets.token_hex(4)}.making"
                os.makedirs(home, exist_ok=True)
                try:
                    copy_site(meta["db"], meta["folder"], making)
                    os.rename(making, making[: -len(".making")])
                except Exception as e:  # noqa: BLE001 -- a failed copy is removed and the refill stops; a claim clones
                    _remove_copy(making)
                    print(f"door: pool {template}/{meta['label']} refill failed: {repr(e)[-300:]}", flush=True)
                    return
            REFILLS.append({"template": template, "label": meta["label"], "ms": db.ms_since(t0), "at": int(time.time())})
            del REFILLS[:-50]
            print(f"door: pool {template}/{meta['label']} +1 in {db.ms_since(t0)} ms", flush=True)
    finally:
        with _guard:
            _refilling.discard(template)


def take(template, label, dest):
    """Moves a ready copy out of the pool to `dest` (a rename on the sites volume); False when the pool is empty."""
    with _guard:
        for folder in ready_copies(template, label):
            try:
                os.rename(folder, dest)
                return True
            except FileNotFoundError:
                continue
    return False


def tidy():
    """At the door's start: templates and copies left half-made by a door that stopped are removed, and every pool is
    refilled."""
    for making in glob.glob(f"{TEMPLATES}/*{MAKING}"):
        remove_making(making)
    for folder in glob.glob(f"{POOL}/*/*/*.making"):
        _remove_copy(folder)
    for name in names():
        refill_soon(name)
