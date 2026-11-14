"""Q3c: what a second (third...) company on one site costs: an ERPNext Company inserted on a site that already has
one (its chart of accounts, cost centre, warehouses and defaults are made by ERPNext's own Company hooks, as the
wizard makes the first), then the Safe's bank and ledger accounts for it (capxul.setup.ensure_safe_account, what
`configure` adds). One Python process of the bench per company.
    add_company.py <site> <company> [<company>...]"""
import json
import secrets
import sys

from lib import emit, py

site, names = sys.argv[1], sys.argv[2:]
ADD = """
import os, json, time, frappe
frappe.init(site=os.environ["SITE"], sites_path="."); frappe.connect(); frappe.set_user("Administrator")
s = time.monotonic()
c = frappe.get_doc({"doctype": "Company", "company_name": os.environ["COMPANY"], "abbr": os.environ["ABBR"],
                    "default_currency": "USD", "country": "United Kingdom", "chart_of_accounts": "Standard"})
c.insert(ignore_permissions=True); frappe.db.commit()
made = round((time.monotonic() - s) * 1000); s = time.monotonic()
from capxul import setup
setup.ensure_safe_account(c.name, "0x" + os.urandom(20).hex()); frappe.db.commit()
print(json.dumps({"company": c.name, "company_ms": made, "safe_account_ms": round((time.monotonic() - s) * 1000),
                  "companies_on_site": frappe.db.count("Company"), "accounts_on_site": frappe.db.count("Account")}))
"""
out = []
for name in names:
    stdout, ms = py(ADD, SITE=site, COMPANY=name, ABBR="C" + secrets.token_hex(2).upper())
    out.append({**json.loads(stdout.strip().splitlines()[-1]), "process_ms": ms})
emit({"question": "Q3c more companies on one site", "site": site, "added": out})
