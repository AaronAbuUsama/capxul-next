"""Money follows the chain: a Safe-backed Payment Entry is submitted only when `payment_sent` arrives."""
import json

import frappe
from frappe import _
from frappe.utils import flt, getdate

from capxul import trace
from capxul.canon import canonical, document_hash, money, to_address_for

WAITING = "Waiting for signature"
LISTENER = "capxul-listener@service.invalid"
REQUEST_EVENT = "capxul_payment_request"


def settings():
    return frappe.get_doc("Capxul Settings")


def safe_account():
    return frappe.db.get_single_value("Capxul Settings", "safe_account")


def is_safe_backed(doc):
    sa = safe_account()
    return bool(sa) and doc.doctype == "Payment Entry" and doc.paid_from == sa


# ---- hooks -------------------------------------------------------------------------------------------------

def fill_pending_reference(doc, method=None):
    """ERPNext insists a bank payment has a reference no. and date even as a draft; the chain only has the
    transaction hash later. Put a visible placeholder in; the chain event replaces it."""
    if is_safe_backed(doc) and not doc.reference_no:
        doc.reference_no = "PENDING-CHAIN"
        doc.reference_date = doc.posting_date


def guard_submit(doc, method=None):
    if is_safe_backed(doc) and not (doc.flags.get("capxul_chain_posting") or frappe.flags.get("capxul_chain_posting")):
        frappe.throw(
            _("This payment is paid from the Safe. It is posted only when the chain confirms it. Press Submit in the form: it asks Capxul for a signature."),
            title=_("Not posted: waiting on the chain"),
        )


def guard_cancel(doc, method=None):
    if is_safe_backed(doc) and not frappe.flags.get("capxul_chain_posting"):
        frappe.throw(_("Money already left the Safe on the chain; this entry cannot be cancelled here."))


def guard_gl_entry(doc, method=None):
    """Belt and braces: nothing else (a Journal Entry, say) may credit the Safe's ledger account."""
    if frappe.flags.get("capxul_chain_posting") or frappe.flags.get("in_install"):
        return
    if flt(doc.credit) > 0 and doc.account and doc.account == safe_account() and not doc.is_cancelled:
        frappe.throw(_("The Safe's ledger account is only credited when the chain says money moved."))


# ---- site-local request outbox ---------------------------------------------------------------------------

def request_payment(name):
    s = settings()
    # The document lock prevents two Submit requests creating two approvals for the same draft. The counter lock
    # serializes outbox commits across documents: collecting past N can never skip an uncommitted N-1.
    frappe.db.sql("select name from `tabPayment Entry` where name=%s for update", name)
    pe = frappe.get_doc("Payment Entry", name, for_update=True)
    pe.check_permission("submit")
    if not is_safe_backed(pe):
        return {"safe": False}
    if pe.docstatus != 0:
        frappe.throw(_("Only a draft can be sent for signature"))
    h = document_hash(pe, s.asset)
    open_req = frappe.db.get_value(
        "Capxul Payment Request", {"payment_entry": name, "document_hash": h, "status": ["in", ["Requesting", WAITING]]}, ["name", "status", "approval_url"], as_dict=True, for_update=True
    )
    if open_req:
        return {"safe": True, "status": open_req.status, "approval_url": open_req.approval_url, "request": open_req.name}
    to_addr = to_address_for(pe)
    if not to_addr:
        frappe.throw(_("{0} has no wallet address (Capxul Wallet Address)").format(pe.party))
    dept = frappe.db.get_value("Capxul Hat Grant", {"user": frappe.session.user, "department": ["!=", ""]}, "department") or ""
    row = frappe.db.sql("select value from tabSingles where doctype='Capxul Settings' and field='request_seq' for update")
    if not row:
        frappe.throw(_("Migrate this site before requesting a payment"))
    seq = int(row[0][0] or 0) + 1
    frappe.db.set_single_value("Capxul Settings", "request_seq", seq)
    req = frappe.get_doc(
        {"doctype": "Capxul Payment Request", "payment_entry": name, "document_hash": h, "status": "Requesting",
         "requested_by": frappe.session.user, "canonical_json": canonical(pe, s.asset), "request_seq": seq}
    ).insert(ignore_permissions=True)
    body = {
        "request_id": req.name, "idempotency_key": req.name, "cursor": seq,
        # The money trail (approval, chain event, ledger rows) needs one id from here on, even from a desk Submit.
        "trace_id": trace.ensure(),
        "org": s.org_slug, "site": frappe.local.site, "doctype": "Payment Entry", "name": name, "document_hash": h,
        "requested_by": frappe.session.user, "to_party": pe.party_name or pe.party, "to_address": to_addr,
        "amount": money(pe.paid_amount), "asset": s.asset, "department": dept,
    }
    req.db_set({"request_json": json.dumps(body, sort_keys=True)})
    frappe.db.set_value("Payment Entry", name, {"capxul_status": "Requesting", "capxul_approval_url": ""}, update_modified=False)
    frappe.publish_realtime(REQUEST_EVENT, {"org": s.org_slug, "cursor": seq}, user=LISTENER, after_commit=True)
    return {"safe": True, "status": "Requesting", "approval_url": None, "request": req.name}


def collect_requests(after=0, limit=100):
    after, limit = int(after), int(limit)
    if after < 0 or not 1 <= limit <= 100:
        frappe.throw(_("Invalid request cursor or limit"), frappe.ValidationError)
    rows = frappe.get_all("Capxul Payment Request", filters={"request_seq": [">", after]},
                          fields=["request_seq", "request_json"], order_by="request_seq asc", limit_page_length=limit)
    # A restored world's site name is new; the request identity and its business facts are unchanged.
    bodies = [dict(json.loads(r.request_json), site=frappe.local.site) for r in rows]
    return {"requests": bodies, "cursor": int(rows[-1].request_seq) if rows else after}


def answer_request(body):
    name = body["request_id"]
    entry = frappe.db.get_value("Capxul Payment Request", name, "payment_entry")
    if not entry:
        frappe.throw(_("Unknown payment request"), frappe.DoesNotExistError)
    # Same lock order as Submit and settlement.
    frappe.db.sql("select name from `tabPayment Entry` where name=%s for update", entry)
    req = frappe.get_doc("Capxul Payment Request", name, for_update=True)
    error = body.get("error")
    if error:
        answer = {"error": {"code": error["code"], "message": error["message"]}}
    else:
        if body.get("requested_by") != req.requested_by or not body.get("approval_id") or not body.get("approval_url"):
            frappe.throw(_("Invalid approval answer"), frappe.ValidationError)
        answer = {k: body.get(k) or "" for k in ("approval_id", "approval_url", "requested_by", "awaiting")}
    encoded = json.dumps(answer, sort_keys=True)
    if req.answer_json:
        if req.answer_json != encoded:
            frappe.throw(_("Conflicting answer for payment request"), frappe.ValidationError)
        return {"request_id": name, "status": req.status, "duplicate": True}
    updates = {"answer_json": encoded}
    if not error:
        updates.update({k: answer[k] for k in ("approval_id", "approval_url", "awaiting")})
    if req.status == "Requesting":
        reason = f"{error['code']}: {error['message']}"[:400] if error else ""
        updates.update(status="Failed" if error else WAITING, reason=reason)
        pe = frappe.get_doc("Payment Entry", entry, for_update=True)
        latest = frappe.db.get_value("Capxul Payment Request", {"payment_entry": entry}, "name", order_by="creation desc", for_update=True)
        if pe.docstatus == 0 and latest == name and document_hash(pe, settings().asset) == req.document_hash:
            frappe.db.set_value("Payment Entry", entry, {
                "capxul_status": f"Failed: {reason}"[:140] if error else WAITING,
                "capxul_approval_url": "" if error else answer["approval_url"],
            }, update_modified=False)
    elif not error and req.status == "Sent":
        pe = frappe.get_doc("Payment Entry", entry, for_update=True)
        if pe.docstatus == 1 and pe.reference_no == req.tx_hash and document_hash(pe, settings().asset) == req.document_hash:
            frappe.db.set_value("Payment Entry", entry, "capxul_approval_url", answer["approval_url"], update_modified=False)
    req.db_set(updates)
    return {"request_id": name, "status": req.status, "duplicate": False}


def payment_status(name):
    v = frappe.db.get_value("Payment Entry", name, ["docstatus", "capxul_status", "capxul_approval_url", "reference_no"], as_dict=True) or {}
    return v


# ---- Core -> Frappe ---------------------------------------------------------------------------------------

def _find_request(document_hash_):
    return frappe.db.get_value(
        "Capxul Payment Request", {"document_hash": document_hash_, "status": ["in", [WAITING, "Failed", "Requesting"]]}, "name", order_by="creation desc"
    )


def apply_payment_sent(d, event_key=None):
    s = settings()
    req_name = _find_request(d["document_hash"])
    if not req_name:
        # The same payment delivered again is already recorded; any other payment for this hash is unmatched.
        done = frappe.db.get_value("Capxul Payment Request", {"document_hash": d["document_hash"], "status": "Sent", "tx_hash": d["tx_hash"]})
        if not done:
            _unmatched(d, "no Frappe document asked for this payment")
        return
    req = frappe.get_doc("Capxul Payment Request", req_name)
    frappe.db.sql("select name from `tabPayment Entry` where name=%s for update", req.payment_entry)
    req = frappe.get_doc("Capxul Payment Request", req_name, for_update=True)
    pe = frappe.get_doc("Payment Entry", req.payment_entry, for_update=True)
    if pe.docstatus == 1:
        if pe.reference_no == d["tx_hash"]:  # the payment that posted this entry, delivered again
            req.db_set({"status": "Sent", "tx_hash": d["tx_hash"]})
            return
        # An older approval of the same entry, signed after another payment posted it: a second transfer left the
        # Safe, so it must show in the books as an unmatched bank line, not disappear.
        req.db_set({"status": "Mismatch", "tx_hash": d["tx_hash"], "reason": f"{pe.name} was already paid by {pe.reference_no}"[:400]})
        _unmatched(d, f"document {pe.name} was already paid by {pe.reference_no}")
        return
    if document_hash(pe, s.asset) != d["document_hash"] or money(pe.paid_amount) != money(d["amount"]):
        req.db_set({"status": "Mismatch", "tx_hash": d["tx_hash"], "reason": "the document changed after it was prepared"})
        frappe.db.set_value("Payment Entry", pe.name, "capxul_status", "Mismatch: the chain paid something else", update_modified=False)
        _unmatched(d, f"document {pe.name} changed after it was prepared")
        return
    pe.reference_no = d["tx_hash"]
    pe.reference_date = getdate(d["block_time"][:10])
    pe.capxul_status = "Sent"
    pe.flags.capxul_chain_posting = True
    pe.flags.ignore_permissions = True
    frappe.flags.capxul_chain_posting = True
    try:
        pe.submit()
    finally:
        frappe.flags.capxul_chain_posting = False
    req.db_set({"status": "Sent", "tx_hash": d["tx_hash"], "reason": ""})


def apply_payment_failed(d, event_key=None):
    req_name = _find_request(d["document_hash"])
    if not req_name:
        return
    req = frappe.get_doc("Capxul Payment Request", req_name)
    reason = f"{d.get('reason')}: {d.get('detail') or ''}".strip(": ")
    req.db_set({"status": "Failed", "reason": reason})
    frappe.db.set_value("Payment Entry", req.payment_entry, "capxul_status", f"Failed: {reason}"[:140], update_modified=False)


def _unmatched(d, why):
    """A payment on the chain with no matching document -> an unreconciled Bank Transaction."""
    bank_account = frappe.db.get_single_value("Capxul Settings", "safe_bank_account")
    # One line per payment: a batch transaction carries several payments under one hash, so the payment id is the key.
    payment = d.get("payment_id") or d["tx_hash"]
    if frappe.db.exists("Bank Transaction", {"transaction_id": d["tx_hash"], "reference_number": payment}):
        return
    bt = frappe.get_doc(
        {"doctype": "Bank Transaction", "date": getdate(d["block_time"][:10]), "bank_account": bank_account,
         "withdrawal": flt(d["amount"]), "currency": frappe.db.get_value("Account", safe_account(), "account_currency"),
         "transaction_id": d["tx_hash"], "reference_number": payment,
         "description": f"Chain payment to {d['to']} ({why}); hash {d['document_hash']}"}
    )
    bt.insert(ignore_permissions=True)
    bt.submit()
