#!/usr/bin/env python3
"""Q3a at the storage level: copies a template site's database as InnoDB files (transportable tablespaces), then
makes the site around it with harness/clone.py `copied`. Runs on the host: the files are in the MariaDB container.
    ./clone_ts.py <template-site> <new-site> <world> [--one-process]   ->  prints a JSON record
In one MariaDB session: every table created LIKE the template's and its tablespace discarded; FLUSH TABLES ... FOR
EXPORT on the template (its files consistent, writes held); the .ibd and .cfg files copied with the client's own
`system` command; UNLOCK TABLES; every table's tablespace imported."""
import json
import os
import secrets
import subprocess
import sys
import time

src, dst, world = sys.argv[1:4]
SECRETS = os.environ.get("SITESPEED_SECRETS",
                         "/tmp/claude-0/-home-user/28910f0a-64fe-53a4-8a78-7fef9aca3143/scratchpad/sitespeed.env")
root = dict(l.strip().split("=", 1) for l in open(SECRETS) if "=" in l)["DB_ROOT_PASSWORD"]


def db(statement, stdin=None):
    out = subprocess.run(["docker", "exec", "-i", "-e", f"MYSQL_PWD={root}", "cx-sitespeed-mariadb", "mariadb", "-uroot",
                          "-N", "-B"] + ([] if stdin else ["-e", statement]), input=stdin, capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(out.stderr[-1500:])
    return [l.split("\t") for l in out.stdout.splitlines() if l]


conf = json.loads(subprocess.check_output(["docker", "exec", "cx-sitespeed-door", "cat",
                                           f"/home/frappe/frappe-bench/sites/{src}/site_config.json"]))
src_db, new_db = conf["db_name"], "_" + secrets.token_hex(8)
rows = db(f"select table_name, engine from information_schema.tables where table_schema='{src_db}' "
          "and table_type in ('BASE TABLE','SEQUENCE') order by table_name")
tables = [r[0] for r in rows if r[1] == "InnoDB"]
others = [r[0] for r in rows if r[1] != "InnoDB"]  # a few log tables in MyISAM, and the sequences: copied by INSERT SELECT
q = lambda t: "`" + t.replace("`", "``") + "`"
# MariaDB's file name for a table: every character but [A-Za-z0-9_] as @ and four hex digits ("tabGL Entry" ->
# tabGL@0020Entry). Only the InnoDB tables' files are copied: a sequence has an .ibd of its own that must not be overwritten.
fname = lambda t: "".join(c if c.isascii() and (c.isalnum() or c == "_") else f"@{ord(c):04x}" for c in t)
script = [f"create database `{new_db}`;", "set foreign_key_checks=0;"]
script += [f"create table `{new_db}`.{q(t)} like `{src_db}`.{q(t)};" for t in tables + others]
script += [f"insert into `{new_db}`.{q(t)} select * from `{src_db}`.{q(t)};" for t in others]
script += [f"alter table `{new_db}`.{q(t)} discard tablespace;" for t in tables]
script += [f"flush tables {', '.join(f'`{src_db}`.{q(t)}' for t in tables)} for export;",
           f"system cd /var/lib/mysql/{src_db} && cp -p "
           + " ".join(f"'{fname(t)}.ibd' '{fname(t)}.cfg'" for t in tables) + f" /var/lib/mysql/{new_db}/",
           "unlock tables;"]
script += [f"alter table `{new_db}`.{q(t)} import tablespace;" for t in tables]
script += [f"system cd /var/lib/mysql/{new_db} && rm -f " + " ".join(f"'{fname(t)}.cfg'" for t in tables)]
t0 = time.monotonic()
marks = {}
db(None, stdin="\n".join(script) + "\n")
copy_ms = round((time.monotonic() - t0) * 1000)
count = db(f"select count(*) from information_schema.tables where table_schema='{new_db}'")
out = subprocess.run(["docker", "exec", "-i", "-w", "/opt/spike", "cx-sitespeed-door", "/home/frappe/frappe-bench/env/bin/python",
                      "clone.py", src, dst, world, "copied", "--db", new_db] + sys.argv[4:], capture_output=True, text=True)
if out.returncode != 0:
    raise RuntimeError(out.stderr[-1500:])
rest = json.loads(out.stdout)
rest["steps"].insert(0, {"step": "database: transportable tablespaces (create like, discard, flush for export, cp, import)",
                         "ms": copy_ms, "innodb_tables": len(tables), "other_tables_by_insert": len(others),
                         "tables_in_copy": int(count[0][0])})
rest["question"] = "Q3a clone at the storage level (InnoDB transportable tablespaces)"
rest["total_ms"] = copy_ms + rest["total_ms"]
print(json.dumps(rest, indent=1))
