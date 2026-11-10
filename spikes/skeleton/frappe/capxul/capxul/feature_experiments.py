"""Throwaway: the candidates for "off", tried one at a time (results in FINDINGS.md). Run with `bench execute`."""
import frappe


def block_module(user, module, on=True):
    u = frappe.get_doc("User", user)
    from capxul.locks import applying
    with applying():
        u.block_modules = [b for b in u.block_modules if b.module != module]
        if on:
            u.append("block_modules", {"module": module})
        u.flags.ignore_permissions = True
        u.save()
    frappe.db.commit()
    return [b.module for b in u.block_modules]


def project_roles():
    return frappe.db.sql("select role, `read`, `write`, `create` from `tabDocPerm` where parent='Project'", as_dict=True)


def workspace_info(name="Projects"):
    ws = frappe.get_all("Workspace", {"module": name}, ["name", "public", "is_hidden", "restrict_to_domain"])
    return ws


def modules():
    return {m.name: m.app_name for m in frappe.get_all("Module Def", ["name", "app_name"])}


def counts(mods):
    return {m: frappe.db.count("DocType", {"module": m}) for m in mods}


def hide_workspace(name="Projects", hidden=1):
    frappe.db.set_value("Workspace", name, "is_hidden", hidden)
    frappe.clear_cache()
    frappe.db.commit()


def layers(user="hannah@acme.test"):
    """What the hooks alone do (no request, so the before_request guard is not in play), for a person and for Administrator."""
    out = {}
    for u in (user, "Administrator"):
        frappe.set_user(u)
        r = {}
        r["get_list"] = len(frappe.get_list("Project", pluck="name"))
        try:
            frappe.get_doc("Project", "PROJ-0001").check_permission("read"); r["doc_read"] = "allowed"
        except frappe.PermissionError:
            r["doc_read"] = "refused"
        r["has_permission(doctype)"] = bool(frappe.has_permission("Project", "read"))
        out[u] = r
    frappe.set_user("Administrator")
    return out


def langs():
    return frappe.db.sql("select name, language from tabUser where user_type='System User'")


def footer():
    from frappe.email.email_body import get_footer
    import re
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", get_footer(None)))


def unbrand():
    """Put the site back as Frappe ships it (to measure 'before' with the same crawler). `capxul.brand.apply` brings the names back."""
    frappe.set_user("Administrator")
    frappe.db.sql("delete from tabTranslation where language='en-GB'")
    frappe.db.sql("update tabUser set language='en' where language='en-GB'")
    ss = frappe.get_doc("System Settings"); ss.update({"language": "en", "app_name": "ERPNext", "otp_issuer_name": "Frappe Framework"}); ss.save()
    ws = frappe.get_doc("Website Settings"); ws.update({"app_name": "Frappe", "footer_powered": ""}); ws.save()
    frappe.db.set_default("disable_standard_email_footer", 0)
    nav = frappe.get_doc("Navbar Settings")
    nav.append("help_dropdown", {"item_label": "Frappe Support", "item_type": "Route", "route": "https://frappe.io/support"}); nav.save()
    frappe.clear_cache(); frappe.db.commit()
