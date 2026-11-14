"""Saving a world's sites to a point and resetting them in place to it (roadmap steps 1.16 and 1.17; measured in
spikes/site-speed, Q4). door.py checks the token; this does the work.

A point is, for every ready site of the world, a saved copy of its database inside MariaDB (about 3 s), each table's
checksum taken from that copy, its files (`public/files`, `private/files`) and its `site_config.json`; and, once for
the world, its entry in the bench's world clocks (`sites/capxul-world-clocks.json`). It lives in
`<REGISTRY>/points/<world>/<point>.json` and `<point>/<label>/`, and goes with the world (`DELETE /world`) or its
site. Saving under a name held replaces it.

A reset puts each site back where it was saved, in place: the site keeps its name, database and credential. Only the
tables whose checksum differs from the saved one are emptied and filled from the saved copy, in one transaction (a
table made since is dropped, one dropped since made again); the files are put back if any differ; the site config if
it differs; the site's queued jobs are removed and its cache keys in Redis cleared. Then the world's clock entry is put
back as saved: a frozen clock reads the saved instant again, a running one its saved offset and rate. A reset of a
small site is about 0.5 s; the world should be paused (1.16) so nothing writes to a site while it is put back.
Not put back: the schema of a table changed since (a migrate between save and reset), and a job already running.
"""

import fcntl
import glob
import json
import os
import re
import shutil
import tempfile
import time

import db
from sites import BENCH, DOMAIN, FAST, REGISTRY, Refused, entries_of, read_entry, site_lock

POINT = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
POINTS = f"{REGISTRY}/points"
CLOCKS = f"{BENCH}/sites/capxul-world-clocks.json"
FILES = ("public/files", "private/files")


def _paths(world, point):
    if not POINT.match(point or ""):
        raise Refused(400, "point-invalid", "1 to 63 of a-z, 0-9 and -")
    return f"{POINTS}/{world}/{point}.json", f"{POINTS}/{world}/{point}"


def _label(site, world):
    return site[: -len(f"-{world}.{DOMAIN}")]


def read_point(world, point):
    path, _ = _paths(world, point)
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        raise Refused(404, "point-not-found", f"{world} saved no point {point}") from None


def _clock_entry(world):
    try:
        with open(CLOCKS) as f:
            return json.load(f).get(world)
    except (FileNotFoundError, ValueError):
        return None


def _put_clock(world, entry):
    """Writes the world's entry back, under the lock capxul.clock.write_world takes, as it writes."""
    with open(CLOCKS + ".lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            with open(CLOCKS) as f:
                data = json.load(f)
        except (FileNotFoundError, ValueError):
            data = {}
        if entry is None:
            data.pop(world, None)
        else:
            data[world] = entry
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(CLOCKS))
        with os.fdopen(fd, "w") as f:
            json.dump(data, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, CLOCKS)


def save_world(c, body):
    """Saves every ready site of the token's world as the point; every site must be ready."""
    world, point = c["world"], body.get("point")
    path, folder = _paths(world, point)
    entries = entries_of(world)
    if any(e.get("state") != "ready" for e in entries):
        raise Refused(409, "site-not-ready", "every site of the world must be ready to be saved")
    t0, staging = time.monotonic(), f"{folder}.saving"
    shutil.rmtree(staging, ignore_errors=True)
    saved = {}
    try:
        for entry in entries:
            saved[entry["site"]] = _save_site(entry["site"], world, f"{staging}/{_label(entry['site'], world)}")
    except BaseException:
        for one in saved.values():
            db.drop(one["db"])
        shutil.rmtree(staging, ignore_errors=True)
        raise
    old = _forget(path, folder)
    os.rename(staging, folder)
    record = {"world": world, "point": point, "saved_at": int(time.time()), "clock": _clock_entry(world),
              "sites": saved}
    with open(f"{path}.tmp", "w") as f:
        json.dump(record, f)
    os.replace(f"{path}.tmp", path)
    for name in old:
        db.drop(name)
    print(f"door: {world} saved {len(saved)} sites as point {point} in {db.ms_since(t0)} ms", flush=True)
    return {"world": world, "point": point, "ms": db.ms_since(t0),
            "sites": [{"site": s, "ms": v["ms"], "steps": v["steps"]} for s, v in saved.items()]}


def _save_site(site, world, folder):
    live = f"{BENCH}/sites/{site}"
    steps, t0 = [], time.monotonic()
    with site_lock(site), FAST:
        conf = db.site_config(live)
        name = db.new_name()
        s0 = time.monotonic()
        tables = db.copy(conf["db_name"], name)
        steps.append({"step": "saved copy in MariaDB", "ms": db.ms_since(s0), "tables": len(tables)})
        s0 = time.monotonic()
        sums = db.checksums(name, tables)
        steps.append({"step": "checksums of the saved copy", "ms": db.ms_since(s0)})
        s0 = time.monotonic()
        os.makedirs(folder, exist_ok=True)
        for sub in FILES:
            if os.path.isdir(f"{live}/{sub}"):
                shutil.copytree(f"{live}/{sub}", f"{folder}/{sub}")
        shutil.copy2(f"{live}/site_config.json", f"{folder}/site_config.json")
        with open(f"{folder}/tables.json", "w") as f:
            json.dump({"tables": tables, "checksums": sums}, f)
        steps.append({"step": "files and site config", "ms": db.ms_since(s0)})
    return {"db": name, "label": _label(site, world), "live_db": conf["db_name"], "ms": db.ms_since(t0), "steps": steps}


def reset_world(c, body):
    """Puts every site the point saved back to it, in place, then the world's clock entry."""
    world = c["world"]
    record = read_point(world, body.get("point"))
    _, folder = _paths(world, body.get("point"))
    for site in record["sites"]:
        entry = read_entry(site)
        if entry is None or entry.get("world") != world or entry.get("state") != "ready":
            raise Refused(409, "point-site-missing", f"{site} is not a ready site of {world} any more")
    t0, done = time.monotonic(), []
    for site, saved in record["sites"].items():
        done.append(_reset_site(site, saved, f"{folder}/{saved['label']}"))
    s0 = time.monotonic()
    _put_clock(world, record["clock"])
    clock_ms = db.ms_since(s0)
    extra = sorted(e["site"] for e in entries_of(world) if e["site"] not in record["sites"])
    print(f"door: {world} reset to point {record['point']} in {db.ms_since(t0)} ms", flush=True)
    return {"world": world, "point": record["point"], "ms": db.ms_since(t0), "sites": done,
            "clock": {"entry": record["clock"], "ms": clock_ms}, "sites_not_in_point": extra}


def _reset_site(site, saved, folder):
    live = f"{BENCH}/sites/{site}"
    steps, t0 = [], time.monotonic()
    with site_lock(site), FAST:
        if db.site_config(live).get("db_name") != saved["live_db"]:
            raise Refused(409, "point-site-changed", f"{site} has another database than when it was saved")
        with open(f"{folder}/tables.json") as f:
            kept = json.load(f)
        s0 = time.monotonic()
        did = db.put_back(saved["live_db"], saved["db"], kept["tables"], kept["checksums"])
        steps.append({"step": "changed tables put back", "ms": db.ms_since(s0), **did})
        s0 = time.monotonic()
        files = [sub for sub in FILES if _listing(f"{live}/{sub}") != _listing(f"{folder}/{sub}")]
        for sub in files:
            shutil.rmtree(f"{live}/{sub}", ignore_errors=True)
            if os.path.isdir(f"{folder}/{sub}"):
                shutil.copytree(f"{folder}/{sub}", f"{live}/{sub}")
        config = _same_file(f"{live}/site_config.json", f"{folder}/site_config.json")
        if not config:
            shutil.copy2(f"{folder}/site_config.json", f"{live}/site_config.json.tmp")
            os.replace(f"{live}/site_config.json.tmp", f"{live}/site_config.json")
        steps.append({"step": "files and site config", "ms": db.ms_since(s0), "files_put_back": files,
                      "site_config_put_back": not config})
        s0 = time.monotonic()
        jobs = db.drop_jobs(site)
        keys = db.clear_cache(saved["live_db"])
        steps.append({"step": "queued jobs removed, cache cleared", "ms": db.ms_since(s0), "jobs_removed": jobs,
                      "cache_keys_cleared": keys})
    return {"site": site, "ms": db.ms_since(t0), "steps": steps}


def _listing(folder):
    out = {}
    for path in glob.glob(f"{folder}/**", recursive=True):
        if os.path.isfile(path):
            st = os.stat(path)
            out[os.path.relpath(path, folder)] = (st.st_size, st.st_mtime_ns)
    return out


def _same_file(a, b):
    with open(a, "rb") as f, open(b, "rb") as g:
        return f.read() == g.read()


def _forget(path, folder):
    """Removes a point's record and files; answers its saved databases, for the caller to drop."""
    try:
        with open(path) as f:
            names = [s["db"] for s in json.load(f)["sites"].values()]
    except FileNotFoundError:
        names = []
    if os.path.exists(path):
        os.remove(path)
    shutil.rmtree(folder, ignore_errors=True)
    return names


def list_points(c):
    out = []
    for path in sorted(glob.glob(f"{POINTS}/{c['world']}/*.json")):
        with open(path) as f:
            r = json.load(f)
        out.append({"point": r["point"], "saved_at": r["saved_at"], "sites": sorted(r["sites"])})
    return {"world": c["world"], "points": out}


def drop_point(c, point):
    path, folder = _paths(c["world"], point)
    if not os.path.exists(path):
        raise Refused(404, "point-not-found", f"{c['world']} saved no point {point}")
    for name in _forget(path, folder):
        db.drop(name)
    return {"world": c["world"], "point": point, "removed": True}


def drop_world_points(world, site=None):
    """Every point of the world (DELETE /world), or only what they saved of one site (DELETE /sites/<site>)."""
    for path in glob.glob(f"{POINTS}/{world}/*.json"):
        if site is None:
            for name in _forget(path, path[: -len(".json")]):
                db.drop(name)
            continue
        with open(path) as f:
            r = json.load(f)
        one = r["sites"].pop(site, None)
        if one:
            db.drop(one["db"])
            shutil.rmtree(f"{path[: -len('.json')]}/{one['label']}", ignore_errors=True)
            with open(path, "w") as f:
                json.dump(r, f)
    if site is None:
        shutil.rmtree(f"{POINTS}/{world}", ignore_errors=True)
