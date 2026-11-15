"""The door's direct hands on a site's data (roadmap step 1.17; measured in records/site-speed, Q3a and Q4): copying a
site's database inside MariaDB, finding the tables that changed against a saved copy and putting them back, and
clearing what Redis holds for a site (its cache keys and its queued jobs). No bench process runs here: every
statement goes to MariaDB over one root connection of the door's own, so these calls cost what MariaDB does.

A copy is `CREATE TABLE … LIKE` for every table and sequence, then every `INSERT … SELECT` in one transaction, so a
copy of a site that is serving is one consistent moment of it (a 926-table site: about 3 s). Frappe's cache keys of a
site begin with its database name (frappe/utils/redis_wrapper.py, make_key); its queued jobs' ids with its name and
`||` (frappe/utils/background_jobs.py, create_job_id).
"""

import json
import os
import secrets
import time
from urllib.parse import urlsplit

import pymysql

from sites import BENCH, DB_ROOT

def new_name():
    """A database name of the kind Frappe gives a site: `_` and 16 hex digits."""
    return "_" + secrets.token_hex(8)


def q(name):
    return "`" + name.replace("`", "``") + "`"


def connect():
    return pymysql.connect(host="mariadb", user="root", password=DB_ROOT, autocommit=True, charset="utf8mb4",
                           read_timeout=900, write_timeout=900)


def run(statements, conn=None):
    """Runs statements in order on one connection; answers the rows of the last."""
    if not statements:
        return ()
    own = conn is None
    conn = conn or connect()
    try:
        with conn.cursor() as cur:
            for statement in statements:
                cur.execute(statement)
            return cur.fetchall()
    finally:
        if own:
            conn.close()


def tables(schema, conn=None):
    """Every table and sequence of a database: {name: "BASE TABLE" | "SEQUENCE"}."""
    rows = run([f"select table_name, table_type from information_schema.tables where table_schema = '{schema}' "
                "and table_type in ('BASE TABLE', 'SEQUENCE') order by table_name"], conn)
    return {name: kind for name, kind in rows}


# What a copy of a site that is serving may meet: a row written by the site after the copy began (InnoDB's snapshot
# isolation, on by default in MariaDB 11.8), a deadlock with a writer, or a lock wait timeout. The copy starts again.
RETRY = (1020, 1205, 1213)


def copy(src, dst, conn=None, tries=3):
    """Copies database `src` into a new database `dst` inside MariaDB, as one moment of it. Answers its tables.

    Every row is copied in one transaction by `INSERT … SELECT`, a locking read under REPEATABLE READ: each row read
    stays locked until the commit, so a writer of the site waits for the copy (about 3 s) or, in a deadlock, makes the
    copy start again; either way the copy holds the site as it was at one moment. Snapshot isolation is off for the
    copy's own session, so a row written just before it is read is copied rather than refused."""
    own = conn is None
    conn = conn or connect()
    try:
        found = tables(src, conn)
        for attempt in range(tries):
            run([f"create database {q(dst)}"] +
                [f"create table {q(dst)}.{q(t)} like {q(src)}.{q(t)}" for t in found], conn)
            try:
                run(["set session innodb_snapshot_isolation = 0", "set foreign_key_checks = 0",
                     "set unique_checks = 0", "start transaction"] +
                    [f"insert into {q(dst)}.{q(t)} select * from {q(src)}.{q(t)}" for t in found] +
                    ["commit", "set foreign_key_checks = 1", "set unique_checks = 1"], conn)
                return found
            except pymysql.err.OperationalError as e:
                run(["rollback", f"drop database {q(dst)}"], conn)
                if e.args[0] not in RETRY or attempt == tries - 1:
                    raise
                print(f"door: copy of {src} started again after MariaDB {e.args[0]}", flush=True)
        return found
    finally:
        if own:
            conn.close()


def checksums(schema, names, conn=None):
    """`CHECKSUM TABLE` of each base table, by name. Sequences are compared by their row (sequence_state)."""
    base = [n for n, kind in names.items() if kind == "BASE TABLE"]
    out = {}
    for i in range(0, len(base), 200):
        rows = run(["checksum table " + ", ".join(f"{q(schema)}.{q(t)}" for t in base[i:i + 200])], conn)
        out.update({name.split(".", 1)[1]: str(value) for name, value in rows})
    for n in (n for n, kind in names.items() if kind == "SEQUENCE"):
        out[n] = json.dumps([str(v) for v in run([f"select * from {q(schema)}.{q(n)}"], conn)[0]])
    return out


def put_back(live, saved, saved_tables, saved_sums, conn=None):
    """Makes database `live` equal to `saved`, touching only what differs: a table changed since the save is emptied
    and filled from the saved copy, a sequence set back, a table made since dropped, a table dropped since made again.
    Answers what it did. Every row change is one transaction."""
    own = conn is None
    conn = conn or connect()
    try:
        now_tables = tables(live, conn)
        live_sums = checksums(live, now_tables, conn)
        changed = sorted(t for t in saved_tables if t in now_tables and live_sums.get(t) != saved_sums.get(t))
        made = sorted(t for t in now_tables if t not in saved_tables)
        gone = sorted(t for t in saved_tables if t not in now_tables)
        rows = [t for t in changed if saved_tables[t] == "BASE TABLE"]
        seqs = [t for t in changed if saved_tables[t] == "SEQUENCE"]
        ddl = [f"drop table {q(live)}.{q(t)}" for t in made] + \
              [f"create table {q(live)}.{q(t)} like {q(saved)}.{q(t)}" for t in gone]
        run(ddl, conn)
        refill = [t for t in rows + gone if saved_tables[t] == "BASE TABLE"]
        run([] if not refill else ["set foreign_key_checks = 0", "start transaction"] +
            [s for t in refill for s in (f"delete from {q(live)}.{q(t)}",
                                         f"insert into {q(live)}.{q(t)} select * from {q(saved)}.{q(t)}")] +
            ["commit", "set foreign_key_checks = 1"], conn)
        for t in seqs + [t for t in gone if saved_tables[t] == "SEQUENCE"]:
            run([f"insert into {q(live)}.{q(t)} select * from {q(saved)}.{q(t)}"], conn)
        return {"tables_changed": changed, "tables_dropped": made, "tables_made": gone}
    finally:
        if own:
            conn.close()


def drop(schema, conn=None):
    run([f"drop database if exists {q(schema)}"], conn)


def make_user(name, password, schema, conn=None):
    run([f"create or replace user '{name}'@'%' identified by '{password}'",
         f"grant all privileges on {q(schema)}.* to '{name}'@'%'"], conn)


def drop_user(name, conn=None):
    run([f"drop user if exists '{name}'@'%'", f"drop user if exists '{name}'@'localhost'"], conn)


# Redis: the bench's common config names it (the door writes that config before it serves).

def _redis(kind):
    import redis

    with open(f"{BENCH}/sites/common_site_config.json") as f:
        url = urlsplit(json.load(f)[kind])
    return redis.Redis(host=url.hostname, port=url.port or 6379, db=int((url.path or "/0")[1:] or 0))


def clear_cache(db_name):
    """Unlinks every cache key of the site (`<db_name>|…`); answers how many."""
    r, n = _redis("redis_cache"), 0
    for batch in _batches(r.scan_iter(match=f"{db_name}|*", count=1000)):
        n += r.unlink(*batch)
    return n


def drop_jobs(site):
    """Removes the site's jobs that are queued and not yet started, from every queue of the bench; answers how many.
    A job already running is left to finish."""
    from rq import Queue
    from rq.job import Job

    r, n = _redis("redis_queue"), 0
    for queue in Queue.all(connection=r):
        for job_id in [j for j in queue.get_job_ids() if j.startswith(f"{site}||")]:
            queue.remove(job_id)
            Job(job_id, connection=r).delete(remove_from_queue=False)
            n += 1
    return n


def _batches(items, size=500):
    batch = []
    for item in items:
        batch.append(item)
        if len(batch) == size:
            yield batch
            batch = []
    if batch:
        yield batch


def site_config(folder):
    with open(f"{folder}/site_config.json") as f:
        return json.load(f)


def write_site_config(folder, conf):
    tmp = f"{folder}/site_config.json.tmp"
    with open(tmp, "w") as f:
        json.dump(conf, f, indent=1)
    os.replace(tmp, f"{folder}/site_config.json")


def ms_since(t0):
    return round((time.monotonic() - t0) * 1000)
