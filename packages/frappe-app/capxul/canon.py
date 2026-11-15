"""The canonical JSON a Payment Entry's `document_hash` is computed over.

CANON v1 (written down in FINDINGS.md too):
  * a JSON object with exactly these keys, UTF-8, keys sorted, separators "," and ":" (no spaces);
  * money is a string with exactly 2 decimals ("125.50"), never a float;
  * `references` is sorted by (doctype, name) and holds only what the payment settles;
  * nothing that changes during the signing flow is in it: not `reference_no`, `reference_date`,
    `docstatus`, `modified`, nor the Capxul status fields.
  * hash = "0x" + keccak-256(canonical bytes), as Ethereum hashes (capxul.keccak): the hash doc.create answers and the
    chain's PaymentSent carries (packages/blueprint decisions.md, 28). It was sha256 before the rebuild's thin line.

Any other document's hash (`stored_hash`) is keccak-256 of the document as the site stored it: its fields as Frappe
answers them, keys sorted, without what changes on every save (`modified`, `modified_by`) or the leading-underscore
bookkeeping fields, in the same JSON form.
"""
import json

import frappe
from frappe.utils import flt, getdate

from capxul.generated.site import WALLET_ADDRESS_FIELD
from capxul.keccak import hex_hash

CANON_VERSION = 1


def money(v):
    return "%.2f" % flt(v, 2)


def to_address_for(doc):
    if doc.party_type in ("Supplier", "Employee", "Customer") and doc.party:
        return frappe.db.get_value(doc.party_type, doc.party, WALLET_ADDRESS_FIELD) or ""
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
    return hex_hash(canonical(doc, asset).encode("utf-8"))


VOLATILE = {"modified", "modified_by"}


def stored_fields(doc):
    """The document as the site stored it, as JSON values: what doc.create answers as `fields`."""
    def clean(row):
        return {k: v for k, v in row.items() if k not in VOLATILE and not k.startswith("_")}

    plain = json.loads(frappe.as_json(doc.as_dict(no_default_fields=False)))
    return {k: ([clean(r) for r in v] if isinstance(v, list) else v) for k, v in clean(plain).items()}


def stored_hash(doc, asset="USDC"):
    """A Payment Entry's hash is its canonical body's (above), so a payment and its document name one hash; any other
    document's is its stored fields'."""
    if doc.doctype == "Payment Entry":
        return document_hash(doc, asset)
    body = {"canon": CANON_VERSION, "doctype": doc.doctype, "name": doc.name, "fields": stored_fields(doc)}
    return hex_hash(json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
