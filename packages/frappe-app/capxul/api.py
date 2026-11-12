"""Signed service-to-site methods and the person's payment form actions."""
import base64
import json
import time

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
    "deposit_received": capital.apply_deposit_received,
}


def service_body():
    raw = frappe.request.get_data()
    if not sign.valid(raw, frappe.get_request_header("X-Capxul-Signature")):
        frappe.throw(_("Bad signature"), frappe.AuthenticationError)
    body = json.loads(raw)
    if body.get("org") != frappe.db.get_single_value("Capxul Settings", "org_slug"):
        frappe.throw(_("Wrong org"), frappe.PermissionError)
    frappe.set_user("Administrator")
    return body


@frappe.whitelist(allow_guest=True, methods=["POST"])
def chain_event(**kwargs):
    return _process(service_body())


@frappe.whitelist(allow_guest=True, methods=["POST"])
def retry_parked_event(**kwargs):
    body = service_body()
    _cursor()
    saved = frappe.get_doc("Capxul Chain Event", body["event_key"], for_update=True)
    if saved.status not in ("Parked", "Applied"):
        frappe.throw(_("Only a parked event can be repaired"), frappe.ValidationError)
    return _process({"event_key": saved.name, "seq": saved.seq, "org": saved.org,
                     "kind": saved.kind, "data": json.loads(saved.data)}, repair=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def collect_payment_requests(**kwargs):
    body = service_body()
    return payments.collect_requests(body.get("after", 0), body.get("limit", 100))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def answer_payment_request(**kwargs):
    return payments.answer_request(service_body())


@frappe.whitelist(allow_guest=True, methods=["POST"])
def payment_request_listener(**kwargs):
    service_body()
    expiry = int(time.time()) + 60
    raw = json.dumps({"s": frappe.local.site, "exp": expiry, "aud": "payment-request-listener"}).encode()
    token = base64.urlsafe_b64encode(raw).decode().rstrip("=") + "." + sign.sign(raw)
    return {"authorization": "CapxulListener " + token, "namespace": "/" + frappe.local.site,
            "event": payments.REQUEST_EVENT, "expires_at": expiry}


def _cursor():
    # One delivery or repair at a time per site, including retries of an older parked event.
    row = frappe.db.sql("select value from tabSingles where doctype='Capxul Settings' and field='last_seq' for update")
    if not row:
        frappe.db.set_single_value("Capxul Settings", "last_seq", 0)
        row = frappe.db.sql("select value from tabSingles where doctype='Capxul Settings' and field='last_seq' for update")
    return int(row[0][0] or 0)


def _process(ev, repair=False):
    key, seq, kind = ev["event_key"], int(ev["seq"]), ev["kind"]
    if ev.get("org") != frappe.db.get_single_value("Capxul Settings", "org_slug"):
        frappe.throw(_("Wrong org"), frappe.PermissionError)
    if kind not in KINDS:
        frappe.throw(_("Unknown kind {0}").format(kind))
    last = _cursor()
    state = frappe.db.get_value("Capxul Chain Event", key, "status", for_update=True)
    if state == "Applied":
        saved_version = frappe.db.get_value("Capxul Chain Event", key, "map_version")
        return {"applied": False, "duplicate": True, "last_seq": last,
                **({"map_version": saved_version or hats.map_version()} if kind == "hat_granted" else {})}
    if state == "Parked" and not repair:
        return {"applied": False, "duplicate": False, "parked": True, "last_seq": last,
                "error": frappe.db.get_value("Capxul Chain Event", key, "error")}
    if not repair and seq != last + 1:
        frappe.local.response["expected"] = last + 1
        frappe.local.response.http_status_code = 409
        return None
    frappe.db.savepoint("capxul_event")
    try:
        if repair and kind in ("hat_granted", "hat_revoked"):
            hats.repair_hat(ev)
        else:
            KINDS[kind](ev["data"], key)
        if repair:
            _reconcile_repair(kind, ev["data"])
    except Exception as e:
        frappe.db.rollback(save_point="capxul_event")
        err = f"{type(e).__name__}: {e}"[:400]
        attempts = (frappe.db.get_value("Capxul Chain Event", key, "attempts") or 0) + 1
        if repair:
            _record(ev, "Parked", err, attempts)
            return {"applied": False, "duplicate": False, "parked": True, "last_seq": last, "error": err}
        if attempts < PARK_AFTER:  # may be transient: answer 500, Core resends
            _record(ev, "Failed", err, attempts)
            frappe.db.commit()
            raise
        # Deterministic failure: one event must not block every later event (money included). Park it, visibly, and move
        # the cursor on. Money that could not be posted (a payment out, the founder's funding in) is shown as an
        # unreconciled Bank Transaction instead, so it never leaves the books.
        fallback = {"payment_sent": payments._unmatched, "founder_capital": capital.unmatched_deposit}.get(kind)
        if fallback:
            frappe.db.savepoint("capxul_fallback")
            try:
                fallback(ev["data"], f"could not be posted: {err[:100]}")
            except Exception:
                frappe.db.rollback(save_point="capxul_fallback")
        _record(ev, "Parked", err, attempts)
        frappe.db.set_single_value("Capxul Settings", "last_seq", seq)
        return {"applied": False, "duplicate": False, "parked": True, "last_seq": seq, "error": err}
    version = {"map_version": hats.map_version()} if kind == "hat_granted" else {}
    _record(ev, "Applied", "")
    if version:
        frappe.db.set_value("Capxul Chain Event", key, dict(version))
    if not repair:
        frappe.db.set_single_value("Capxul Settings", "last_seq", seq)
    return {"applied": True, "duplicate": False, "last_seq": last if repair else seq, **version}


def _reconcile_repair(kind, data):
    if kind not in ("payment_sent", "founder_capital"):
        return
    if kind == "payment_sent":
        voucher_type = "Payment Entry"
        voucher = frappe.db.get_value("Capxul Payment Request", {
            "document_hash": data["document_hash"], "tx_hash": data["tx_hash"], "status": "Sent"}, "payment_entry")
    else:
        voucher_type = "Journal Entry"
        voucher = frappe.db.get_value(voucher_type, {"cheque_no": data["tx_hash"], "docstatus": 1})
    if not voucher:
        frappe.throw(_("The saved money event still has no posted matching document"))
    bank_line = frappe.db.get_value("Bank Transaction", {
        "bank_account": frappe.db.get_single_value("Capxul Settings", "safe_bank_account"),
        "transaction_id": data["tx_hash"], "reference_number": data.get("payment_id") or data["tx_hash"]})
    if bank_line:
        bt = frappe.get_doc("Bank Transaction", bank_line, for_update=True)
        bt.add_payment_entries([{"payment_doctype": voucher_type, "payment_name": voucher}])
        bt.save(ignore_permissions=True)
        if bt.unallocated_amount:
            frappe.throw(_("The repaired bank transaction is not fully reconciled"))


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
    for attempt in range(3):
        try:
            return payments.request_payment(name)
        except frappe.QueryDeadlockError:
            # MariaDB snapshot isolation can reject a row lock after a concurrent Submit commits.
            frappe.db.rollback()
            if attempt == 2:
                raise


@frappe.whitelist()
def payment_status(name):
    frappe.get_doc("Payment Entry", name).check_permission("read")
    return payments.payment_status(name)
