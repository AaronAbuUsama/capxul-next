"""Q4: resetting a site in place to a saved point, for a world restored to a snapshot.
    reset.py <site> save             keeps the saved point on the bench: a copy of the site's database (`<db>_snap`,
                                     made inside MariaDB) and a spare copy of that (`<db>_next`) ready for the next reset;
                                     and a gzipped dump, as `bench backup` makes, for the dump method
    reset.py <site> rename           swaps the spare copy in: one atomic RENAME TABLE of every table (live -> trash,
                                     spare -> live), the site's Redis cache cleared; then, off the reset's path, the
                                     old tables dropped and a new spare copied from the saved point
    reset.py <site> changed          only the tables that changed since the save: found by comparing CHECKSUM TABLE
                                     with the saved copy (and, for comparison, by information_schema UPDATE_TIME),
                                     each emptied and filled from the saved copy; the Redis cache cleared
    reset.py <site> dump             the database dropped and loaded again from the saved dump (what a restore in
                                     place by `bench restore` comes to)
Each prints what it did, how long each part took, and the site's Journal Entry count after, read over HTTP."""
import glob
import os
import subprocess
import sys
import time

from lib import BENCH, DB_ROOT, bench, emit, ok, saved_credential, site_config, sql

site, action = sys.argv[1:3]
db = site_config(site)["db_name"]
snap, spare = f"{db}_snap", f"{db}_next"
folder = f"{BENCH}/sites/.spike-saved/{site}"
steps = []


def step(name, fn):
    s0 = time.monotonic()
    r = fn()
    steps.append({"step": name, "ms": round((time.monotonic() - s0) * 1000), **(r if isinstance(r, dict) else {})})
    return r


def tables_of(schema):
    return [r[0] for r in sql(f"select table_name from information_schema.tables where table_schema='{schema}' "
                              "and table_type in ('BASE TABLE','SEQUENCE') order by table_name")[0]]


def q(t):
    return "`" + t.replace("`", "``") + "`"


def copy_db(frm, to):
    stmts = [f"drop database if exists `{to}`;", f"create database `{to}`;", "set foreign_key_checks=0;",
             "set unique_checks=0;"]
    for t in tables_of(frm):
        stmts += [f"create table `{to}`.{q(t)} like `{frm}`.{q(t)};", f"insert into `{to}`.{q(t)} select * from `{frm}`.{q(t)};"]
    sql("\n".join(stmts))
    user = site_config(site)["db_user"]
    sql(f"grant all privileges on `{to}`.* to '{user}'@'%'; flush privileges;")


def clear_cache():
    """Frappe's cache keys for a site begin with its database name (frappe/utils/redis_wrapper.py make_key)."""
    out = subprocess.run(["python3", "-c", f"""
import socket
def cmd(s, *a):
    s.sendall(("*%d\\r\\n" % len(a) + "".join("$%d\\r\\n%s\\r\\n" % (len(x.encode()), x) for x in a)).encode())
s = socket.create_connection(("redis", 6379)); f = s.makefile("rb")
def read():
    l = f.readline()
    if l[:1] == b"*":
        return [read() for _ in range(int(l[1:]))]
    if l[:1] == b"$":
        n = int(l[1:]); v = f.read(n + 2)[:-2] if n >= 0 else None; return v
    return l.strip()
cur, n = "0", 0
while True:
    cmd(s, "SCAN", cur, "MATCH", "{db}|*", "COUNT", "1000"); cur, keys = read(); cur = cur.decode()
    if keys:
        cmd(s, "UNLINK", *[k.decode() for k in keys]); read(); n += len(keys)
    if cur == "0": break
print(n)
"""], capture_output=True, text=True)
    return {"keys_cleared": int(out.stdout.strip() or 0)}


def je_count():
    data, _ = ok(site, "GET", "/api/method/frappe.client.get_count?doctype=Journal%20Entry", auth=saved_credential(site))
    return data["message"]


if action == "save":
    step("saved copy inside MariaDB", lambda: copy_db(db, snap))
    step("spare copy for the next reset", lambda: copy_db(snap, spare))
    os.makedirs(folder, exist_ok=True)
    for old in glob.glob(f"{folder}/*"):
        os.remove(old)
    step("bench backup (gzipped dump)", lambda: bench("--site", site, "backup", "--backup-path", folder) and None)
    sql(f"flush tables")  # every table's UPDATE_TIME is read from here on against this moment
    saved_at = sql("select now()")[0][0][0]
    with open(f"{folder}/.saved_at", "w") as f:
        f.write(saved_at)
elif action == "rename":
    live, nxt = tables_of(db), set(tables_of(spare))
    trash = f"{db}_trash"
    sql(f"create database if not exists `{trash}`")
    pairs = [f"`{db}`.{q(t)} to `{trash}`.{q(t)}" for t in live] + [f"`{spare}`.{q(t)} to `{db}`.{q(t)}" for t in nxt]
    step("rename table: live to trash, spare to live (one statement)", lambda: sql("rename table " + ", ".join(pairs)) and None)
    step("site cache cleared (Redis keys of the site)", clear_cache)
    reset_ms = sum(s["ms"] for s in steps)
    step("off the path: old tables dropped", lambda: sql(f"drop database `{trash}`") and None)
    step("off the path: new spare copied from the saved point", lambda: copy_db(snap, spare))
elif action == "changed":
    with open(f"{folder}/.saved_at") as f:
        saved_at = f.read().strip()
    by_time = [r[0] for r in sql(f"select table_name from information_schema.tables where table_schema='{db}' and "
                                 f"update_time >= '{saved_at}'")[0]]
    null_time = int(sql(f"select count(*) from information_schema.tables where table_schema='{db}' and update_time is null")[0][0][0])
    tables = tables_of(db)

    def checksums():
        live = sql("checksum table " + ", ".join(f"`{db}`.{q(t)}" for t in tables))[0]
        saved = sql("checksum table " + ", ".join(f"`{snap}`.{q(t)}" for t in tables))[0]
        sv = {r[0].split(".", 1)[1]: r[1] for r in saved}
        return {"changed": [r[0].split(".", 1)[1] for r in live if sv.get(r[0].split(".", 1)[1]) != r[1]]}

    found = step("changed tables found by CHECKSUM TABLE (live and saved)", checksums)
    changed = found.pop("changed")
    steps[-1]["tables_changed"] = len(changed)
    steps[-1]["changed_by_update_time"] = len(by_time)
    steps[-1]["update_time_null"] = null_time
    steps[-1]["same_set"] = sorted(changed) == sorted(by_time)
    stmts = ["set foreign_key_checks=0;"] + [s for t in changed for s in (
        f"delete from `{db}`.{q(t)};", f"insert into `{db}`.{q(t)} select * from `{snap}`.{q(t)};")]
    step("changed tables emptied and filled from the saved copy", lambda: sql("\n".join(stmts)) and None)
    step("site cache cleared (Redis keys of the site)", clear_cache)
    reset_ms = sum(s["ms"] for s in steps)
    changed_names = changed
elif action == "dump":
    dump = glob.glob(f"{folder}/*-database.sql.gz")[0]

    def reload():
        sql(f"drop database `{db}`; create database `{db}`;")
        env = {**os.environ, "MYSQL_PWD": DB_ROOT}
        z = subprocess.Popen(["gzip", "-dc", dump], stdout=subprocess.PIPE)
        load = subprocess.run(["mariadb", "-h", "mariadb", "-uroot", db], stdin=z.stdout, capture_output=True, env=env)
        z.stdout.close()
        if z.wait() != 0 or load.returncode != 0:
            raise RuntimeError(load.stderr[-400:])

    step("database dropped and loaded from the saved dump", reload)
    step("site cache cleared (Redis keys of the site)", clear_cache)
    reset_ms = sum(s["ms"] for s in steps)
else:
    sys.exit(f"unknown action {action}")
record = {"question": f"Q4 reset in place: {action}", "site": site, "steps": steps,
          "journal_entries_after": je_count()}
if action != "save":
    record["reset_ms"] = reset_ms
if action == "changed":
    record["changed_tables"] = changed_names
emit(record)
