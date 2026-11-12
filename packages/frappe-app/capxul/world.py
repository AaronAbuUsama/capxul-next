"""What a site needs after it is restored from a snapshot into another world (or under another name). Idempotent."""
import frappe

from capxul.emit import emit


@emit
def rewrite(world, core_url, browser_core_url, site):
    """Rewrite a paused restored site. Legacy Core URL arguments are accepted but unused; the site never calls Core.
    The recovery adapter, not this function, resumes the original scheduler state once every component is ready."""
    from frappe.installer import update_site_config

    from capxul import clock, setup

    frappe.set_user("Administrator")
    clock.join_world(world)
    update_site_config("host_name", f"http://{site}:8000")
    setup.remove_legacy_oauth()
    changed = {"site_config.capxul_world": world, "site_config.host_name": f"http://{site}:8000", "scheduler": "unchanged"}
    frappe.db.commit()
    frappe.clear_cache()
    return changed


@emit
def summary():
    """What a snapshot's restore is judged against: documents, ledger, hats, features, clock."""
    from capxul import clock, features

    frappe.set_user("Administrator")
    gl = frappe.db.sql("select account, round(sum(debit),2), round(sum(credit),2) from `tabGL Entry` where is_cancelled=0 group by account order by account")
    return {"site": frappe.local.site, "world": clock.world_of_site(),
            "docs": {dt: frappe.db.count(dt) for dt in ("Sales Invoice", "Purchase Invoice", "Payment Entry", "Employee", "Customer", "CRM Deal", "Project", "Leave Application")},
            "gl": [list(r) for r in gl], "hats": sorted(f"{g.user}:{g.hat}" for g in frappe.get_all("Capxul Hat Grant", ["user", "hat"])),
            "features": features.state(), "last_seq": frappe.db.get_single_value("Capxul Settings", "last_seq"), "now": str(frappe.utils.now_datetime())}
