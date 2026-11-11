"""Money follows the chain: a Safe-backed Payment Entry is submitted only when `payment_sent` arrives."""
import json

import frappe
import requests
from frappe import _
from frappe.utils import flt, getdate, now_datetime

from capxul.canon import canonical, document_hash, money, to_address_for
from capxul.sign import sign

WAITING = "Waiting for signature"


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


# ---- Frappe -> Core ---------------------------------------------------------------------------------------

def request_payment(name):
    s = settings()
    pe = frappe.get_doc("Payment Entry", name)
    pe.check_permission("submit")
    if not is_safe_backed(pe):
        return {"safe": False}
    if pe.docstatus != 0:
        frappe.throw(_("Only a draft can be sent for signature"))
    h = document_hash(pe, s.asset)
    open_req = frappe.db.get_value(
        "Capxul Payment Request", {"payment_entry": name, "document_hash": h, "status": WAITING}, ["name", "approval_url", "approval_id"], as_dict=True
    )
    if open_req:
        return {"safe": True, "status": WAITING, "approval_url": open_req.approval_url, "request": open_req.name}
    to_addr = to_address_for(pe)
    if not to_addr:
        frappe.throw(_("{0} has no wallet address (Capxul Wallet Address)").format(pe.party))
    dept = frappe.db.get_value("Capxul Hat Grant", {"user": frappe.session.user, "department": ["!=", ""]}, "department") or ""
    req = frappe.get_doc(
        {"doctype": "Capxul Payment Request", "payment_entry": name, "document_hash": h, "status": "Requesting",
         "requested_by": frappe.session.user, "canonical_json": canonical(pe, s.asset)}
    ).insert(ignore_permissions=True)
    body = {
        "org": s.org_slug, "site": frappe.local.site, "doctype": "Payment Entry", "name": name, "document_hash": h,
        "requested_by": frappe.session.user, "to_party": pe.party_name or pe.party, "to_address": to_addr,
        "amount": money(pe.paid_amount), "asset": s.asset, "department": dept,
    }
    raw = json.dumps(body, separators=(",", ":")).encode()
    try:
        r = requests.post(
            s.core_url.rstrip("/") + "/prepare", data=raw, timeout=10,
            headers={"Content-Type": "application/json", "X-Capxul-Signature": sign(raw), "X-Capxul-Trace": frappe.flags.get("capxul_trace") or ""},
        )
    except Exception as e:  # keep the failed request visible, then tell the person
        req.db_set({"status": "Failed", "reason": f"PREPARE_UNREACHABLE: {e}"[:400]})
        frappe.db.commit()
        frappe.throw(_("Capxul Core could not be reached to prepare this payment: {0}").format(e))
    if r.status_code >= 400:  # Core understood and said no (for example: this Frappe user is not a person it knows)
        try:
            why = r.json().get("error") or r.text
        except Exception:
            why = r.text
        req.db_set({"status": "Failed", "reason": f"PREPARE_REFUSED: {why}"[:400]})
        frappe.db.commit()
        frappe.throw(_("Capxul did not accept this payment request: {0}").format(why))
    ans = r.json()
    req.db_set({"status": WAITING, "approval_id": ans["approval_id"], "approval_url": ans["approval_url"]})
    frappe.db.set_value("Payment Entry", name, {"capxul_status": WAITING, "capxul_approval_url": ans["approval_url"]}, update_modified=False)
    return {"safe": True, "status": WAITING, "approval_url": ans["approval_url"], "request": req.name}


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
        done = frappe.db.get_value("Capxul Payment Request", {"document_hash": d["document_hash"], "status": "Sent"})
        if not done:
            _unmatched(d, "no Frappe document asked for this payment")
        return
    req = frappe.get_doc("Capxul Payment Request", req_name)
    pe = frappe.get_doc("Payment Entry", req.payment_entry)
    if pe.docstatus == 1:
        req.db_set({"status": "Sent", "tx_hash": d["tx_hash"]})
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
    if frappe.db.exists("Bank Transaction", {"transaction_id": d["tx_hash"]}):
        return
    bt = frappe.get_doc(
        {"doctype": "Bank Transaction", "date": getdate(d["block_time"][:10]), "bank_account": bank_account,
         "withdrawal": flt(d["amount"]), "currency": frappe.db.get_value("Account", safe_account(), "account_currency"),
         "transaction_id": d["tx_hash"], "reference_number": d["tx_hash"],
         "description": f"Chain payment to {d['to']} ({why}); hash {d['document_hash']}"}
    )
    bt.insert(ignore_permissions=True)
    bt.submit()
