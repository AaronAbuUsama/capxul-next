"""Feature defaults and split HR guards through the native public entrypoints."""
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


class NativeFeatures(unittest.TestCase):
    def test_new_defaults_preserve_choices_and_close_only_split_hr_parts(self):
        rows = {}
        frappe = types.ModuleType("frappe")
        frappe.PermissionError = type("PermissionError", (Exception,), {})
        frappe._ = lambda s: s
        frappe.whitelist = lambda **kw: lambda fn: fn
        frappe.flags = types.SimpleNamespace(get=lambda key: False)
        frappe.scrub = lambda s: s.lower().replace(" ", "_")
        frappe.db = types.SimpleNamespace(exists=lambda dt, name: name in rows)
        frappe.cache = types.SimpleNamespace(get_value=lambda key, generator: generator())

        def get_all(doctype, *args):
            if doctype == "Capxul Feature":
                return [types.SimpleNamespace(feature=k, enabled=v) for k, v in rows.items()]
            return []

        frappe.get_all = get_all
        frappe.get_doc = lambda doc: types.SimpleNamespace(insert=lambda **kw: rows.update({doc["feature"]: doc["enabled"]}))

        def throw(message, error):
            raise error(message)

        frappe.throw = throw
        locks = types.ModuleType("capxul.locks")
        from contextlib import nullcontext
        locks.applying = nullcontext
        path = Path(__file__).resolve().parents[1] / "capxul" / "features.py"
        with patch.dict(sys.modules, {"frappe": frappe, "capxul.locks": locks}):
            spec = importlib.util.spec_from_file_location("features_under_test", path)
            features = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(features)
            features.ensure_rows()
            expected = {"accounts": "on", "people": "on", "projects": "on", "crm": "on",
                        "payroll": "off", "whatsapp": "off", "attendance": "off",
                        "recruitment": "off", "reviews": "off", "stock": "off", "manufacturing": "off"}
            self.assertEqual(features.status(), {"features": expected})
            rows["payroll"] = 1
            rows["projects"] = 0
            features.ensure_rows()
            self.assertEqual(features.state(), dict(expected, payroll="on", projects="off"))

            for doctype in ("Attendance", "Job Applicant", "Appraisal"):
                self.assertFalse(features.has_permission(types.SimpleNamespace(doctype=doctype)))
                self.assertEqual(features.query_conditions("member", doctype), "1=0")
                frappe.request = types.SimpleNamespace(path="/api/method/frappe.client.get_list")
                frappe.form_dict = {"doctype": doctype}
                with self.assertRaises(features.FeatureNotAvailable):
                    features.guard_request()
                frappe.request.path = f"/api/method/hrms.hr.doctype.{frappe.scrub(doctype)}.operation"
                frappe.form_dict = {}
                with self.assertRaises(features.FeatureNotAvailable):
                    features.guard_request()
            for doctype in ("Employee", "Leave Application", "Expense Claim", "Timesheet", "Skill"):
                self.assertTrue(features.has_permission(types.SimpleNamespace(doctype=doctype)))
                frappe.request.path = "/api/method/frappe.client.get_list"
                frappe.form_dict = {"doctype": doctype}
                features.guard_request()
            rows["attendance"] = 1
            self.assertTrue(features.has_permission(types.SimpleNamespace(doctype="Attendance")))
            self.assertFalse(features.has_permission(types.SimpleNamespace(doctype="Job Applicant")))
