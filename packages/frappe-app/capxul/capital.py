"""The money that first funds a company's Safe, booked as the founder's capital (decision books.founder-funding).

Core enqueues `founder_capital` for the first Transfer into a company Safe it made (workflow plugs.books.founder-capital).
The site posts one Journal Entry: debit the Safe's account, credit the company's capital account, the founder as the
party (a Shareholder). Every later Transfer in is not capital and stays unmatched (books.party-lines).
"""
import frappe
from frappe import _
from frappe.utils import flt, getdate

from capxul.payments import safe_account

CAPITAL = "Capital Stock"  # the equity account ERPNext's Standard chart makes for every company


def capital_account(company):
    acct = frappe.db.get_value("Account", {"company": company, "account_name": CAPITAL, "is_group": 0})
    if not acct:
        acct = frappe.db.get_value("Account", {"company": company, "root_type": "Equity", "is_group": 0}, order_by="lft")
    if not acct:
        frappe.throw(_("Company {0} has no capital account to book the founder's capital").format(company))
    return acct


def shareholder(company, name, email):
    found = frappe.db.get_value("Shareholder", {"company": company, "title": name or email})
    if found:
        return found
    doc = frappe.get_doc({"doctype": "Shareholder", "title": name or email, "company": company})
    doc.insert(ignore_permissions=True)
    return doc.name


def apply_founder_capital(d, event_key=None):
    safe = safe_account()
    if not safe:
        frappe.throw(_("Capxul Settings names no Safe account"))
    if frappe.db.exists("Journal Entry", {"cheque_no": d["tx_hash"], "docstatus": 1, "voucher_type": "Journal Entry"}):
        return  # the same funding delivered again
    company = frappe.db.get_value("Account", safe, "company")
    holder = shareholder(company, d.get("founder_name"), d.get("founder_email"))
    amount = flt(d["amount"])
    day = getdate(d["block_time"][:10])
    je = frappe.get_doc({
        "doctype": "Journal Entry", "voucher_type": "Journal Entry", "company": company, "posting_date": day,
        "cheque_no": d["tx_hash"], "cheque_date": day,
        "user_remark": f"Founder's capital: the funding of the company Safe {d.get('to', '')} by {d.get('founder_email') or d.get('founder_name')}",
        "accounts": [
            {"account": safe, "debit_in_account_currency": amount},
            {"account": capital_account(company), "credit_in_account_currency": amount, "party_type": "Shareholder", "party": holder},
        ],
    })
    je.flags.ignore_permissions = True
    je.insert(ignore_permissions=True)
    je.submit()


def unmatched_deposit(d, why):
    """Funding that could not be booked as capital -> an unreconciled Bank Transaction (a deposit), so it is never lost."""
    bank_account = frappe.db.get_single_value("Capxul Settings", "safe_bank_account")
    if frappe.db.exists("Bank Transaction", {"transaction_id": d["tx_hash"], "reference_number": d["tx_hash"]}):
        return
    bt = frappe.get_doc({
        "doctype": "Bank Transaction", "date": getdate(d["block_time"][:10]), "bank_account": bank_account,
        "deposit": flt(d["amount"]), "currency": frappe.db.get_value("Account", safe_account(), "account_currency"),
        "transaction_id": d["tx_hash"], "reference_number": d["tx_hash"],
        "description": f"Chain deposit from {d.get('from', '')} into {d.get('to', '')} ({why})",
    })
    bt.insert(ignore_permissions=True)
    bt.submit()


def guard_cancel(doc, method=None):
    """The founder's capital follows the chain: the funding stays on chain, so its entry cannot be cancelled here.

    Only an entry that a founder_capital chain event posted is protected: one whose cheque_no is that event's tx_hash.
    A hand-made Journal Entry with a reference number of its own cancels as usual."""
    if frappe.flags.get("capxul_chain_posting") or not doc.cheque_no:
        return
    for data in frappe.get_all("Capxul Chain Event", filters={"kind": "founder_capital", "status": "Applied"}, pluck="data"):
        if (frappe.parse_json(data or "{}").get("tx_hash") or "").lower() == doc.cheque_no.lower():
            frappe.throw(_("This entry books money the chain moved into the Safe; it cannot be cancelled here."))
