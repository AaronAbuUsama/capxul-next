"""Whitelisted methods. `chain_event` is the one door from Core into this site."""
import json

import frappe
from frappe import _

from capxul import capital, hats, payments, sign

PARK_AFTER = 3  # a handler failing this many times for one event is given up on (parked), so the queue moves on

KINDS = {
    "hat_granted": hats.apply_hat_granted,
    "hat_revoked": hats.apply_hat_revoked,
    "payment_sent": payments.apply_payment_sent,
    "payment_failed": payments.apply_payment_failed,
    "founder_capital": capital.apply_founder_capital,
}


@frappe.whitelist(allow_guest=True, methods=["POST"])
def chain_event():
    raw = frappe.request.get_data()
    if not sign.valid(raw, frappe.get_request_header("X-Capxul-Signature")):
        frappe.throw(_("Bad signature"), frappe.AuthenticationError)  # 401
    ev = json.loads(raw)
    frappe.set_user("Administrator")  # authenticated by the HMAC, not by a session
    return _process(ev)


def _process(ev):
    key, seq, kind = ev["event_key"], int(ev["seq"]), ev["kind"]
    if ev.get("org") != frappe.db.get_single_value("Capxul Settings", "org_slug"):
        frappe.throw(_("Wrong org"), frappe.PermissionError)
    if kind not in KINDS:
        frappe.throw(_("Unknown kind {0}").format(kind))
    # one event at a time per site: lock the cursor row
    row = frappe.db.sql("select value from tabSingles where doctype='Capxul Settings' and field='last_seq' for update")
    if not row:
        frappe.db.set_single_value("Capxul Settings", "last_seq", 0)
        row = frappe.db.sql("select value from tabSingles where doctype='Capxul Settings' and field='last_seq' for update")
    last = int(row[0][0] or 0)
    state = frappe.db.get_value("Capxul Chain Event", key, "status")
    if state in ("Applied", "Parked"):  # a repeat of an event already dealt with (applied, or given up on)
        return {"applied": False, "last_seq": last}
    if seq != last + 1:
        frappe.local.response["expected"] = last + 1
        frappe.local.response.http_status_code = 409
        return None
    try:
        KINDS[kind](ev["data"], key)
    except Exception as e:
        frappe.db.rollback()
        err = f"{type(e).__name__}: {e}"[:400]
        attempts = (frappe.db.get_value("Capxul Chain Event", key, "attempts") or 0) + 1
        if attempts < PARK_AFTER:  # may be transient: answer 500, Core resends
            _record(ev, "Failed", err, attempts)
            frappe.db.commit()
            raise
        # Deterministic failure: one event must not block every later event (money included). Park it, visibly, and move
        # the cursor on. Money that could not be posted (a payment out, the founder's funding in) is shown as an
        # unreconciled Bank Transaction instead, so it never leaves the books.
        fallback = {"payment_sent": payments._unmatched, "founder_capital": capital.unmatched_deposit}.get(kind)
        if fallback:
            try:
                fallback(ev["data"], f"could not be posted: {err[:100]}")
            except Exception:
                frappe.db.rollback()
        _record(ev, "Parked", err, attempts)
        frappe.db.set_single_value("Capxul Settings", "last_seq", seq)
        return {"applied": False, "parked": True, "last_seq": seq, "error": err}
    _record(ev, "Applied", "")
    frappe.db.set_single_value("Capxul Settings", "last_seq", seq)
    return {"applied": True, "last_seq": seq}


def _record(ev, status, error, attempts=None):
    key = ev["event_key"]
    if frappe.db.exists("Capxul Chain Event", key):
        frappe.db.set_value("Capxul Chain Event", key, {"status": status, "error": error, **({"attempts": attempts} if attempts else {})})
        return
    frappe.get_doc(
        {"doctype": "Capxul Chain Event", "event_key": key, "seq": ev["seq"], "org": ev.get("org"), "kind": ev["kind"],
         "status": status, "error": error, "attempts": attempts or 0, "data": json.dumps(ev.get("data"), sort_keys=True)}
    ).insert(ignore_permissions=True)


@frappe.whitelist(methods=["POST"])
def request_payment(name):
    """The Submit button on a Safe-backed Payment Entry calls this instead of submitting."""
    return payments.request_payment(name)


@frappe.whitelist()
def payment_status(name):
    frappe.get_doc("Payment Entry", name).check_permission("read")
    return payments.payment_status(name)
