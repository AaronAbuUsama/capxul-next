"""The canonical JSON a Payment Entry's `document_hash` is computed over.

CANON v1 (written down in FINDINGS.md too):
  * a JSON object with exactly these keys, UTF-8, keys sorted, separators "," and ":" (no spaces);
  * money is a string with exactly 2 decimals ("125.50"), never a float;
  * `references` is sorted by (doctype, name) and holds only what the payment settles;
  * nothing that changes during the signing flow is in it: not `reference_no`, `reference_date`,
    `docstatus`, `modified`, nor the Capxul status fields.
  * hash = "0x" + sha256(canonical bytes).hexdigest()
"""
import hashlib
import json

import frappe
from frappe.utils import flt, getdate

CANON_VERSION = 1


def money(v):
    return "%.2f" % flt(v, 2)


def to_address_for(doc):
    if doc.party_type in ("Supplier", "Employee", "Customer") and doc.party:
        return frappe.db.get_value(doc.party_type, doc.party, "capxul_wallet_address") or ""
    return ""


def canonical(doc, asset):
    refs = sorted(
        (
            {"doctype": r.reference_doctype, "name": r.reference_name, "allocated": money(r.allocated_amount)}
            for r in doc.get("references") or []
        ),
        key=lambda r: (r["doctype"], r["name"]),
    )
    body = {
        "canon": CANON_VERSION,
        "doctype": "Payment Entry",
        "name": doc.name,
        "company": doc.company,
        "payment_type": doc.payment_type,
        "posting_date": str(getdate(doc.posting_date)),
        "party_type": doc.party_type or "",
        "party": doc.party or "",
        "paid_from": doc.paid_from,
        "paid_amount": money(doc.paid_amount),
        "asset": asset,
        "to_address": to_address_for(doc).lower(),
        "references": refs,
    }
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def document_hash(doc, asset="USDC"):
    return "0x" + hashlib.sha256(canonical(doc, asset).encode("utf-8")).hexdigest()
