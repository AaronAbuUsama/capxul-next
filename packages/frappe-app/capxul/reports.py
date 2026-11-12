"""A persisted trace column on ERPNext's unchanged General Ledger report."""
import frappe
from frappe import _


class LedgerTrace:
    def execute_module(self, filters):
        result = super().execute_module(filters)
        if self.name != "General Ledger" or not result[0]:
            return result
        columns, rows, *rest = result
        names = [row.gl_entry for row in rows if row.get("gl_entry")]
        traces = dict(frappe.get_all("GL Entry", filters={"name": ["in", names]},
                                    fields=["name", "capxul_trace"], as_list=True)) if names else {}
        for row in rows:
            row["capxul_trace"] = traces.get(row.get("gl_entry"), "")
        position = next(i for i, column in enumerate(columns) if column.get("fieldname") == "credit") + 1
        columns.insert(position, {"label": _("Capxul Trace"), "fieldname": "capxul_trace", "fieldtype": "Data", "width": 220})
        return columns, rows, *rest
