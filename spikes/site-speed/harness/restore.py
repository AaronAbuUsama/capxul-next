"""Q2: a site from a template, as the door does it (packages/platform/door/snapshots.py): `bench backup` of the
template's database, then a new site from that dump (`bench new-site --source-sql`), its encryption key, joined to the
new world (`capxul.world.rewrite`), the world's clock, the API user's new credential, the scheduler.
    restore.py <template-site> <new-site> <world> [--no-backup <dump>]"""
import glob
import json
import os
import secrets
import shutil
import sys
import time

from lib import BENCH, DB_ROOT, bench, core_credential, credential, emit, loadavg, site_config, sql, write_site_config

src, dst, world = sys.argv[1:4]
before = loadavg()
steps = []
folder = f"{BENCH}/sites/.spike-backups/{src}"
if "--no-backup" in sys.argv:
    dump = sys.argv[sys.argv.index("--no-backup") + 1]
else:
    shutil.rmtree(folder, ignore_errors=True)
    os.makedirs(folder)
    _, ms = bench("--site", src, "backup", "--backup-path", folder)
    dump = glob.glob(f"{folder}/*-database.sql.gz")[0]
    for extra in glob.glob(f"{folder}/*"):
        if extra != dump:
            os.remove(extra)
    steps.append({"step": "bench backup (template)", "ms": ms})
rows, _ = sql(f"select count(*), sum(table_rows), round(sum(data_length+index_length)/1048576,1) from "
              f"information_schema.tables where table_schema='{site_config(src)['db_name']}'")
size = {"dump_gz_bytes": os.path.getsize(dump), "tables": int(rows[0][0]), "rows_estimate": int(rows[0][1]),
        "data_index_mb": float(rows[0][2])}
key, secret = credential(dst)
t0 = time.monotonic()
_, ms = bench("new-site", dst, "--mariadb-user-host-login-scope=%", "--db-root-password", DB_ROOT, "--admin-password",
              secrets.token_hex(16), "--source-sql", dump)
steps.append({"step": "new-site from backup", "ms": ms})
s0 = time.monotonic()
conf = site_config(dst)
conf["encryption_key"] = site_config(src).get("encryption_key")
write_site_config(dst, conf)
steps.append({"step": "encryption key", "ms": round((time.monotonic() - s0) * 1000)})
_, ms = bench("--site", dst, "execute", "capxul.world.rewrite", "--kwargs",
              json.dumps({"world": world, "core_url": "", "browser_core_url": "", "site": dst}))
steps.append({"step": "join world", "ms": ms})
_, ms = bench("--site", dst, "execute", "capxul.clock.write_world", "--kwargs", json.dumps({"world": world, "offset_ms": 0}))
steps.append({"step": "world clock", "ms": ms})
steps.append({"step": "core user", "ms": core_credential(dst, key, secret)})
_, ms = bench("--site", dst, "enable-scheduler")
steps.append({"step": "enable scheduler", "ms": ms})
emit({"question": "Q2 site from a template (door's restore path)", "template": src, "site": dst, "size": size,
      "steps": steps, "restore_ms": round((time.monotonic() - t0) * 1000), "loadavg_before": before,
      "loadavg_after": loadavg()})
