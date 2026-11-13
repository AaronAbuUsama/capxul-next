"""How chain payments land in the books, without a Frappe site: `frappe` is replaced by a small in-memory fake.

Run: python3 -m unittest discover -s packages/frappe-app/tests   (pnpm frappe:test)
The same flows run against a real site in spikes/skeleton/frappe/bin/test-frappe.sh and spikes/skeleton/run.sh.
"""
import json
import sys
import unittest
from unittest.mock import patch

from frappe_fake import DB, Doc, Flags, install

install()
from capxul import api, door, payments, trace  # noqa: E402

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
        p = patch.object(payments, "document_hash", lambda pe, asset: pe["hash"])
        p.start()
        self.addCleanup(p.stop)

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


class SiteRequestBoundary(unittest.TestCase):
    def setUp(self):
        DB.reset(safe_account=SAFE, asset="USDC", org_slug="boundary", request_seq=0)
        self.frappe = sys.modules["frappe"]
        self.frappe.session.user = "admin@example.invalid"
        self.pe = DB.insert(Doc({"doctype": "Payment Entry", "name": "PE-1", "paid_from": SAFE,
                                 "party": "Supplier", "party_name": "Supplier", "paid_amount": 125.5,
                                 "reference_no": "PENDING-CHAIN", "hash": "0xfirst"}))
        for name, fn in (("document_hash", lambda pe, asset: pe["hash"]),
                         ("canonical", lambda pe, asset: '{"paid_amount":"125.50"}'),
                         ("to_address_for", lambda pe: "0xsupplier")):
            p = patch.object(payments, name, fn)
            p.start()
            self.addCleanup(p.stop)

    def signed_call(self, method, body, signature=True):
        raw = json.dumps(body).encode()
        self.frappe.request = Flags(get_data=lambda: raw)
        header = api.sign.sign(raw) if signature else "invalid"
        with patch.object(self.frappe, "get_request_header", lambda name: header):
            return method()

    def approval(self, request):
        return {"org": "boundary", "request_id": request, "approval_id": "A-1", "approval_url": "https://core.invalid/approve/A-1",
                "requested_by": "admin@example.invalid", "awaiting": "0xsigner"}

    def test_submit_then_collect_is_stable_until_core_answers(self):
        first = api.request_payment("PE-1")
        self.assertEqual(api.request_payment("PE-1"), first)
        self.assertEqual((self.pe.docstatus, self.pe.capxul_status), (0, "Requesting"))
        page = self.signed_call(api.collect_payment_requests, {"org": "boundary"})
        self.assertEqual((page["cursor"], len(page["requests"])), (1, 1))
        body = page["requests"][0]
        self.assertEqual((body["request_id"], body["idempotency_key"], body["amount"], body["name"]),
                         (first["request"], first["request"], "125.50", "PE-1"))
        self.assertEqual(self.signed_call(api.collect_payment_requests, {"org": "boundary"}), page)
        answer = self.approval(first["request"])
        self.assertFalse(self.signed_call(api.answer_payment_request, answer)["duplicate"])
        self.assertTrue(self.signed_call(api.answer_payment_request, answer)["duplicate"])
        self.assertEqual((self.pe.docstatus, self.pe.capxul_status), (0, payments.WAITING))
        with self.assertRaisesRegex(RuntimeError, "Conflicting"):
            self.signed_call(api.answer_payment_request, dict(answer, approval_id="OTHER"))

    def test_an_untraced_submit_starts_the_trace_its_request_carries_and_a_sent_trace_is_kept(self):
        self.frappe.flags.capxul_trace = None
        api.request_payment("PE-1")
        started = self.signed_call(api.collect_payment_requests, {"org": "boundary"})["requests"][0]["trace_id"]
        self.assertRegex(started, trace.TRACE)
        self.frappe.flags.capxul_trace = "tr_fromthecaller01"
        self.pe.hash = "0xsecond"
        api.request_payment("PE-1")
        page = self.signed_call(api.collect_payment_requests, {"org": "boundary"})
        self.assertEqual(page["requests"][-1]["trace_id"], "tr_fromthecaller01")
        self.frappe.flags.capxul_trace = None

    def test_edited_draft_has_a_new_request_and_old_answer_cannot_replace_it(self):
        old = api.request_payment("PE-1")["request"]
        self.pe.hash = "0xsecond"
        new = api.request_payment("PE-1")["request"]
        self.signed_call(api.answer_payment_request, self.approval(old))
        self.assertEqual(self.pe.capxul_status, "Requesting")
        page = self.signed_call(api.collect_payment_requests, {"org": "boundary", "after": 1, "limit": 1})
        self.assertEqual((page["cursor"], page["requests"][0]["request_id"]), (2, new))
        self.assertEqual(self.signed_call(api.collect_payment_requests, {"org": "boundary", "after": 2})["requests"], [])

    def test_late_answer_preserves_chain_settlement(self):
        request = api.request_payment("PE-1")["request"]
        payments.apply_payment_sent(sent("P-1", "0xfirst", "125.50", TX_A))
        answer = self.approval(request)
        ans = self.signed_call(api.answer_payment_request, answer)
        self.assertEqual(ans["status"], "Sent")
        self.assertEqual((self.pe.docstatus, self.pe.capxul_status, self.pe.reference_no), (1, "Sent", TX_A))
        self.assertEqual(self.pe.capxul_approval_url, answer["approval_url"])
        self.assertTrue(self.signed_call(api.answer_payment_request, answer)["duplicate"])
        self.assertEqual(self.pe.capxul_approval_url, answer["approval_url"])

    def test_late_answer_for_an_old_request_cannot_replace_the_settled_reference(self):
        old = api.request_payment("PE-1")["request"]
        self.pe.hash = "0xsecond"
        current = api.request_payment("PE-1")["request"]
        answer = dict(self.approval(current), approval_id="A-2", approval_url="https://core.invalid/approve/A-2")
        self.signed_call(api.answer_payment_request, answer)
        payments.apply_payment_sent(sent("P-2", "0xsecond", "125.50", TX_B))
        self.signed_call(api.answer_payment_request, self.approval(old))
        self.assertEqual((self.pe.docstatus, self.pe.capxul_status, self.pe.reference_no), (1, "Sent", TX_B))
        self.assertEqual(self.pe.capxul_approval_url, answer["approval_url"])

    def test_refusal_is_visible_without_submitting_or_advancing_the_read_cursor(self):
        request = api.request_payment("PE-1")["request"]
        self.signed_call(api.answer_payment_request, {"org": "boundary", "request_id": request,
                                                     "error": {"code": "HAT_REQUIRED", "message": "No signing hat"}})
        self.assertEqual((self.pe.docstatus, self.pe.capxul_status), (0, "Failed: HAT_REQUIRED: No signing hat"))
        self.assertEqual(len(self.signed_call(api.collect_payment_requests, {"org": "boundary"})["requests"]), 1)

    def test_service_endpoints_refuse_wrong_signature_and_tenant(self):
        for method in (api.collect_payment_requests, api.answer_payment_request, api.payment_request_listener, api.retry_parked_event):
            with self.assertRaisesRegex(RuntimeError, "Bad signature"):
                self.signed_call(method, {"org": "boundary"}, signature=False)
            with self.assertRaisesRegex(RuntimeError, "Wrong org"):
                self.signed_call(method, {"org": "other"})

    def test_listener_credential_only_authenticates_the_socket_callback(self):
        listener = self.signed_call(api.payment_request_listener, {"org": "boundary"})
        header = listener["authorization"]
        self.frappe.request.path = "/api/method/frappe.realtime.get_user_info"
        with patch.object(self.frappe, "get_request_header", lambda name: header if name == "Authorization" else None):
            door.validate_assertion()
            self.assertEqual(self.frappe.session.user, payments.LISTENER)
            self.frappe.request.path = "/api/resource/Payment Entry"
            with self.assertRaisesRegex(RuntimeError, "scope"):
                door.validate_assertion()
            self.frappe.request.path = "/api/method/frappe.realtime.get_user_info"
            with patch.object(door.time, "time", lambda: listener["expires_at"]):
                with self.assertRaisesRegex(RuntimeError, "scope"):
                    door.validate_assertion()
            self.frappe.local.site = "other.localhost"
            try:
                with self.assertRaisesRegex(RuntimeError, "scope"):
                    door.validate_assertion()
            finally:
                self.frappe.local.site = "boundary.localhost"

    def test_parked_delivery_repeat_never_acknowledges_as_applied_or_duplicate(self):
        DB.singles["last_seq"] = 4
        DB.insert(Doc({"doctype": "Capxul Chain Event", "name": "ev-4", "status": "Parked", "error": "cannot post"}))
        result = self.signed_call(api.chain_event, {"org": "boundary", "event_key": "ev-4", "seq": 4,
                                                   "kind": "payment_sent", "data": {}})
        self.assertEqual(result, {"applied": False, "duplicate": False, "parked": True, "last_seq": 4, "error": "cannot post"})

    def test_repair_uses_saved_facts_and_does_not_rewind_delivery_cursor(self):
        DB.singles["last_seq"] = 9
        request = api.request_payment("PE-1")["request"]
        saved = sent("P-1", "0xfirst", "125.50", TX_A)
        event = DB.insert(Doc({"doctype": "Capxul Chain Event", "name": "ev-4", "seq": 4, "org": "boundary",
                               "kind": "payment_sent", "data": json.dumps(saved), "status": "Parked", "attempts": 3}))
        result = self.signed_call(api.retry_parked_event, {"org": "boundary", "event_key": "ev-4", "data": {"tx_hash": TX_B}})
        self.assertEqual(result, {"applied": True, "duplicate": False, "last_seq": 9})
        self.assertEqual((self.pe.docstatus, self.pe.reference_no, event.status, DB.singles["last_seq"]), (1, TX_A, "Applied", 9))
        self.assertEqual(DB.find("Capxul Payment Request", request)[0].status, "Sent")
        self.assertTrue(self.signed_call(api.retry_parked_event, {"org": "boundary", "event_key": "ev-4"})["duplicate"])

    def test_unsuccessful_repair_keeps_the_error_parked(self):
        DB.singles["last_seq"] = 9
        event = DB.insert(Doc({"doctype": "Capxul Chain Event", "name": "ev-4", "seq": 4, "org": "boundary",
                               "kind": "hat_granted", "data": "{}", "status": "Parked", "attempts": 3}))
        result = self.signed_call(api.retry_parked_event, {"org": "boundary", "event_key": "ev-4"})
        self.assertEqual((result["parked"], result["last_seq"], event.status, event.attempts), (True, 9, "Parked", 4))
        self.assertIn("person_email", result["error"])

    def test_repaired_hats_preserve_later_authority_and_ignore_unrelated_people(self):
        wearer = "wearer@example.invalid"
        for old, later, person, hat, department, expected in (
            ("hat_granted", "hat_revoked", wearer, "admin", "", False),
            ("hat_revoked", "hat_granted", wearer, "admin", "", True),
            ("hat_granted", "hat_revoked", "other@example.invalid", "admin", "", True),
            ("hat_granted", "hat_revoked", wearer, "budget-holder", "", True),
            ("hat_granted", "hat_revoked", wearer, "admin", "Operations", True),
        ):
            with self.subTest(parked=old, later=later, person=person, hat=hat, department=department):
                DB.reset(org_slug="boundary", last_seq=1)
                user = DB.insert(Doc(doctype="User", name=wearer, roles=[]))
                if old == "hat_revoked":
                    user.add_roles("System Manager")
                    DB.insert(Doc(doctype="Capxul Hat Grant", user=wearer, hat="admin", department="",
                                  roles_given='["System Manager"]'))
                data = {"person_email": " WEARER@EXAMPLE.INVALID ", "person_name": "Wearer", "hat": "admin"}
                saved = DB.insert(Doc(doctype="Capxul Chain Event", name="old", seq=1, org="boundary",
                                      kind=old, data=json.dumps(data), status="Parked"))
                with patch.object(api.hats, "hat_roles", lambda hat: ["System Manager"]), \
                     patch.object(api.hats, "map_version", lambda: "sha256:fixture"):
                    self.signed_call(api.chain_event, {"org": "boundary", "event_key": "later", "seq": 2,
                                                       "kind": later, "data": dict(data, person_email=person, hat=hat, department=department)})
                    result = self.signed_call(api.retry_parked_event, {"org": "boundary", "event_key": "old"})
                self.assertEqual((result["applied"], result["last_seq"], saved.status), (True, 2, "Applied"))
                self.assertEqual([role.role for role in user.roles], ["System Manager"] if expected else [])
                self.assertEqual(bool(DB.find("Capxul Hat Grant", {"user": wearer})), expected)

    def test_duplicate_hat_ack_keeps_its_applied_map_version(self):
        DB.singles["last_seq"] = 4
        DB.insert(Doc({"doctype": "Capxul Chain Event", "name": "ev-4", "status": "Applied", "map_version": "sha256:previous"}))
        result = self.signed_call(api.chain_event, {"org": "boundary", "event_key": "ev-4", "seq": 4,
                                                   "kind": "hat_granted", "data": {}})
        self.assertEqual(result["map_version"], "sha256:previous")

    def test_later_deposit_is_unmatched_not_a_second_capital_posting(self):
        DB.singles["last_seq"] = 0
        event = {"org": "boundary", "event_key": "deposit-1", "seq": 1, "kind": "deposit_received",
                 "data": {"tx_hash": TX_A, "amount": "37.20", "block_time": "2026-11-12T12:00:00Z"}}
        other = dict(event, event_key="deposit-2", seq=2, data=dict(event["data"], amount="11.40"))
        self.assertTrue(self.signed_call(api.chain_event, event)["applied"])
        self.assertTrue(self.signed_call(api.chain_event, other)["applied"])
        self.assertTrue(self.signed_call(api.chain_event, event)["duplicate"])
        self.assertTrue(self.signed_call(api.chain_event, other)["duplicate"])
        lines = DB.find("Bank Transaction", {})
        self.assertEqual([(b.deposit, b.transaction_id, b.reference_number) for b in lines],
                         [(37.2, TX_A, "deposit-1"), (11.4, TX_A, "deposit-2")])
        self.assertEqual(DB.find("Journal Entry", {}), [])
        self.assertEqual(DB.find("Shareholder", {}), [])


if __name__ == "__main__":
    unittest.main()
