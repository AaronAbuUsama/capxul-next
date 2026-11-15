"""What Core asks of a site (capxul.core_api), without a Frappe site: only Core may call, every document or report runs
as the person, a refusal changes nothing and names its reason, a Safe payment is held with the hash doc.create gave,
and a warp counts what fell due from the world's own time. Also keccak-256 against known vectors."""
import sys
import unittest
from unittest.mock import patch

from frappe_fake import DB, Doc, install


class Permission(Exception):
    pass


class Validation(Exception):
    pass


class Missing(Validation):
    pass


class Duplicate(Exception):
    pass


canon = clock = core_api = features = keccak = payments = frappe = None


def setUpModule():
    """The capxul modules are imported when the tests run, not when they are found: every test module installs the
    fake, and the modules stay bound to the first one, so importing them early here would steal it from the others."""
    global canon, clock, core_api, features, keccak, payments, frappe
    if "frappe" not in sys.modules:
        install()
    from capxul import canon, clock, core_api, features, keccak, payments  # noqa: F811
    frappe = core_api.frappe


CORE = "capxul-core@service.invalid"
SAM = "sam@cast.test"
SAFE = "Capxul Safe (USDC) - N"


class Draft(Doc):
    def check_permission(self, permission):
        if permission in self.get("denied", ()):
            raise Permission(f"no {permission} on {self.name}")

    def submit(self):
        self["docstatus"] = 1
        return self


class CoreApi(unittest.TestCase):
    def setUp(self):
        DB.reset(org_slug="org_northwind1", safe_account=SAFE, safe_address="0x" + "5" * 40, asset="USDC", request_seq=0)
        DB.insert(Doc({"doctype": "User", "name": SAM, "enabled": 1}))
        DB.insert(Doc({"doctype": "Capxul Hat Grant", "user": SAM, "hat": "budget-holder"}))
        DB.insert(Doc({"doctype": "DocType", "name": "Supplier"}))
        self.rolled_back = []
        # The fake is shared by every test module: whatever this case changes on it is put back after each test.
        for target, name, value in ((frappe, "PermissionError", Permission), (frappe, "ValidationError", Validation),
                                    (frappe, "DoesNotExistError", Missing), (frappe, "NameError", Duplicate),
                                    (frappe.db, "rollback", lambda save_point=None: self.rolled_back.append(save_point)),
                                    (frappe.db, "sql", frappe.db.sql), (frappe.db, "set_value", frappe.db.set_value)):
            p = patch.object(target, name, value, create=True)
            p.start()
            self.addCleanup(p.stop)
        before = frappe.session.user
        frappe.session.user = CORE
        self.addCleanup(lambda: setattr(frappe.session, "user", before))
        for module in {id(m.frappe): m.frappe for m in (core_api, payments, canon, features)}.values():
            p = patch.object(module, "get_doc", module.get_doc)
            p.start()
            self.addCleanup(p.stop)
        for name, value in (("off_map", lambda: {"doctypes": {"Salary Slip": "payroll"}}),):
            p = patch.object(features, name, value)
            p.start()
            self.addCleanup(p.stop)
        for name, value in (("stored_fields", lambda doc: {"supplier_name": doc["supplier_name"]}),
                            ("stored_hash", lambda doc, asset: "0x" + "cd" * 32), ("canon_hash", lambda doc, asset: doc["hash"])):
            p = patch.object(core_api, name, value)
            p.start()
            self.addCleanup(p.stop)

    def get_doc(self, fn):
        """Documents for every frappe the modules use; Capxul Settings is the fake's singles."""
        def get(doctype, *a, **k):
            return Doc(DB.singles) if doctype == "Capxul Settings" else fn(doctype, *a, **k)

        for m in (core_api, payments, canon, features):
            m.frappe.get_doc = get

    def core(self, method, *args):
        """One request from Core: each starts signed in as Core's API user, whoever the last one ran as."""
        frappe.session.user = CORE
        return method(*args)

    def test_only_core_may_call(self):
        frappe.session.user = SAM
        with self.assertRaises(Exception):  # the fake's frappe.throw: a PermissionError on a site
            core_api.create("org_northwind1", SAM, "Supplier", {"supplier_name": "Brightside"})

    def test_another_company_or_no_site_user_is_refused_before_anything_runs(self):
        self.assertEqual(self.core(core_api.create, "org_other1", SAM, "Supplier", {}), {"refused": "org-not-here", "org": "org_other1"})
        for user in ("pat@cast.test", None, ""):
            self.assertEqual(self.core(core_api.report, "org_northwind1", user, "General Ledger", {}), {"refused": "no-site-user"})
        self.assertEqual(frappe.session.user, CORE)

    def test_a_document_is_created_as_the_person_and_answers_its_hash(self):
        seen = []

        class Inserting(Draft):
            def insert(self):
                seen.append(frappe.session.user)
                return Draft({**self, "name": self["supplier_name"], "docstatus": 0})

        self.get_doc(lambda d, *a, **k: Inserting(d))
        made = self.core(core_api.create, "org_northwind1", "Sam@Cast.test", "Supplier", {"supplier_name": "Brightside"})
        self.assertEqual(seen, [SAM])
        self.assertEqual(made, {"doctype": "Supplier", "name": "Brightside", "docstatus": 0,
                                "fields": {"supplier_name": "Brightside"}, "hash": "0x" + "cd" * 32})

    def test_a_refusal_rolls_back_and_names_its_reason(self):
        DB.insert(Doc({"doctype": "DocType", "name": "Employee"}))
        for error, reason in ((Permission("not allowed"), "permission"), (Validation("Supplier Name is mandatory"), "validation"),
                              (Missing("no such link"), "not_found"), (Duplicate("exists"), "validation")):
            class Failing(Draft):
                def insert(self, raised=error):
                    raise raised

            self.get_doc(lambda d, *a, **k: Failing(d))
            answer = self.core(core_api.create, "org_northwind1", SAM, "Employee", {"first_name": "Ada"})
            self.assertEqual(answer["refused"], "site-refused")
            self.assertEqual(answer["target"], "Employee")
            self.assertEqual(answer["reason"], reason)
        self.assertEqual(len(self.rolled_back), 4)
        DB.insert(Doc({"doctype": "DocType", "name": "Salary Slip"}))
        self.assertEqual(self.core(core_api.create, "org_northwind1", SAM, "Salary Slip", {})["reason"], "part_off")
        self.assertEqual(self.core(core_api.create, "org_northwind1", SAM, "Ledger", {})["reason"], "not_found")
        self.assertEqual(self.core(core_api.create, "org_northwind1", SAM, "Supplier", {"docstatus": 1})["reason"], "validation")

    def _entry(self, **fields):
        DB.insert(Draft({"doctype": "Payment Entry", "name": "ACC-PAY-1", "docstatus": 0, "paid_from": SAFE, "party_type": "Supplier",
                         "party": "Brightside", "paid_amount": 125.5, "hash": "0x" + "ef" * 32, **fields}))
        DB.insert(Doc({"doctype": "Supplier", "name": "Brightside", "capxul_wallet_address": "0x" + "b2" * 20}))
        self.get_doc(lambda d, name=None, **k: Doc(d) if isinstance(d, dict) else DB.find(d, name)[0])

    def test_submit_posts_an_ordinary_document_and_refuses_one_that_is_not_a_draft(self):
        DB.insert(Draft({"doctype": "Purchase Invoice", "name": "PINV-1", "docstatus": 0}))
        DB.insert(Draft({"doctype": "Purchase Invoice", "name": "PINV-2", "docstatus": 1}))
        self.get_doc(lambda d, name=None, **k: Doc(d) if isinstance(d, dict) else DB.find(d, name)[0])
        self.assertEqual(self.core(core_api.submit, "org_northwind1", SAM, "Purchase Invoice", "PINV-1"),
                         {"posted": {"doctype": "Purchase Invoice", "name": "PINV-1", "docstatus": 1}})
        self.assertEqual(self.core(core_api.submit, "org_northwind1", SAM, "Purchase Invoice", "PINV-2"), {"refused": "not-a-draft", "docstatus": 1})
        self.assertEqual(self.core(core_api.submit, "org_northwind1", SAM, "Purchase Invoice", "PINV-9")["reason"], "not_found")

    def test_a_safe_payment_is_answered_not_posted_then_held_with_the_hash_doc_create_gave(self):
        self._entry()
        answer = self.core(core_api.submit, "org_northwind1", SAM, "Payment Entry", "ACC-PAY-1")
        self.assertEqual(answer, {"payment": {"payee": "Brightside", "payee_address": "0x" + "b2" * 20, "amount": "125.50",
                                              "asset": "USDC", "safe": "0x" + "5" * 40, "document_hash": "0x" + "ef" * 32}})
        self.assertEqual(DB.find("Payment Entry", "ACC-PAY-1")[0]["docstatus"], 0)
        self.assertEqual(self.core(core_api.hold, "org_northwind1", SAM, "ACC-PAY-1", "0x" + "00" * 32, "req_1", "apr_1", "0x" + "9a" * 32)["reason"],
                         "validation")
        with patch.object(payments, "canonical", lambda doc, asset: "{}"):
            held = self.core(core_api.hold, "org_northwind1", SAM, "ACC-PAY-1", "0x" + "ef" * 32, "req_1", "apr_1", "0x" + "9a" * 32)
        self.assertEqual(held, {"held": {"doctype": "Payment Entry", "name": "ACC-PAY-1", "docstatus": 0}})
        [request] = DB.find("Capxul Payment Request", {})
        self.assertEqual((request["document_hash"], request["status"], request["approval_id"], request["requested_by"]),
                         ("0x" + "ef" * 32, payments.WAITING, "apr_1", SAM))
        self.assertEqual(DB.find("Payment Entry", "ACC-PAY-1")[0]["capxul_status"], payments.WAITING)
        self.assertEqual(self.core(core_api.submit, "org_northwind1", SAM, "Payment Entry", "ACC-PAY-1")["reason"], "validation")

    def test_a_safe_payment_to_a_supplier_with_no_address_is_refused(self):
        self._entry()
        DB.find("Supplier", "Brightside")[0]["capxul_wallet_address"] = ""
        self.assertEqual(self.core(core_api.submit, "org_northwind1", SAM, "Payment Entry", "ACC-PAY-1")["reason"], "validation")

    def test_a_report_is_refused_when_missing_and_a_doctype_runs_its_list(self):
        self.assertEqual(self.core(core_api.report, "org_northwind1", SAM, "Ledger of Everything", {})["reason"], "not_found")
        listed = []
        with patch.object(core_api, "_list", lambda doctype, filters: listed.append((frappe.session.user, doctype, filters)) or {"rows": []}):
            self.core(core_api.report, "org_northwind1", SAM, "Supplier", {"supplier_name": "B"})
        self.assertEqual(listed, [(SAM, "Supplier", {"supplier_name": "B"})])

    def test_a_report_the_roles_do_not_open_is_refused_for_permission_before_its_part(self):
        class Report(Doc):
            def is_permitted(self):
                return self["open"]

        DB.insert(Report({"doctype": "Report", "name": "Salary Register", "ref_doctype": "Salary Slip", "open": False}))
        desk = type(sys)("frappe.desk.query_report")
        desk.run = lambda *a, **k: self.fail("the report ran")
        p = patch.dict(sys.modules, {"frappe.desk": type(sys)("frappe.desk"), "frappe.desk.query_report": desk})
        p.start()
        self.addCleanup(p.stop)
        refused = self.core(core_api.report, "org_northwind1", SAM, "Salary Register", {})
        self.assertEqual((refused["refused"], refused["reason"], refused["target"]), ("site-refused", "permission", "Salary Register"))
        DB.find("Report", "Salary Register")[0]["open"] = True
        self.assertEqual(self.core(core_api.report, "org_northwind1", SAM, "Salary Register", {})["reason"], "part_off")

    def test_a_reports_required_filters_are_filled_when_left_out(self):
        erpnext = type(sys)("erpnext.accounts.utils")
        erpnext.get_fiscal_year = lambda date, company=None: ("2026", "2026-01-01", "2026-12-31")
        DB.insert(Doc({"doctype": "Company", "name": "Northwind Ltd", "creation": "2026-11-13 09:00:00"}))
        DB.singles["default_company"] = "Northwind Ltd"
        with patch.dict(sys.modules, {"erpnext": type(sys)("erpnext"), "erpnext.accounts": type(sys)("erpnext.accounts"),
                                      "erpnext.accounts.utils": erpnext}), \
                patch.object(frappe.utils, "nowdate", lambda: "2026-11-20", create=True), \
                patch.object(frappe.db, "sql", lambda q, args=None: [(None,)]):
            ledger = core_api._filled("General Ledger", {"account": "Capxul Safe (USDC) - N"})
            trial = core_api._filled("Trial Balance", {})
            payable = core_api._filled("Accounts Payable", {})
        self.assertEqual(ledger, {"company": "Northwind Ltd", "account": ["Capxul Safe (USDC) - N"], "to_date": "2026-11-20",
                                  "from_date": "2026-01-01", "group_by": "Group by Voucher (Consolidated)"})
        self.assertEqual((trial["fiscal_year"], trial["from_date"], trial["to_date"]), ("2026", "2026-01-01", "2026-11-20"))
        self.assertEqual(payable, {"company": "Northwind Ltd", "report_date": "2026-11-20"})

    def test_a_warp_counts_what_fell_due_from_the_worlds_time_and_writes_the_clock_once(self):
        calls = []
        sql = []
        frappe.db.sql = lambda q, args=None: sql.append((q.split()[0], args)) or []
        frappe.db.set_value = lambda *a, **k: calls.append(("set_value", a))
        sys.modules["frappe.core.doctype.scheduled_job_type.scheduled_job_type"] = type(sys)("sjt")
        sys.modules["frappe.core.doctype.scheduled_job_type.scheduled_job_type"].sync_jobs = lambda: calls.append(("sync",))
        cache = type("Cache", (), {"delete_value": staticmethod(lambda key: calls.append(("hooks", key)))})()
        log = [{"stop": f"day {n}", "jobs": 1, "ms": 10.0 * n} for n in range(8)]
        jobs = {"a.daily": [7, 140.0], "a.hourly": [8, 400.0]} | {f"a.job{n}": [1, float(n)] for n in range(20)}
        advance = lambda f, t, synced=False: calls.append(("advance", f, t, synced)) or {
            "stops": 8, "jobs_run": 7, "log": log, "job_ms": jobs}
        write = lambda world, offset, frozen=None: calls.append(("write", world, offset, frozen))
        with patch.object(clock, "_host_ms", lambda: 1_000_000), patch.object(clock, "site_time", lambda ms: f"site {ms}"), \
                patch.object(clock.advance, "__wrapped__", advance), patch.object(clock.write_world, "__wrapped__", write), \
                patch.object(clock, "world_of_site", lambda: "w1"), patch.object(clock.frappe, "cache", cache, create=True), \
                patch.object(clock, "name_daily_job", lambda: calls.append(("name",))):
            moved = self.core(core_api.warp, 400_000, 400_000 + 7 * 86_400_000, True, True)
            self.core(core_api.warp, 400_000, 500_000, False, False)
        self.assertEqual((moved["stops"], moved["jobs"]), (8, 7))
        self.assertEqual(sql[0], ("update", ("site 400000", "site 400000")))
        self.assertEqual(calls[:3], [("hooks", "app_hooks"), ("sync",), ("name",)],
                         "the hooks are read fresh and synced, then the daily job's type is named")
        self.assertIn(("advance", -600_000, 7 * 86_400_000 - 600_000, True), calls, "synced once, not again by advance")
        self.assertEqual(len([c for c in calls if c[0] == "sync"]), 2, "one sync for each of the two warps")
        self.assertEqual((moved["stop_ms"], moved["stop_jobs"]), ([10.0 * n for n in range(8)], [1] * 8))
        self.assertEqual(moved["slowest"][:2], [{"job": "a.hourly", "runs": 8, "ms": 400.0},
                                                {"job": "a.daily", "runs": 7, "ms": 140.0}], "the slowest first")
        self.assertEqual(len(moved["slowest"]), core_api.SLOWEST_JOBS)
        self.assertGreaterEqual(moved["ms"], moved["setup_ms"])
        self.assertEqual([c for c in calls if c[0] == "write"], [("write", "w1", 7 * 86_400_000 - 600_000, 400_000 + 7 * 86_400_000)])


class DailyJobName(unittest.TestCase):
    def test_the_daily_jobs_type_is_renamed_to_its_declared_name_once(self):
        renamed = []
        with patch.object(clock.frappe.db, "get_value", create=True, return_value="pme9huru30"), \
                patch.object(clock.frappe, "rename_doc", create=True, side_effect=lambda *a, **k: renamed.append((a, k))):
            clock.name_daily_job()
        self.assertEqual(renamed, [(("Scheduled Job Type", "pme9huru30", "clock.daily"), {"force": True})])
        with patch.object(clock.frappe.db, "get_value", create=True, return_value="clock.daily"), \
                patch.object(clock.frappe, "rename_doc", create=True, side_effect=AssertionError("renamed again")):
            clock.name_daily_job()


class Keccak(unittest.TestCase):
    def test_known_vectors(self):
        self.assertEqual(keccak.hex_hash(b""), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470")
        self.assertEqual(keccak.hex_hash(b"abc"), "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45")
        # Across the 136-byte block: checked against viem's keccak256.
        self.assertEqual(keccak.hex_hash(b"a" * 135), "0x34367dc248bbd832f4e3e69dfaac2f92638bd0bbd18f2912ba4ef454919cf446")
        self.assertEqual(keccak.hex_hash(b"x" * 300), "0x956875d0d3af4718863b89e475911881cebd1cd08cfe3c2fcd0890d29def1e37")

    def test_a_payment_entrys_stored_hash_is_its_payment_hash(self):
        with patch.object(canon, "canonical", lambda doc, asset: '{"canon":1}'):
            pe = Doc({"doctype": "Payment Entry"})
            self.assertEqual(canon.stored_hash(pe), canon.document_hash(pe))
            self.assertEqual(canon.document_hash(pe), keccak.hex_hash(b'{"canon":1}'))


if __name__ == "__main__":
    unittest.main()
