"""Q2's data: grows a site's books so restore can be timed against size. `real` Journal Entries are made and
submitted through Frappe (each posts GL and payment-ledger rows, as a payment does); then the ledger tables are
multiplied `factor` times by copying their rows under new names in SQL, which is what a restore's time depends on
(rows and bytes), not how the rows were written.
    grow.py <site> <real> <factor>"""
import json
import os
import sys
import time

from lib import emit, py, site_config, sql

site, real, factor = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
MAKE = """
import os, frappe, json, time
frappe.init(site=os.environ["SITE"], sites_path="."); frappe.connect(); frappe.set_user("Administrator")
company = frappe.db.get_value("Company", {})
cash = frappe.db.get_value("Account", {"company": company, "account_type": "Cash", "is_group": 0})
income = frappe.db.get_value("Account", {"company": company, "root_type": "Income", "is_group": 0})
t0 = time.monotonic()
for i in range(int(os.environ["N"])):
    je = frappe.get_doc({"doctype": "Journal Entry", "company": company, "posting_date": frappe.utils.nowdate(),
        "user_remark": f"spike row {i}", "accounts": [{"account": cash, "debit_in_account_currency": 10 + i},
        {"account": income, "credit_in_account_currency": 10 + i}]})
    je.insert(); je.submit()
    if i % 100 == 99: frappe.db.commit()
frappe.db.commit()
print(json.dumps({"made": int(os.environ["N"]), "ms": round((time.monotonic() - t0) * 1000)}))
"""
out = {"site": site}
if real:
    stdout, ms = py(MAKE, timeout=3600, SITE=site, N=str(real))
    out["real"] = json.loads(stdout.strip().splitlines()[-1])
db = site_config(site)["db_name"]
if factor > 1:
    t0 = time.monotonic()
    for table in ("tabGL Entry", "tabJournal Entry", "tabJournal Entry Account", "tabPayment Ledger Entry"):
        cols = [r[0] for r in sql(f"select column_name from information_schema.columns where table_schema='{db}' "
                                   f"and table_name='{table}' order by ordinal_position")[0]]
        sel = ", ".join("concat(`name`, '-x', k.k)" if c == "name" else f"`{c}`" for c in cols)
        sql(f"create temporary table k (k int); insert into k select seq from seq_1_to_{factor - 1}; "
            f"insert into `{table}` ({', '.join(f'`{c}`' for c in cols)}) select {sel} from `{table}` "
            f"join k where `name` not like '%-x%'", db=db)
    out["multiplied"] = {"factor": factor, "ms": round((time.monotonic() - t0) * 1000)}
out["rows"] = {t: int(sql(f"select count(*) from `{t}`", db=db)[0][0][0]) for t in
               ("tabGL Entry", "tabJournal Entry", "tabJournal Entry Account", "tabPayment Ledger Entry")}
emit(out)
