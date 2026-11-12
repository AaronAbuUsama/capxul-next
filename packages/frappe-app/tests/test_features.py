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

        def get_all(doctype, *args, **kwargs):
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

            readable = ["Attendance", "Job Applicant", "Appraisal", "Leave Application"]
            frappe.get_user = lambda: types.SimpleNamespace(get_can_read=lambda: readable, can_create=[],
                                                           can_write=[], can_delete=[], can_submit=[], can_cancel=[])
            frappe.get_meta = lambda dt: types.SimpleNamespace(module="HR", issingle=False, istable=False,
                is_submittable=False, get_table_fields=lambda: [], autoname="", naming_rule="", title_field="",
                sort_field="name", sort_order="ASC", fields=[])
            frappe.has_permission = lambda *args, **kw: True
            frappe.permissions = types.SimpleNamespace(get_role_permissions=lambda meta: {"read": True})
            capxul = types.ModuleType("capxul")
            capxul.features, capxul.sign = features, types.SimpleNamespace()
            with patch.dict(sys.modules, {"capxul": capxul}):
                door_spec = importlib.util.spec_from_file_location("door_under_test", path.with_name("door.py"))
                door = importlib.util.module_from_spec(door_spec)
                door_spec.loader.exec_module(door)
                for feature, dt in (("attendance", "Attendance"), ("recruitment", "Job Applicant"), ("reviews", "Appraisal")):
                    rows[feature] = 1
                    self.assertEqual([r["doctype"] for r in door.types(feature)["types"]], [dt])
                    self.assertEqual(door.schema(dt)["feature"], feature)
                    self.assertNotIn(dt, [r["doctype"] for r in door.types("people")["types"]])
                    rows[feature] = 0
                    with self.assertRaises(features.FeatureNotAvailable):
                        door.types(feature)
                self.assertEqual(door.types("people")["types"][0]["doctype"], "Leave Application")
