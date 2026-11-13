"""What Core tells a company's site (capxul.core_company), without a Frappe site: only Core may call, a site becomes
one company's once and refuses every other, and each delivery reaches the module that books or projects it with what
the chain decided."""
import sys
import types
import unittest
from unittest.mock import patch

from frappe_fake import DB, Doc, install

core_company = frappe = None


def setUpModule():
    global core_company, frappe
    if "frappe" not in sys.modules:
        install()
    from capxul import core_company  # noqa: F811
    frappe = core_company.frappe


CORE = "capxul-core@service.invalid"
ORG = "org_northwind1"
SAFE = "0x" + "5" * 40


class CoreCompany(unittest.TestCase):
    def setUp(self):
        DB.reset()
        DB.insert(Doc({"doctype": "Company", "name": "Northwind Trading", "company_name": "Northwind Trading", "abbr": "NT"}))
        before = frappe.session.user
        frappe.session.user = CORE
        self.addCleanup(lambda: setattr(frappe.session, "user", before))
        self.saved = []
        settings = Doc(DB.singles)
        settings["save"] = lambda **kw: (DB.singles.update({k: v for k, v in settings.items() if k != "save"}), self.saved.append(dict(settings)))
        p = patch.object(core_company.frappe, "get_doc", lambda doctype, name=None, **kw: settings if doctype == "Capxul Settings" else Doc(doctype))
        p.start()
        self.addCleanup(p.stop)
        fake_setup = types.ModuleType("capxul.setup")
        fake_setup.ensure_safe_account = lambda company, safe: (f"Capxul Safe (USDC) - NT@{company}", "Safe 0x55")
        p = patch.dict(sys.modules, {"capxul.setup": fake_setup})
        p.start()
        self.addCleanup(p.stop)
        p = patch.object(sys.modules["capxul"], "setup", fake_setup, create=True)
        p.start()
        self.addCleanup(p.stop)

    def as_core_again(self):
        frappe.session.user = CORE

    def test_only_core_calls(self):
        frappe.session.user = "sam@cast.test"
        with self.assertRaises(RuntimeError):
            core_company.configure(ORG, "Northwind Trading", SAFE)
        self.assertEqual(self.saved, [])

    def test_configure_makes_the_site_the_company_once(self):
        answer = core_company.configure(ORG, "Northwind Trading", SAFE)
        self.assertEqual(answer["safe_account"], "Capxul Safe (USDC) - NT@Northwind Trading")
        self.assertEqual(DB.singles["org_slug"], ORG)
        self.assertEqual(DB.singles["safe_address"], SAFE)
        self.as_core_again()
        core_company.configure(ORG, "Northwind Trading", SAFE)  # the same delivery again
        self.as_core_again()
        with self.assertRaises(RuntimeError):
            core_company.configure("org_southwind1", "Southwind", SAFE)
        self.assertEqual(DB.singles["org_slug"], ORG)

    def test_deliveries_reach_their_modules_for_this_company_only(self):
        DB.singles["org_slug"] = ORG
        with patch.object(core_company.hats, "apply_hat_granted") as granted, \
                patch.object(core_company.capital_books, "apply_founder_capital") as capital, \
                patch.object(core_company.payments, "apply_payment_sent") as paid:
            core_company.grant(ORG, " Sam@Cast.Test ", "Sam", "budget-holder")
            self.as_core_again()
            core_company.capital(ORG, "0xabc", "1000", "2026-11-13T09:00:00.000Z", "dana@cast.test", "Dana", SAFE)
            self.as_core_again()
            core_company.paid(ORG, "0x" + "d" * 64, "0xdef", "125.5", "0x" + "b" * 40, "2026-11-13T09:00:00.000Z")
            self.as_core_again()
            with self.assertRaises(RuntimeError):
                core_company.grant("org_other00001", "eli@cast.test", "Eli", "admin")
        granted.assert_called_once_with({"hat": "budget-holder", "person_email": " Sam@Cast.Test ", "person_name": "Sam"})
        self.assertEqual(capital.call_args.args[0]["amount"], "1000")
        self.assertEqual(paid.call_args.args[0]["document_hash"], "0x" + "d" * 64)


if __name__ == "__main__":
    unittest.main()
