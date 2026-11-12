"""Approval identity survives an explicit paused restore; accounting is not rewritten."""
import copy
import json
import sys
import unittest
from unittest.mock import patch

from frappe_fake import DB, Doc, Flags, install

if "frappe" not in sys.modules:
    install()
from capxul import payments, world  # noqa: E402


class RestoredApprovalReferences(unittest.TestCase):
    def setUp(self):
        DB.reset(safe_account="Safe", asset="USDC", org_slug="boundary", request_seq=0)
        self.frappe = sys.modules["frappe"]
        self.frappe.set_user("admin@example.invalid")
        self.pe = DB.insert(Doc(doctype="Payment Entry", name="PE-1", paid_from="Safe", party="Supplier",
                                party_name="Supplier", paid_amount=125.5, reference_no="PENDING-CHAIN", hash="0xfirst"))
        for name, fn in (("document_hash", lambda pe, asset: pe.hash),
                         ("canonical", lambda pe, asset: '{"paid_amount":"125.50"}'),
                         ("to_address_for", lambda pe: "0xsupplier")):
            p = patch.object(payments, name, fn)
            p.start()
            self.addCleanup(p.stop)

    def approval(self, request, url, approval_id="A-1"):
        return dict(request_id=request, approval_id=approval_id, approval_url=url,
                    requested_by="admin@example.invalid", awaiting="0xsigner")

    def restore(self, browser_core_url):
        # Only bench/config plumbing is replaced; the public restore rewrites the durable documents.
        with patch.dict(sys.modules, {"frappe.installer": Flags(update_site_config=lambda *a: None)}), \
             patch.multiple(sys.modules["capxul"], clock=Flags(join_world=lambda world: None),
                            setup=Flags(remove_legacy_oauth=lambda: None), create=True), \
             patch.object(self.frappe, "clear_cache", create=True), patch("builtins.print"):
            world.rewrite("restored", "http://must-not-be-called.invalid", browser_core_url, "clone.localhost")

    def test_restore_rebases_saved_answers_and_visible_references_without_changing_money(self):
        old = payments.request_payment("PE-1")["request"]
        first = self.approval(old, "https://old.invalid/approve/old?return=%2Fdesk#step")
        payments.answer_request(first)
        self.pe.hash = "0xsecond"
        current = payments.request_payment("PE-1")["request"]
        second = self.approval(current, "http://old.invalid:8787/approve/A%2F2?mode=a+b#sig%2F", "A-2")
        payments.answer_request(second)
        payments.apply_payment_sent(dict(payment_id="P-2", document_hash="0xsecond", amount="125.50", asset="USDC",
                                         tx_hash="0x" + "b" * 64, block_time="2026-11-11T12:00:00Z"))
        DB.insert(Doc(doctype="Capxul Payment Request", name="failed", status="Failed", approval_url="",
                      answer_json='{"error": {"code": "HAT_REQUIRED", "message": "No signing hat"}}'))
        DB.insert(Doc(doctype="Capxul Payment Request", name="unanswered", status="Requesting", answer_json=""))
        # References are rebased independently, never copied from a newer/older request on the same voucher.
        DB.insert(Doc(doctype="Payment Entry", name="standalone", capxul_approval_url="https://old.invalid/approve/solo?#"))
        expected = copy.deepcopy(DB.rows)
        for row in expected["Capxul Payment Request"]:
            suffix = {old: "/approve/old?return=%2Fdesk#step", current: "/approve/A%2F2?mode=a+b#sig%2F"}.get(row.name)
            if suffix:
                row.approval_url = "https://restored.invalid:9443" + suffix
                answer = json.loads(row.answer_json)
                answer["approval_url"] = row.approval_url
                row.answer_json = json.dumps(answer, sort_keys=True)
        expected["Payment Entry"][0].capxul_approval_url = "https://restored.invalid:9443/approve/A%2F2?mode=a+b#sig%2F"
        expected["Payment Entry"][1].capxul_approval_url = "https://restored.invalid:9443/approve/solo?#"
        for _ in range(2):
            self.restore("https://restored.invalid:9443/ignored?not=the-approval#origin-only")
            self.assertEqual(DB.rows, expected)
            for original, suffix in ((first, "/approve/old?return=%2Fdesk#step"), (second, "/approve/A%2F2?mode=a+b#sig%2F")):
                rebased = dict(original, approval_url="https://restored.invalid:9443" + suffix)
                self.assertTrue(payments.answer_request(rebased)["duplicate"])
        with self.assertRaisesRegex(RuntimeError, "Conflicting"):
            payments.answer_request(second)

    def test_restore_without_a_browser_origin_keeps_the_exact_saved_answer(self):
        request = payments.request_payment("PE-1")["request"]
        answer = self.approval(request, "https://core.invalid/approve/A-1")
        payments.answer_request(answer)
        expected = copy.deepcopy(DB.rows)
        for url in ("", None):
            self.restore(url)
            self.assertEqual(DB.rows, expected)
            self.assertTrue(payments.answer_request(answer)["duplicate"])
