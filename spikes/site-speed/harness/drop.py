"""Removes sites as the door does (`bench drop-site`, no backup), with their saved copies and credentials.
    drop.py <site> [<site>...]   prints each site's milliseconds"""
import os
import shutil
import sys
import tempfile
import time

from lib import BENCH, DB_ROOT, bench, emit, site_config, sql

out = []
for site in sys.argv[1:]:
    t0 = time.monotonic()
    db = site_config(site)["db_name"] if os.path.exists(f"{BENCH}/sites/{site}/site_config.json") else None
    archive = tempfile.mkdtemp(prefix="dropped-")
    bench("drop-site", site, "--db-root-password", DB_ROOT, "--no-backup", "--force", "--archived-sites-path", archive)
    shutil.rmtree(archive, ignore_errors=True)
    if db:
        sql(f"drop database if exists `{db}_snap`; drop database if exists `{db}_next`; drop database if exists `{db}_trash`;")
    for extra in (f"{BENCH}/sites/.spike-backups/{site}", f"{BENCH}/sites/.spike-saved/{site}"):
        shutil.rmtree(extra, ignore_errors=True)
    if os.path.exists(f"{BENCH}/sites/.spike-creds/{site}"):
        os.remove(f"{BENCH}/sites/.spike-creds/{site}")
    out.append({"site": site, "ms": round((time.monotonic() - t0) * 1000)})
emit({"dropped": out})
