"""Test helpers run by bin/test-frappe.sh through `bench execute`. Not used by the product flow."""
import json

import frappe
from frappe.utils import add_days, nowdate


def _p(x):
    print("JSON:" + json.dumps(x, default=str))


def make_payable(wallet="0x70997970c51812dc3a010c7d01b50e0d17dc79c8", amount=125.5, supplier="Brightside Cleaning Ltd"):
    """A submitted Purchase Invoice and a draft Payment Entry paying it from the Safe's ledger account."""
    from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry

    frappe.set_user("Administrator")
    company = frappe.db.get_single_value("Global Defaults", "default_company")
    if not frappe.db.exists("Supplier", supplier):
        frappe.get_doc({"doctype": "Supplier", "supplier_name": supplier, "supplier_group": "All Supplier Groups",
                        "capxul_wallet_address": wallet}).insert()
    if not frappe.db.exists("Item", "Cleaning"):
        frappe.get_doc({"doctype": "Item", "item_code": "Cleaning", "item_group": "All Item Groups", "is_stock_item": 0, "stock_uom": "Nos"}).insert()
    pi = frappe.get_doc({"doctype": "Purchase Invoice", "supplier": supplier, "company": company, "posting_date": nowdate(),
                         "due_date": add_days(nowdate(), 14), "items": [{"item_code": "Cleaning", "qty": 1, "rate": amount}]})
    pi.insert(); pi.submit()
    safe = frappe.db.get_single_value("Capxul Settings", "safe_account")
    pe = get_payment_entry("Purchase Invoice", pi.name, bank_account=safe)
    pe.paid_from = safe
    pe.insert()
    _p({"pi": pi.name, "pe": pe.name, "safe": safe, "outstanding": pi.outstanding_amount})


def state(pe, pi=None):
    frappe.set_user("Administrator")
    d = frappe.db.get_value("Payment Entry", pe, ["docstatus", "capxul_status", "reference_no", "paid_amount"], as_dict=True)
    safe = frappe.db.get_single_value("Capxul Settings", "safe_account")
    gl = frappe.get_all("GL Entry", {"voucher_no": pe, "is_cancelled": 0}, ["account", "debit", "credit"])
    out = {"pe": d, "gl": gl, "safe_credit": sum(g.credit for g in gl if g.account == safe)}
    if pi:
        out["outstanding"] = frappe.db.get_value("Purchase Invoice", pi, "outstanding_amount")
    _p(out)


def user_state(email):
    frappe.set_user("Administrator")
    if not frappe.db.exists("User", email):
        return _p(None)
    roles = sorted(r.role for r in frappe.get_doc("User", email).roles if r.role not in ("Desk User", "All", "Guest", "Administrator"))
    perms = [f"{u.allow}:{u.for_value}" for u in frappe.get_all("User Permission", {"user": email}, ["allow", "for_value"])]
    _p({"roles": roles, "perms": perms, "enabled": frappe.db.get_value("User", email, "enabled")})


def try_roles(email, action, *roles):
    """Try to change roles by hand, as code running as Administrator would."""
    frappe.set_user("Administrator")
    try:
        getattr(frappe.get_doc("User", email), action)(*roles)
        _p({"refused": False})
    except Exception as e:
        _p({"refused": True, "error": type(e).__name__})


def bank_transactions():
    frappe.set_user("Administrator")
    _p(frappe.get_all("Bank Transaction", fields=["transaction_id", "withdrawal", "status", "docstatus"]))


def journal_credit_safe():
    frappe.set_user("Administrator")
    safe = frappe.db.get_single_value("Capxul Settings", "safe_account")
    company = frappe.db.get_single_value("Global Defaults", "default_company")
    other = frappe.db.get_value("Account", {"company": company, "account_type": "Expense Account", "is_group": 0}) or frappe.db.get_value("Account", {"company": company, "root_type": "Expense", "is_group": 0})
    je = frappe.get_doc({"doctype": "Journal Entry", "company": company, "posting_date": nowdate(),
                         "accounts": [{"account": other, "debit_in_account_currency": 5}, {"account": safe, "credit_in_account_currency": 5}]})
    try:
        je.insert(); je.submit(); _p({"refused": False})
    except Exception as e:
        _p({"refused": True, "error": str(e)[:120]})


# ---- experiments reported in FINDINGS.md (not part of the product flow) -------------------------------------------

def bypass_attempts(email):
    """Which routes around the role lock still work? Run as Administrator-in-code."""
    frappe.set_user("Administrator")
    out = {}
    def roles():
        return sorted(r.role for r in frappe.get_doc("User", email).roles if r.role not in ("Desk User", "All", "Guest", "Administrator"))
    out["start"] = roles()
    # a) ignore_validate skips the doc_events validate hook
    u = frappe.get_doc("User", email); u.append("roles", {"role": "Sales Manager"}); u.flags.ignore_validate = True; u.save()
    out["ignore_validate"] = "Sales Manager" in roles()
    frappe.db.sql("delete from `tabHas Role` where parent=%s and role='Sales Manager'", email)
    # b) a child row inserted directly
    try:
        frappe.get_doc({"doctype": "Has Role", "parent": email, "parenttype": "User", "parentfield": "roles", "role": "Sales Manager"}).insert(ignore_permissions=True)
        out["has_role_direct_insert"] = "Sales Manager" in roles()
    except Exception as e:
        out["has_role_direct_insert"] = f"refused: {type(e).__name__}"
    frappe.db.sql("delete from `tabHas Role` where parent=%s and role='Sales Manager'", email)
    # c) raw SQL
    frappe.db.sql("insert into `tabHas Role` (name, parent, parenttype, parentfield, role, creation, modified) values (%s,%s,'User','roles','Sales Manager',%s,%s)", (frappe.generate_hash(length=10), email, frappe.utils.now(), frappe.utils.now()))
    out["raw_sql"] = "Sales Manager" in roles()
    frappe.db.sql("delete from `tabHas Role` where parent=%s and role='Sales Manager'", email)
    # d) a Role Profile assigned to the user
    if not frappe.db.exists("Role Profile", "capxul-test-profile"):
        frappe.get_doc({"doctype": "Role Profile", "role_profile": "capxul-test-profile", "roles": [{"role": "Sales Manager"}]}).insert()
    try:
        u = frappe.get_doc("User", email); u.append("role_profiles", {"role_profile": "capxul-test-profile"}); u.save()
        out["role_profile"] = "Sales Manager" in roles()
    except Exception as e:
        out["role_profile"] = f"refused: {type(e).__name__}"
    frappe.db.rollback()
    out["end"] = roles()
    _p(out)


def rollback_experiment(pe):
    """A before_submit hook that records a request and then throws: is the record still there?"""
    frappe.set_user("Administrator")
    try:
        doc = frappe.get_doc("Payment Entry", pe)
        frappe.get_doc({"doctype": "Capxul Payment Request", "payment_entry": pe, "document_hash": "0xexperiment", "status": "Requesting"}).insert(ignore_permissions=True)
        frappe.throw("waiting for signature")
    except Exception:
        frappe.db.rollback()
    _p({"record_survived_throw": bool(frappe.db.exists("Capxul Payment Request", {"document_hash": "0xexperiment"}))})


def workflow_experiment(pe):
    """Can a Workflow make 'Paid' (docstatus 1) reachable only by the chain? Throwaway workflow, removed at the end."""
    from frappe.model.workflow import apply_workflow
    frappe.set_user("Administrator")
    for st in ("Capxul Draft", "Capxul Waiting", "Capxul Paid"):
        if not frappe.db.exists("Workflow State", st):
            frappe.get_doc({"doctype": "Workflow State", "workflow_state_name": st}).insert()
    for a in ("Request signature", "Chain posted"):
        if not frappe.db.exists("Workflow Action Master", a):
            frappe.get_doc({"doctype": "Workflow Action Master", "workflow_action_name": a}).insert()
    if not frappe.db.exists("Role", "Capxul Chain"):
        frappe.get_doc({"doctype": "Role", "role_name": "Capxul Chain", "desk_access": 0}).insert()
    out = {}
    wf = frappe.get_doc({"doctype": "Workflow", "workflow_name": "Capxul Safe payment", "document_type": "Payment Entry", "is_active": 1,
        "workflow_state_field": "workflow_state", "send_email_alert": 0,
        "states": [{"state": "Capxul Draft", "doc_status": 0, "allow_edit": "Accounts User"},
                   {"state": "Capxul Waiting", "doc_status": 0, "allow_edit": "Accounts User"},
                   {"state": "Capxul Paid", "doc_status": 1, "allow_edit": "Capxul Chain"}],
        "transitions": [{"state": "Capxul Draft", "action": "Request signature", "next_state": "Capxul Waiting", "allowed": "Accounts User", "allow_self_approval": 1},
                        {"state": "Capxul Waiting", "action": "Chain posted", "next_state": "Capxul Paid", "allowed": "Capxul Chain", "allow_self_approval": 1}]})
    try:
        wf.insert()
        out["workflow_created"] = True
        doc = frappe.get_doc("Payment Entry", pe)
        doc.workflow_state = "Capxul Draft"; doc.flags.capxul_chain_posting = False
        out["has_workflow_state_field"] = doc.meta.has_field("workflow_state")
        doc = apply_workflow(doc, "Request signature")
        out["after_request"] = [doc.workflow_state, doc.docstatus]
        out["admin_has_chain_role"] = "Capxul Chain" in frappe.get_roles("Administrator")
        try:
            doc = apply_workflow(doc, "Chain posted")
            out["administrator_can_press_chain_posted"] = [doc.workflow_state, doc.docstatus]
        except Exception as e:
            out["administrator_can_press_chain_posted"] = f"refused: {type(e).__name__}: {str(e)[:100]}"
    except Exception as e:
        out["error"] = f"{type(e).__name__}: {str(e)[:200]}"
    finally:
        frappe.db.rollback()
        for w in frappe.get_all("Workflow", {"workflow_name": "Capxul Safe payment"}, pluck="name"):
            frappe.delete_doc("Workflow", w, force=True)
        frappe.db.commit()
    _p(out)
