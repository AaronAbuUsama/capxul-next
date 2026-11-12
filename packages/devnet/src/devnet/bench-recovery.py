"""Offline bench recovery commands, run only by the local world supervisor's site-admin container."""
import glob
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile
import time

import frappe

BENCH = Path.cwd()
SITES = BENCH / "sites"
# Native Frappe commands run from sites/: its loggers and restore paths rely on that cwd.
os.chdir(SITES)
GUARD = SITES / ".capxul-snapshot-guard.json"
FLAGS = ("maintenance_mode", "pause_scheduler")


def write_json(path, value):
    path = Path(path)
    temp = path.with_name(path.name + ".snapshot-tmp")
    temp.write_text(json.dumps(value))
    temp.chmod(0o600)
    temp.replace(path)


def prepare():
    if GUARD.exists():
        raise RuntimeError("bench has an unfinished snapshot guard; inspect before resuming")
    configs = {p.parent.name: json.loads(p.read_text()) for p in SITES.glob("*/site_config.json")}
    write_json(GUARD, configs)
    for site, conf in configs.items():
        write_json(SITES / site / "site_config.json", {**conf, "maintenance_mode": 1, "pause_scheduler": 1})


def pending_jobs():
    from frappe.utils.background_jobs import get_queue, get_queue_list

    sites = json.loads(GUARD.read_text())
    if not sites:
        return 0
    frappe.init(site=next(iter(sites)), sites_path=str(SITES))
    try:
        return sum(q.count + q.started_job_registry.count + q.deferred_job_registry.count + q.scheduled_job_registry.count
                   for q in (get_queue(name) for name in get_queue_list()))
    finally:
        frappe.destroy()


def drain(timeout):
    deadline = time.monotonic() + timeout
    while pending_jobs():
        if time.monotonic() >= deadline:
            raise RuntimeError("bench queue did not drain; snapshot refused, no queued jobs discarded")
        time.sleep(0.25)


def backup(site, directory):
    configs = json.loads(GUARD.read_text())
    subprocess.run(["bench", "--site", site, "backup", "--with-files", "--ignore-backup-conf", "--backup-path", directory], cwd=BENCH, check=True)
    # Native backup may generate this key on the first encrypted backup, after prepare().
    actual = json.loads((SITES / site / "site_config.json").read_text())
    if "backup_encryption_key" in actual:
        configs[site]["backup_encryption_key"] = actual["backup_encryption_key"]
    # Retain the actual pre-maintenance configuration, not our temporary fence.
    write_json(Path(directory) / "original-site-config.json", configs[site])
    frappe.init(site=site, sites_path=str(SITES))
    frappe.connect()
    try:
        write_json(Path(directory) / "scheduler-enabled.json", bool(frappe.db.get_single_value("System Settings", "enable_scheduler")))
    finally:
        frappe.destroy()


def one(directory, suffix):
    encrypted = suffix.replace(".sql.gz", "-enc.sql.gz") if suffix.endswith(".sql.gz") else suffix.replace(".tar", "-enc.tar")
    matches = glob.glob(f"{directory}/*{suffix}") + glob.glob(f"{directory}/*{encrypted}")
    if suffix == "-files.tar":
        matches = [p for p in matches if not p.endswith(("-private-files.tar", "-private-files-enc.tar"))]
    if len(matches) != 1:
        raise RuntimeError(f"backup must contain exactly one {suffix}")
    return matches[0]


def restore(site, directory, in_place):
    import pymysql

    old = json.loads(Path(directory, "original-site-config.json").read_text())
    path = SITES / site
    common = json.loads((SITES / "common_site_config.json").read_text())
    root_password = os.environ["MARIADB_ROOT_PASSWORD"]
    config_path = path / "site_config.json"
    if config_path.exists():
        if not in_place:
            raise RuntimeError("a separate-world restore cannot overwrite an existing site")
        current = json.loads(config_path.read_text())
    else:
        db = "_" + hashlib.sha256(site.encode()).hexdigest()[:16]
        password = secrets.token_hex(24)
        with pymysql.connect(host=common["db_host"], port=int(common.get("db_port", 3306)), user="root", password=root_password) as conn:
            with conn.cursor() as cur:
                # db is made solely from a hexadecimal digest, never from a caller's SQL text.
                cur.execute(f"CREATE DATABASE `{db}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
                cur.execute("CREATE USER %s@'%%' IDENTIFIED BY %s", (db, password))
                cur.execute(f"GRANT ALL ON `{db}`.* TO %s@'%%'", (db,))
        current = {"db_name": db, "db_password": password, "db_type": "mariadb"}
        for folder in ("private/backups", "private/files", "public/files", "locks", "logs"):
            (path / folder).mkdir(parents=True, exist_ok=True)
    # Keep the new site's DB authority; retain every other saved setting, especially encryption_key.
    credentials = {k: v for k, v in current.items() if k.startswith("db_")}
    conf = {k: v for k, v in old.items() if not k.startswith("db_")}
    write_json(config_path, {**conf, **credentials, "maintenance_mode": 1, "pause_scheduler": 1})
    # Files created after the cut must disappear on in-place restore. Bench extracts archives on top.
    for folder in ("public/files", "private/files"):
        shutil.rmtree(path / folder)
        (path / folder).mkdir()
    # Native restore renames/decrypts input archives in place. Never let it mutate the saved bundle.
    with tempfile.TemporaryDirectory() as staging:
        shutil.copytree(directory, staging, dirs_exist_ok=True)
        from frappe.commands.site import _restore

        frappe.init(site=site, sites_path=str(SITES))
        try:
            # The native command's implementation, without putting the DB secret in subprocess argv/errors.
            _restore(site=site, sql_file_path=one(staging, "-database.sql.gz"), db_root_password=root_password,
                     force=True, with_public_files=one(staging, "-files.tar"), with_private_files=one(staging, "-private-files.tar"))
        finally:
            frappe.destroy()
    # Bench restore may alter configuration. The original flags are applied only by release().
    restored = json.loads(config_path.read_text())
    restored.update({"encryption_key": old.get("encryption_key"), "maintenance_mode": 1, "pause_scheduler": 1})
    write_json(config_path, restored)
    configs = json.loads(GUARD.read_text())
    configs[site] = {**conf, **credentials, "_snapshot_scheduler_enabled": json.loads(Path(directory, "scheduler-enabled.json").read_text())}
    write_json(GUARD, configs)


def rewrite(site, world, now_ms, frozen, rate, site_url=None):
    frappe.init(site=site, sites_path=str(SITES))
    frappe.connect()
    try:
        frappe.set_user("Administrator")
        from capxul import clock
        from capxul.world import rewrite as rewrite_world

        rewrite_world(world=world, core_url="", browser_core_url="", site=site)
        if site_url is not None:
            from frappe.installer import update_site_config

            update_site_config("host_name", site_url)
        clock.write_world(world=world, offset_ms=int(now_ms - time.time() * 1000), frozen_at_ms=now_ms if frozen else None, rate=rate)
        # Neither browser credentials nor queued work from the abandoned branch may leak into the restored world.
        frappe.db.sql("DELETE FROM `tabSessions`")
        frappe.db.commit()
        frappe.clear_cache()
    finally:
        frappe.destroy()
    path = SITES / site / "site_config.json"
    write_json(path, {**json.loads(path.read_text()), "maintenance_mode": 1, "pause_scheduler": 1})


def release():
    if not GUARD.exists():
        return
    configs = json.loads(GUARD.read_text())
    for site, original in configs.items():
        path = SITES / site / "site_config.json"
        current = json.loads(path.read_text())
        if "_snapshot_scheduler_enabled" in original:
            frappe.init(site=site, sites_path=str(SITES))
            frappe.connect()
            try:
                frappe.db.set_single_value("System Settings", "enable_scheduler", int(original["_snapshot_scheduler_enabled"]))
                frappe.db.commit()
                frappe.clear_cache()
            finally:
                frappe.destroy()
        for key in FLAGS:
            if key in original:
                current[key] = original[key]
            else:
                current.pop(key, None)
        write_json(path, current)
    GUARD.unlink()


def hold():
    for path in SITES.glob("*/site_config.json"):
        write_json(path, {**json.loads(path.read_text()), "maintenance_mode": 1, "pause_scheduler": 1})


command, *args = sys.argv[1:]
if command == "prepare":
    prepare()
elif command == "drain":
    drain(int(args[0]))
elif command == "backup":
    backup(*args)
elif command == "restore":
    restore(args[0], args[1], args[2] == "in-place")
elif command == "rewrite":
    rewrite(args[0], args[1], int(args[2]), args[3] == "frozen", float(args[4]), *args[5:])
elif command == "release":
    release()
elif command == "hold":
    hold()
else:
    raise RuntimeError("unknown recovery command")
