"""The trace id is a W3C trace id, 32 lowercase hex characters, everywhere (plugs.trace-format)."""
import re
import sys
import unittest
from unittest.mock import patch

from frappe_fake import install

if "frappe" not in sys.modules:
    install()
import frappe  # noqa: E402
from capxul import trace  # noqa: E402

W3C = re.compile(r"^[0-9a-f]{32}\Z")


class TraceFormat(unittest.TestCase):
    def setUp(self):
        frappe.flags.capxul_trace = None

    tearDown = setUp

    def arrive(self, header):
        frappe.flags.capxul_trace = None
        with patch.object(frappe, "get_request_header", lambda key: header if key == "X-Capxul-Trace" else None):
            trace.from_request()
        return frappe.flags.get("capxul_trace")

    def test_core_w3c_trace_header_is_kept_byte_for_byte(self):
        self.assertEqual(self.arrive("4bf92f3577b34da6a3ce929d0e0e4736"), "4bf92f3577b34da6a3ce929d0e0e4736")

    def test_any_other_form_is_ignored(self):
        for header in ("tr_0123456789abcdefghij", "4BF92F3577B34DA6A3CE929D0E0E4736", "4bf92f3577b34da6a3ce929d0e0e473",
                       "4bf92f3577b34da6a3ce929d0e0e47360", "4bf92f3577b34da6a3ce929d0e0e4736\n", "0" * 32, ""):
            with self.subTest(header=header):
                self.assertIsNone(self.arrive(header))

    def test_bench_command_trace_arguments_are_checked_like_the_header(self):
        from capxul import clock, features

        def switch(t):  # the switch itself, stopped right after it adopts the trace
            with patch.object(features, "precheck", lambda feature, on: {"ok": False}):
                features.switch("crm", True, trace_id=t)

        for adopt in (clock._stamp, switch):
            for value, kept in (("4bf92f3577b34da6a3ce929d0e0e4736", True), ("tr_0123456789abcdefghij", False), ("0" * 32, False)):
                with self.subTest(adopt=adopt, value=value):
                    frappe.flags.capxul_trace = None
                    adopt(value)
                    self.assertEqual(frappe.flags.get("capxul_trace"), value if kept else None)

    def test_an_untraced_command_mints_a_w3c_trace_and_keeps_it(self):
        minted = trace.ensure()
        self.assertRegex(minted, W3C)
        self.assertEqual(trace.ensure(), minted)
        self.assertNotEqual((frappe.flags.__setitem__("capxul_trace", None), trace.ensure())[1], minted)


if __name__ == "__main__":
    unittest.main()
