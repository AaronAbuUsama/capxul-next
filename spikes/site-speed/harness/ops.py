"""The site's half of doc.create, doc.submit and report.run, as the site's API user over HTTP through web with the
site's Host (what Core's calls become at the bench, minus the door's hop): a Journal Entry made, then submitted, then
the General Ledger run. record.export is not here: it reads Core's own record (packages/core src/site-ops/world.ts,
recordExport), never a site.
    ops.py <site> <rounds>     prints each call's milliseconds"""
import sys
import time

from lib import emit, ok, saved_credential

site, rounds = sys.argv[1], int(sys.argv[2])
auth = saved_credential(site)
company = ok(site, "GET", "/api/resource/Company?limit=1", auth=auth)[0]["data"][0]["name"]


def account(kind):
    q = f'/api/resource/Account?filters=[["company","=","{company}"],["{kind[0]}","=","{kind[1]}"],["is_group","=",0]]&limit=1'
    return ok(site, "GET", q.replace(" ", "%20").replace('"', "%22"), auth=auth)[0]["data"][0]["name"]


cash, income = account(("account_type", "Cash")), account(("root_type", "Income"))
calls = {"doc.create": [], "doc.submit": [], "report.run": []}
t0 = time.monotonic()
for i in range(rounds):
    made, ms = ok(site, "POST", "/api/resource/Journal%20Entry", {
        "company": company, "posting_date": time.strftime("%Y-%m-%d"), "user_remark": f"ops {i}",
        "accounts": [{"account": cash, "debit_in_account_currency": 5}, {"account": income, "credit_in_account_currency": 5}]},
        auth)
    calls["doc.create"].append(ms)
    doc = made["data"]
    _, ms = ok(site, "POST", "/api/method/frappe.client.submit", {"doc": doc}, auth)
    calls["doc.submit"].append(ms)
    _, ms = ok(site, "POST", "/api/method/frappe.desk.query_report.run", {
        "report_name": "General Ledger", "filters": {"company": company, "from_date": "2026-01-01", "to_date": "2027-12-31",
                                                     "group_by": "Group by Voucher (Consolidated)"},
        "ignore_prepared_report": True}, auth)
    calls["report.run"].append(ms)


def summary(xs):
    xs = sorted(xs)
    return {"n": len(xs), "median_ms": xs[len(xs) // 2], "max_ms": xs[-1], "min_ms": xs[0]}


emit({"site": site, "rounds": rounds, "wall_ms": round((time.monotonic() - t0) * 1000),
      "calls": {k: summary(v) for k, v in calls.items()}, "raw_ms": calls})
