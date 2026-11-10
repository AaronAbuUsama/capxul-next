"""What a site needs after it is restored from a snapshot into another world (or under another name). Idempotent."""
import frappe


def rewrite(world, core_url, browser_core_url, site):
    """Point a restored site at its new world: the world it names, its host name, where Core is (the settings the site calls, and the sign-in key the
    browser follows). Returns what was changed."""
    from frappe.installer import update_site_config

    from capxul import clock

    frappe.set_user("Administrator")
    clock.join_world(world)
    update_site_config("host_name", f"http://{site}:8000")
    s = frappe.get_doc("Capxul Settings")
    s.core_url = core_url
    s.save(ignore_permissions=True)
    changed = {"site_config.capxul_world": world, "site_config.host_name": f"http://{site}:8000", "Capxul Settings.core_url": core_url}
    if frappe.db.exists("Social Login Key", "capxul"):
        k = frappe.get_doc("Social Login Key", "capxul")
        k.update({"base_url": browser_core_url, "authorize_url": browser_core_url + "/oauth/authorize", "access_token_url": core_url + "/oauth/token",
                  "api_endpoint": core_url + "/oauth/userinfo"})
        k.save()
        changed["Social Login Key.capxul"] = "base_url, authorize_url, access_token_url, api_endpoint"
    from frappe.utils.scheduler import enable_scheduler

    enable_scheduler()   # bench's restore leaves the scheduler of the restored site disabled
    changed["scheduler"] = "enabled"
    frappe.db.commit()
    frappe.clear_cache()
    return changed


def summary():
    """What a snapshot's restore is judged against: documents, ledger, hats, features, clock."""
    from capxul import clock, features

    frappe.set_user("Administrator")
    gl = frappe.db.sql("select account, round(sum(debit),2), round(sum(credit),2) from `tabGL Entry` where is_cancelled=0 group by account order by account")
    return {"site": frappe.local.site, "world": clock.world_of_site(),
            "docs": {dt: frappe.db.count(dt) for dt in ("Sales Invoice", "Purchase Invoice", "Payment Entry", "Employee", "Customer", "CRM Deal", "Project", "Leave Application")},
            "gl": [list(r) for r in gl], "hats": sorted(f"{g.user}:{g.hat}" for g in frappe.get_all("Capxul Hat Grant", ["user", "hat"])),
            "features": features.state(), "last_seq": frappe.db.get_single_value("Capxul Settings", "last_seq"), "now": str(frappe.utils.now_datetime())}
