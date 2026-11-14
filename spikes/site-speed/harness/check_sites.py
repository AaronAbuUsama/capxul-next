"""That each made site works: its world (capxul.clock.now, as a guest), then doc.create, doc.submit and report.run
as its own API user (ops.py's calls, three rounds), and its table count against the template's.
    check_sites.py <template-site> <site> [<site>...]"""
import subprocess
import sys

from lib import emit, ok, site_config, sql

template, sites = sys.argv[1], sys.argv[2:]


def tables(site):
    return int(sql(f"select count(*) from information_schema.tables where table_schema='{site_config(site)['db_name']}'")[0][0][0])


out = []
for site in sites:
    now, _ = ok(site, "GET", "/api/method/capxul.clock.now")
    run = subprocess.run([sys.executable, "/opt/spike/ops.py", site, "3"], capture_output=True, text=True)
    out.append({"site": site, "world": now["message"]["world"], "tables": tables(site), "template_tables": tables(template),
                "ops_ok": run.returncode == 0, "ops_error": None if run.returncode == 0 else run.stderr[-300:]})
emit({"question": "made sites work", "sites": out})
