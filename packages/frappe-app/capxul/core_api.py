"""What Core asks of a company's site for the blueprint's document, report and clock operations (packages/core,
src/site-ops). Core reaches the site only through the bench's site door, as the site's own API user
(`capxul-core@service.invalid`, made by the door with the world's credential), and these methods refuse anyone else.

Each call names the company (`org`, the site's Capxul Settings `org_slug`) and the person it acts for, by the email of
their site user (`user`). A document or a report is then run as that person: `frappe.set_user`, and from there on
Frappe's own permissions, the person's roles from their hats, and the feature switches. A person with no enabled user
wearing a hat here has no site user, and nothing is run. Core never acts as anyone else on the site.

Every method answers HTTP 200 with Frappe's `message`: the answer, or a refusal `{"refused": <code>, ...}` that the
call changed nothing for (a savepoint is rolled back). A fault (a bug, the database) is Frappe's own HTTP 500.

  org-not-here      this site is not the company's: Core asks the world's next site
  no-site-user      the person has no user here
  site-refused      Frappe refused by its own rules: `reason` permission, validation, not_found or part_off
  not-a-draft       a submit of a document that is not a draft, with its `docstatus`
"""
import json

import frappe

from capxul import clock, features, payments
from capxul.canon import document_hash as canon_hash, money, stored_fields, stored_hash, to_address_for

CORE_USER = "capxul-core@service.invalid"


class Refusal(Exception):
    def __init__(self, code, **detail):
        super().__init__(code)
        self.answer = {"refused": code, **detail}


def _site_refused(target, reason, message):
    return Refusal("site-refused", target=target, reason=reason, message=str(message)[:500])


def _core_only():
    if frappe.session.user != CORE_USER:
        frappe.throw("Only Capxul Core calls this", frappe.PermissionError)


def _as_person(org, user):
    """Checks the company and the person, then runs the rest of the call as the person."""
    if org != frappe.db.get_single_value("Capxul Settings", "org_slug"):
        raise Refusal("org-not-here", org=org)
    email = (user or "").strip().lower()
    if not email or not frappe.db.get_value("User", email, "enabled") or not frappe.db.exists("Capxul Hat Grant", {"user": email}):
        raise Refusal("no-site-user")
    form = frappe.local.form_dict
    frappe.set_user(email)
    frappe.local.form_dict = form
    return email


def _answer(target, action):
    """Runs `action`, answering what it returns, or a refusal with everything it wrote rolled back."""
    _core_only()
    frappe.db.savepoint("capxul_core_api")
    try:
        return action()
    except Exception as error:  # noqa: BLE001 -- each kind of refusal is named below; anything else is re-raised
        frappe.db.rollback(save_point="capxul_core_api")
        frappe.local.message_log = []
        if isinstance(error, Refusal):
            return error.answer
        if isinstance(error, features.FeatureNotAvailable):
            return _site_refused(target, "part_off", error).answer
        if isinstance(error, frappe.PermissionError):
            return _site_refused(target, "permission", error).answer
        if isinstance(error, frappe.DoesNotExistError):
            return _site_refused(target, "not_found", error).answer
        if isinstance(error, (frappe.ValidationError, frappe.NameError)):
            return _site_refused(target, "validation", error).answer
        raise


def _part_on(doctype):
    off = features.off_map()["doctypes"].get(doctype)
    if off:
        raise _site_refused(doctype, "part_off", f"the {off} part is off for this company")


def _fields(values):
    if not isinstance(values, dict):
        raise _site_refused("", "validation", "fields must be an object")
    protected = {"doctype", "docstatus", "flags", "name", "ignore_permissions", "owner"}
    if any(k in protected or k.startswith("_") for k in values):
        raise _site_refused("", "validation", "a protected field was given")
    return values


def _json(body):
    return body if isinstance(body, (dict, list)) or body is None else json.loads(body)


# ---- documents ---------------------------------------------------------------------------------------------------------
@frappe.whitelist(methods=["POST"])
def create(org, user, doctype, fields):
    def action():
        _as_person(org, user)
        if not frappe.db.exists("DocType", doctype):
            raise _site_refused(doctype, "not_found", f"no doctype {doctype}")
        _part_on(doctype)
        doc = frappe.get_doc({**_fields(_json(fields)), "doctype": doctype}).insert()
        return {"doctype": doc.doctype, "name": doc.name, "docstatus": doc.docstatus, "fields": stored_fields(doc),
                "hash": stored_hash(doc, payments.settings().asset or "USDC")}
    return _answer(doctype, action)


def _draft(doctype, name):
    if not frappe.db.exists(doctype, name):
        raise _site_refused(doctype, "not_found", f"no {doctype} {name}")
    doc = frappe.get_doc(doctype, name)
    doc.check_permission("read")
    if doc.docstatus != 0:
        raise Refusal("not-a-draft", docstatus=doc.docstatus)
    doc.check_permission("submit")
    return doc


@frappe.whitelist(methods=["POST"])
def submit(org, user, doctype, name):
    """Posts an ordinary document. A Payment Entry from the company Safe is not posted: its payment is answered, as the
    document and its Supplier hold it (decisions.md, 28), and nothing changes until Core asks for the hold."""
    def action():
        _as_person(org, user)
        _part_on(doctype)
        doc = _draft(doctype, name)
        if not payments.is_safe_backed(doc):
            doc.submit()
            return {"posted": {"doctype": doc.doctype, "name": doc.name, "docstatus": doc.docstatus}}
        s = payments.settings()
        address = to_address_for(doc)
        if not address:
            raise _site_refused(doctype, "validation", f"{doc.party} has no Capxul Wallet Address")
        if frappe.db.exists("Capxul Payment Request", {"payment_entry": name, "status": ["in", ["Requesting", payments.WAITING]]}):
            raise _site_refused(doctype, "validation", f"{name} is already held for a signature")
        return {"payment": {"payee": doc.party, "payee_address": address, "amount": money(doc.paid_amount),
                            "asset": s.asset or "USDC", "safe": s.safe_address,
                            "document_hash": canon_hash(doc, s.asset or "USDC")}}
    return _answer(doctype, action)


@frappe.whitelist(methods=["POST"])
def hold(org, user, name, document_hash, request, approval, payment_id):
    """Holds a Payment Entry from the company Safe for its signer: one Capxul Payment Request, waiting for the signature
    Core opened, carrying the hash doc.create answered. The entry stays a draft; the chain's payment posts it."""
    doctype = "Payment Entry"

    def action():
        email = _as_person(org, user)
        doc = _draft(doctype, name)
        s = payments.settings()
        if not payments.is_safe_backed(doc):
            raise _site_refused(doctype, "validation", f"{name} is not paid from the company Safe")
        if canon_hash(doc, s.asset or "USDC") != document_hash:
            raise _site_refused(doctype, "validation", f"{name} changed after it was created")
        frappe.db.sql("select name from `tabPayment Entry` where name=%s for update", name)
        row = frappe.db.sql("select value from tabSingles where doctype='Capxul Settings' and field='request_seq' for update")
        seq = int((row[0][0] if row else 0) or 0) + 1
        frappe.db.set_single_value("Capxul Settings", "request_seq", seq)
        body = {"request_id": request, "approval_id": approval, "payment_id": payment_id, "org": org, "site": frappe.local.site,
                "doctype": doctype, "name": name, "document_hash": document_hash, "requested_by": email,
                "to_party": doc.party, "to_address": to_address_for(doc), "amount": money(doc.paid_amount),
                "asset": s.asset or "USDC", "cursor": seq}
        frappe.get_doc({"doctype": "Capxul Payment Request", "payment_entry": name, "document_hash": document_hash,
                        "status": payments.WAITING, "requested_by": email, "approval_id": approval,
                        "canonical_json": payments.canonical(doc, s.asset or "USDC"), "request_seq": seq,
                        "request_json": json.dumps(body, sort_keys=True)}).insert(ignore_permissions=True)
        frappe.db.set_value(doctype, name, {"capxul_status": payments.WAITING}, update_modified=False)
        return {"held": {"doctype": doctype, "name": name, "docstatus": 0}}
    return _answer(doctype, action)


# ---- reports -----------------------------------------------------------------------------------------------------------
# What ERPNext requires of a report and Core fills when the caller leaves it out (packages/blueprint, Site.FILTERS):
# `company` always; for a report over a period, the company's first day to the world's today.
PERIOD = {"General Ledger", "Trial Balance", "Profit and Loss Statement", "Balance Sheet", "Cash Flow"}
AS_AT = {"Accounts Payable", "Accounts Receivable", "Accounts Payable Summary", "Accounts Receivable Summary"}


def _filled(report, filters):
    today = frappe.utils.nowdate()
    company = frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value("Company", {})
    out = {"company": company, **filters}
    if report in PERIOD:
        from erpnext.accounts.utils import get_fiscal_year

        year = get_fiscal_year(out.get("to_date") or today, company=company)
        first = min(str(frappe.db.get_value("Company", company, "creation"))[:10], str(year[1]))
        posted = frappe.db.sql("select min(posting_date) from `tabGL Entry` where company=%s", company)[0][0]
        out.setdefault("to_date", today)
        out.setdefault("from_date", min(first, str(posted)) if posted else first)
        if report == "Trial Balance":  # Trial Balance reads within one fiscal year only
            out.setdefault("fiscal_year", year[0])
            out["from_date"] = max(out["from_date"], str(year[1]))
    if report == "General Ledger":
        out.setdefault("group_by", "Group by Voucher (Consolidated)")
        if isinstance(out.get("account"), str):  # the General Ledger takes a list of accounts
            out["account"] = [out["account"]]
    if report in AS_AT:
        out.setdefault("report_date", today)
    return out


def _plain(value):
    return json.loads(frappe.as_json(value))


NOT_COLUMNS = {"Section Break", "Column Break", "Tab Break", "Table", "Table MultiSelect", "HTML", "Button", "Heading", "Fold"}


def _list(doctype, filters):
    """A doctype's name runs its list (Frappe's report view): one row per document the person may read, every stored
    field of it. A virtual field is not stored, so it is not a column."""
    frappe.has_permission(doctype, "read", throw=True)
    meta = frappe.get_meta(doctype)
    columns = [{"field": "name", "label": "Name", "type": "Data"}] + [
        {"field": df.fieldname, "label": df.label or df.fieldname, "type": df.fieldtype}
        for df in meta.fields if df.fieldtype not in NOT_COLUMNS and not df.get("is_virtual")]
    rows = frappe.get_list(doctype, filters=filters, fields=["*"], order_by="creation asc", limit_page_length=0)
    return {"report": doctype, "columns": columns, "rows": _plain(rows)}


@frappe.whitelist(methods=["POST"])
def report(org, user, report, filters=None):
    def action():
        _as_person(org, user)
        given = _json(filters) or {}
        if not frappe.db.exists("Report", report):
            if frappe.db.exists("DocType", report):
                _part_on(report)
                return _list(report, given)
            raise _site_refused(report, "not_found", f"no report {report}")
        from frappe.desk.query_report import run as run_report

        # Who may open it comes before whether its part is on: a report the person's roles do not open is refused
        # for permission, whatever its part (report.run 2: the payroll report as the person who keeps the books).
        if not frappe.get_doc("Report", report).is_permitted():
            raise _site_refused(report, "permission", f"{report} is not open to {frappe.session.user}")
        _part_on(frappe.db.get_value("Report", report, "ref_doctype"))
        data = run_report(report, filters=_filled(report, given), ignore_prepared_report=True)
        columns = [c if isinstance(c, dict) else {"fieldname": c.split(":")[0], "label": c.split(":")[0]} for c in data["columns"]]
        fields = [c.get("fieldname") or c.get("label") for c in columns]
        rows = [dict(zip(fields, r)) if isinstance(r, (list, tuple)) else r for r in data["result"] if r]
        return {"report": report, "rows": _plain([r for r in rows if isinstance(r, dict)]),
                "columns": [{"field": f, "label": c.get("label") or f, "type": c.get("fieldtype") or "Data"} for f, c in zip(fields, columns)]}
    return _answer(report, action)


# ---- the clock ---------------------------------------------------------------------------------------------------------
@frappe.whitelist(methods=["POST"])
def warp(from_ms, to_ms, frozen, write):
    """Moves this site from the world's `from_ms` to `to_ms` (UTC ms), stopping at 01:00 of every day between and running
    what fell due at each stop (capxul.clock.advance), so the daily job runs once for each day passed. With `write`,
    the world's clock on the bench is then set, which moves every site of the world: Core sets it with its last site."""
    _core_only()
    from frappe.core.doctype.scheduled_job_type.scheduled_job_type import sync_jobs

    sync_jobs()
    clock.name_daily_job()
    # A run of the daily job is a row of the Scheduled Job Log only when its type keeps a log.
    frappe.db.set_value("Scheduled Job Type", {"method": clock.DAILY_JOB}, "create_log", 1)
    # What fell due is counted from the world's `from_ms`: a job that never ran, or that ran later by the site's own
    # clock, is due from there (as capxul.clock.rewind_jobs does), so a warp of n days runs a daily job n times.
    start = clock.site_time(int(from_ms))
    frappe.db.sql("update `tabScheduled Job Type` set last_execution=%s where last_execution > %s or last_execution is null",
                  (start, start))
    host = clock._host_ms()
    moved = clock.advance.__wrapped__(int(from_ms) - host, int(to_ms) - host)
    if write in (True, 1, "1", "true"):
        clock.write_world.__wrapped__(clock.world_of_site(), int(to_ms) - host,
                                      int(to_ms) if frozen in (True, 1, "1", "true") else None)
    frappe.db.commit()
    return {"site": frappe.local.site, "stops": moved["stops"], "jobs": moved["jobs_run"]}
