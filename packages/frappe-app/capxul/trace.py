"""Stamp the command's trace id on what the site writes.

Where Frappe allows: every document written while a trace is set gets one Comment ("capxul trace <id>", type Info) in its own timeline, so
a person opening the document sees it and a query finds it. Ledger rows (GL Entry) carry the id in a field of their own, because a
ledger row has no timeline and is the one thing the money trail must reach.
Where Frappe does not: child table rows (they belong to the parent's stamp); documents written straight to the database (db_set, raw SQL,
which fire no hooks); the wizard and installs; the data a web page's own JavaScript writes. Log doctypes are skipped on purpose.
Where the id comes from: the `X-Capxul-Trace` request header (the CLI, Core), or `frappe.flags.capxul_trace` (bench commands).
"""
import re

import frappe

TRACE = re.compile(r"^tr_[0-9a-z]{8,40}$")
SKIP = {"Comment", "Version", "Capxul Chain Event", "GL Entry", "Stock Ledger Entry", "Scheduled Job Log", "Access Log", "Error Log",
        "Activity Log", "Route History", "Prepared Report", "Email Queue", "Notification Log", "Submission Queue", "Deleted Document",
        "Console Log", "Energy Point Log", "Bin", "Repost Item Valuation", "Repost Accounting Ledger", "File"}


def from_request():
    t = frappe.get_request_header("X-Capxul-Trace")
    if t and TRACE.match(t):
        frappe.flags.capxul_trace = t


def ensure():
    """The command's trace id, starting one when nothing upstream sent it (a person pressing Submit in the desk)."""
    t = frappe.flags.get("capxul_trace")
    if not t:
        t = frappe.flags.capxul_trace = "tr_" + frappe.generate_hash(length=24).lower()
    return t


def stamp(doc, method=None):
    t = frappe.flags.get("capxul_trace")
    if not t or doc.doctype in SKIP or doc.meta.istable or frappe.flags.in_install or frappe.flags.in_setup_wizard or not doc.name:
        return
    done = frappe.flags.setdefault("capxul_stamped", set())
    if (doc.doctype, doc.name) in done:
        return
    done.add((doc.doctype, doc.name))
    frappe.get_doc({"doctype": "Comment", "comment_type": "Info", "reference_doctype": doc.doctype, "reference_name": doc.name,
                    "content": f"capxul trace {t}"}).insert(ignore_permissions=True)


def stamp_gl(doc, method=None):
    t = frappe.flags.get("capxul_trace")
    if t:
        doc.capxul_trace = t
