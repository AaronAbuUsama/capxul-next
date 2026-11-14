"""Q3a: a fresh site by cloning a template site's MariaDB database directly, then the same joins a restore makes.
    clone.py <template-site> <new-site> <world> <dump|sql|copied> [--one-process] [--db <already-copied-db>]
  dump    mariadb-dump of the template piped straight into mariadb (no gzip, no file), on the bench
  sql     inside MariaDB: CREATE TABLE ... LIKE and INSERT ... SELECT for every table (no client transfer)
  copied  the database was copied already (clone_ts.sh, at the storage level): only the site around it is made
The site around the database: the template's folder copied (its files), a site_config.json naming the new database
and a new MariaDB user, the template's encryption key. Then, as snapshots.py's restore: join the world
(capxul.world.rewrite), the world clock, the API user's credential, the scheduler. With --one-process those four run
in one Python process of the bench instead of four (each process pays Frappe's start)."""
import json
import os
import secrets
import shutil
import subprocess
import sys
import time

from lib import (BENCH, CORE_USER, DB_ROOT, bench, core_credential, credential, emit, loadavg, py, site_config, sql,
                 write_site_config)

src, dst, world, method = sys.argv[1:5]
one = "--one-process" in sys.argv
src_db = site_config(src)["db_name"]
new_db = sys.argv[sys.argv.index("--db") + 1] if "--db" in sys.argv else "_" + secrets.token_hex(8)
before = loadavg()
steps = []
t0 = time.monotonic()


def step(name, fn):
    s0 = time.monotonic()
    fn()
    steps.append({"step": name, "ms": round((time.monotonic() - s0) * 1000)})


def by_dump():
    sql(f"create database `{new_db}`")
    env = {**os.environ, "MYSQL_PWD": DB_ROOT}
    dump = subprocess.Popen(["mariadb-dump", "-h", "mariadb", "-uroot", "--single-transaction", "--quick",
                             "--routines", "--triggers", src_db], stdout=subprocess.PIPE, env=env)
    load = subprocess.run(["mariadb", "-h", "mariadb", "-uroot", new_db], stdin=dump.stdout, capture_output=True, env=env)
    dump.stdout.close()
    if dump.wait() != 0 or load.returncode != 0:
        raise RuntimeError(f"dump/load: {load.stderr[-400:]}")


def by_sql():
    tables = [r[0] for r in sql(f"select table_name from information_schema.tables where table_schema='{src_db}' "
                                "and table_type in ('BASE TABLE','SEQUENCE')")[0]]
    stmts = [f"create database `{new_db}`;", "set foreign_key_checks=0;", "set unique_checks=0;"]
    for t in tables:
        stmts.append(f"create table `{new_db}`.`{t}` like `{src_db}`.`{t}`;")
        stmts.append(f"insert into `{new_db}`.`{t}` select * from `{src_db}`.`{t}`;")
    sql("\n".join(stmts))


def site_around():
    shutil.copytree(f"{BENCH}/sites/{src}", f"{BENCH}/sites/{dst}", ignore=shutil.ignore_patterns("logs", "locks"))
    os.makedirs(f"{BENCH}/sites/{dst}/logs", exist_ok=True)
    os.makedirs(f"{BENCH}/sites/{dst}/locks", exist_ok=True)
    conf = site_config(src)
    password = secrets.token_hex(12)
    conf.update({"db_name": new_db, "db_user": new_db, "db_password": password})
    sql(f"create user '{new_db}'@'%' identified by '{password}'; grant all privileges on `{new_db}`.* to '{new_db}'@'%';"
        " flush privileges;")
    write_site_config(dst, conf)


JOIN = """
import os, json, frappe
frappe.init(site=os.environ["SITE"], sites_path="."); frappe.connect()
from capxul import world, clock
world.rewrite.__wrapped__(os.environ["WORLD"], "", "", os.environ["SITE"]) if hasattr(world.rewrite, "__wrapped__") else world.rewrite(os.environ["WORLD"], "", "", os.environ["SITE"])
(clock.write_world.__wrapped__ if hasattr(clock.write_world, "__wrapped__") else clock.write_world)(os.environ["WORLD"], 0)
user = frappe.get_doc("User", os.environ["CORE_USER"])
user.api_key = os.environ["CORE_KEY"]; user.api_secret = os.environ["CORE_SECRET"]
user.save(ignore_permissions=True)
from frappe.utils.scheduler import enable_scheduler; enable_scheduler()
frappe.db.commit()
print("joined")
"""

if method == "dump":
    step("database: mariadb-dump | mariadb", by_dump)
elif method == "sql":
    step("database: create like + insert select", by_sql)
elif method != "copied":
    sys.exit(f"unknown method {method}")
step("site folder, config and db user", site_around)
key, secret = credential(dst)
if one:
    step("join world + clock + core credential + scheduler (one process)",
         lambda: py(JOIN, SITE=dst, WORLD=world, CORE_USER=CORE_USER, CORE_KEY=key, CORE_SECRET=secret))
else:
    step("join world", lambda: bench("--site", dst, "execute", "capxul.world.rewrite", "--kwargs",
                                     json.dumps({"world": world, "core_url": "", "browser_core_url": "", "site": dst})))
    step("world clock", lambda: bench("--site", dst, "execute", "capxul.clock.write_world", "--kwargs",
                                      json.dumps({"world": world, "offset_ms": 0})))
    step("core user", lambda: core_credential(dst, key, secret))
    step("enable scheduler", lambda: bench("--site", dst, "enable-scheduler"))
emit({"question": f"Q3a clone by {method}", "template": src, "site": dst, "one_process": one, "steps": steps,
      "total_ms": round((time.monotonic() - t0) * 1000), "loadavg_before": before, "loadavg_after": loadavg()})
