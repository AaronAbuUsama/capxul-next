"""Read-only service-to-site observations; no caller-chosen endpoints or outbound calls."""
import frappe

from capxul import __version__, features, hats
from capxul.api import service_body


@frappe.whitelist(allow_guest=True, methods=["POST"])
def read_site(**kwargs):
    service_body()
    return {"version": __version__, "apps": frappe.get_installed_apps(),
            "company": frappe.db.get_value("Account", frappe.db.get_single_value("Capxul Settings", "safe_account"), "company"),
            "features": features.state(), "map_version": hats.map_version(),
            "sign_in": {"mode": "assertion", "configured": "capxul.door.validate_assertion" in frappe.get_hooks("auth_hooks"),
                        "oauth": bool(frappe.db.exists("Social Login Key", "capxul"))}}
