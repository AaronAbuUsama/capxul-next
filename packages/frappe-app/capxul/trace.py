"""Stamp the command's trace id on what the site writes.

Where Frappe allows: every document written while a trace is set gets one Comment ("capxul trace <id>", type Info) in its own timeline, so
a person opening the document sees it and a query finds it. Ledger rows (GL Entry) carry the id in a field of their own, because a
ledger row has no timeline and is the one thing the money trail must reach.
Where Frappe does not: child table rows (they belong to the parent's stamp); documents written straight to the database (db_set, raw SQL,
which fire no hooks); the wizard and installs; the data a web page's own JavaScript writes. Log doctypes are skipped on purpose.
Where the id comes from: the `X-Capxul-Trace` request header (the CLI, Core), or `frappe.flags.capxul_trace` (bench commands).
Its form is a W3C trace id, 32 lowercase hex characters (plugs.trace-format); a header in any other form is ignored.
"""
import re

import frappe

TRACE = re.compile(r"[0-9a-f]{32}")  # a W3C trace id, the one format everywhere (plugs.trace-format)
SKIP = {"Comment", "Version", "Capxul Chain Event", "GL Entry", "Stock Ledger Entry", "Scheduled Job Log", "Access Log", "Error Log",
        "Activity Log", "Route History", "Prepared Report", "Email Queue", "Notification Log", "Submission Queue", "Deleted Document",
        "Console Log", "Energy Point Log", "Bin", "Repost Item Valuation", "Repost Accounting Ledger", "File"}


def from_request():
    t = frappe.get_request_header("X-Capxul-Trace")
    if t and TRACE.fullmatch(t):  # fullmatch: `$` would also accept a trailing newline
        frappe.flags.capxul_trace = t


def ensure():
    """This command's trace id; a command no caller traced (a person's desk Submit) starts its own (plugs.request-starts-trace)."""
    if not frappe.flags.get("capxul_trace"):
        frappe.flags.capxul_trace = frappe.generate_hash(length=32)
    return frappe.flags.capxul_trace


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
