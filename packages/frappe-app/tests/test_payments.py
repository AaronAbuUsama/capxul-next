"""How chain payments land in the books, without a Frappe site: `frappe` is replaced by a small in-memory fake.

Run: python3 -m unittest discover -s packages/frappe-app/tests   (pnpm frappe:test)
The same flows run against a real site in spikes/skeleton/frappe/bin/test-frappe.sh and spikes/skeleton/run.sh.
"""
import sys
import types
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parents[1]


class Doc(dict):
    """A record: attribute and key access, like frappe's Document."""

    def __getattr__(self, k):
        try:
            return self[k]
        except KeyError:
            raise AttributeError(k)

    def __setattr__(self, k, v):
        self[k] = v

    def db_set(self, values):
        self.update(values)

    def submit(self):
        self["docstatus"] = 1

    def insert(self, ignore_permissions=False):
        DB.insert(self)
        return self


class Flags(dict):
    __getattr__ = dict.get

    def __setattr__(self, k, v):
        self[k] = v


class FakeDB:
    def __init__(self):
        self.rows = {}
        self.singles = {}

    def reset(self, **singles):
        self.rows = {}
        self.singles = dict(singles)

    def insert(self, doc):
        doc.setdefault("name", f"{doc['doctype']}-{len(self.rows.get(doc['doctype'], [])) + 1}")
        doc.setdefault("docstatus", 0)
        doc.setdefault("creation", len(self.all()))
        doc.setdefault("flags", Flags())
        self.rows.setdefault(doc["doctype"], []).append(doc)
        return doc

    def all(self):
        return [d for docs in self.rows.values() for d in docs]

    def _match(self, doc, filters):
        if isinstance(filters, str):
            return doc["name"] == filters
        for k, v in filters.items():
            if isinstance(v, list) and v and v[0] == "in":
                if doc.get(k) not in v[1]:
                    return False
            elif doc.get(k) != v:
                return False
        return True

    def find(self, doctype, filters):
        return [d for d in self.rows.get(doctype, []) if self._match(d, filters)]

    def get_value(self, doctype, filters, field="name", order_by=None, as_dict=False):
        found = self.find(doctype, filters)
        if order_by and "desc" in order_by:
            found = sorted(found, key=lambda d: d["creation"], reverse=True)
        if not found:
            return None
        d = found[0]
        if isinstance(field, list):
            return Doc({f: d.get(f) for f in field}) if as_dict else [d.get(f) for f in field]
        return d.get(field)

    def exists(self, doctype, filters):
        return bool(self.find(doctype, filters))

    def set_value(self, doctype, name, field, value=None, update_modified=True):
        doc = self.find(doctype, name)[0]
        doc.update(field if isinstance(field, dict) else {field: value})

    def get_single_value(self, doctype, field):
        return self.singles.get(field)

    def commit(self):
        pass


DB = FakeDB()


def _install_fake_frappe():
    frappe = types.ModuleType("frappe")
    frappe.db = DB
    frappe.flags = Flags()
    frappe._ = lambda s: s

    def get_doc(doctype, name=None):
        if isinstance(doctype, dict):
            return Doc(doctype)
        return DB.find(doctype, name)[0]

    def throw(msg, *a, **k):
        raise RuntimeError(msg)

    frappe.get_doc = get_doc
    frappe.throw = throw
    utils = types.ModuleType("frappe.utils")
    utils.flt = lambda v, p=None: round(float(v or 0), p) if p is not None else float(v or 0)
    utils.getdate = lambda s: s
    utils.now_datetime = lambda: "2026-11-11 00:00:00"
    password = types.ModuleType("frappe.utils.password")
    password.get_decrypted_password = lambda *a, **k: "secret"
    frappe.utils = utils
    sys.modules.update({"frappe": frappe, "frappe.utils": utils, "frappe.utils.password": password})
    sys.modules.setdefault("requests", types.ModuleType("requests"))
    # The package's __init__ installs the world clock on a running site; load its modules without it.
    pkg = types.ModuleType("capxul")
    pkg.__path__ = [str(APP / "capxul")]
    sys.modules["capxul"] = pkg


_install_fake_frappe()
from capxul import payments  # noqa: E402

SAFE = "1100 - Safe"
TX_A = "0x" + "a" * 64
TX_B = "0x" + "b" * 64


def sent(payment_id, document_hash, amount, tx_hash):
    return {"payment_id": payment_id, "document_hash": document_hash, "from_safe": "0xsafe", "to": "0xsupplier",
            "amount": amount, "asset": "USDC", "tx_hash": tx_hash, "block_time": "2026-11-11T12:00:00Z"}


def bank_lines():
    return [(b["transaction_id"], b["withdrawal"]) for b in DB.find("Bank Transaction", {})]


class ChainPaymentsLandOnce(unittest.TestCase):
    def setUp(self):
        DB.reset(safe_account=SAFE, safe_bank_account="Safe - Bank", asset="USDC")
        DB.insert(Doc({"doctype": "Account", "name": SAFE, "account_currency": "USD"}))
        payments.settings = lambda: Doc({"asset": "USDC"})
        payments.document_hash = lambda pe, asset: pe["hash"]

    def test_a_payment_with_no_document_is_one_unmatched_bank_line(self):
        payments.apply_payment_sent(sent("0x01", "0xunknown", "40.00", TX_A))
        self.assertEqual(bank_lines(), [(TX_A, 40.0)])

    def test_the_same_unmatched_payment_delivered_twice_is_one_bank_line(self):
        payments.apply_payment_sent(sent("0x01", "0xunknown", "40.00", TX_A))
        payments.apply_payment_sent(sent("0x01", "0xunknown", "40.00", TX_A))
        self.assertEqual(bank_lines(), [(TX_A, 40.0)])

    def test_every_unmatched_payment_of_one_batch_transaction_is_a_bank_line(self):
        # Payments.sendBatch emits one PaymentSent per item, all in one transaction.
        payments.apply_payment_sent(sent("0x01", "0xunknown1", "10.00", TX_A))
        payments.apply_payment_sent(sent("0x02", "0xunknown2", "20.00", TX_A))
        self.assertEqual(sorted(bank_lines()), [(TX_A, 10.0), (TX_A, 20.0)])

    def _prepared_twice(self):
        """A draft prepared (hash 0xold), edited, and prepared again (hash 0xnew): two approvals are open."""
        pe = DB.insert(Doc({"doctype": "Payment Entry", "name": "PE-1", "hash": "0xnew", "paid_amount": 125.5,
                            "reference_no": "PENDING-CHAIN", "capxul_status": payments.WAITING}))
        DB.insert(Doc({"doctype": "Capxul Payment Request", "name": "REQ-old", "payment_entry": "PE-1",
                       "document_hash": "0xold", "status": payments.WAITING}))
        DB.insert(Doc({"doctype": "Capxul Payment Request", "name": "REQ-new", "payment_entry": "PE-1",
                       "document_hash": "0xnew", "status": payments.WAITING}))
        return pe

    def test_the_current_approval_posts_the_entry(self):
        pe = self._prepared_twice()
        payments.apply_payment_sent(sent("0x01", "0xnew", "125.50", TX_A))
        self.assertEqual((pe["docstatus"], pe["reference_no"]), (1, TX_A))
        self.assertEqual(bank_lines(), [])

    def test_a_late_payment_against_an_entry_already_paid_is_an_unmatched_bank_line(self):
        pe = self._prepared_twice()
        payments.apply_payment_sent(sent("0x01", "0xnew", "125.50", TX_A))
        payments.apply_payment_sent(sent("0x02", "0xold", "125.50", TX_B))  # the old approval, signed afterwards
        self.assertEqual((pe["docstatus"], pe["reference_no"]), (1, TX_A))
        self.assertEqual(bank_lines(), [(TX_B, 125.5)])
        self.assertNotEqual(DB.find("Capxul Payment Request", "REQ-old")[0]["status"], "Sent")

    def test_the_same_posting_payment_delivered_twice_changes_nothing(self):
        pe = self._prepared_twice()
        payments.apply_payment_sent(sent("0x01", "0xnew", "125.50", TX_A))
        payments.apply_payment_sent(sent("0x01", "0xnew", "125.50", TX_A))
        self.assertEqual((pe["docstatus"], pe["reference_no"]), (1, TX_A))
        self.assertEqual(bank_lines(), [])


if __name__ == "__main__":
    unittest.main()
