"""Roles follow hats. Refuse every hand change to a person's roles, whoever they are.

What this CAN lock (all go through Document.save / insert / delete, so these hooks see them):
  UI User form, REST PUT/POST on User, frappe.client.set_value, User.add_roles / remove_roles, Role Profile
  assignment (the profile's roles are copied in validate, before this hook), Bulk Update, Data Import.
What it CANNOT lock: code that runs with doc.flags.ignore_validate, raw SQL, `bench console`, `bench execute`,
  patches, a Server Script / custom app that sets our flag, anyone with the database or the bench.
"""
import frappe
from frappe import _

AUTOMATIC = {"Administrator", "Guest", "All", "Desk User"}
EXEMPT_FLAGS = ("in_install", "in_setup_wizard", "in_patch", "in_migrate", "in_test")


def _exempt():
    return frappe.flags.get("capxul_applying") or any(frappe.flags.get(f) for f in EXEMPT_FLAGS)


def _managed(doc):
    return {r.role for r in (doc.get("roles") or []) if r.role not in AUTOMATIC}


def guard_user_roles(doc, method=None):
    if _exempt() or doc.name == "Administrator":
        return
    before = doc.get_doc_before_save()
    old = _managed(before) if before else set()
    new = _managed(doc)
    if old != new:
        changed = ", ".join(sorted(old ^ new))
        frappe.throw(
            _("Roles follow hats on the chain and cannot be changed by hand ({0}). Grant or revoke the hat instead.").format(changed),
            frappe.PermissionError,
        )


def guard_has_role(doc, method=None):
    if _exempt() or doc.role in AUTOMATIC or doc.parent == "Administrator":
        return
    frappe.throw(_("Roles follow hats on the chain and cannot be changed by hand."), frappe.PermissionError)


class applying:
    """Context manager: only the chain handler uses this."""

    def __enter__(self):
        self.prev = frappe.flags.get("capxul_applying")
        frappe.flags.capxul_applying = True

    def __exit__(self, *a):
        frappe.flags.capxul_applying = self.prev


def guard_feature(doc, method=None):
    """The state of a feature is switched through the CLI (feature.sh), not by hand on the site."""
    if _exempt():
        return
    frappe.throw(_("Features are switched from the CLI (capxul feature on|off), not by hand."), frappe.PermissionError)
