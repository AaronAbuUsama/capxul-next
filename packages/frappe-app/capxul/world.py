"""What a site needs after it is restored from a snapshot into another world (or under another name). Idempotent."""
import json
import re
from urllib.parse import urlsplit

import frappe

from capxul.emit import emit


@emit
def rewrite(world, core_url, browser_core_url, site):
    """Rewrite a paused restored site. browser_core_url rebases saved approval links; core_url remains unused.
    The recovery adapter, not this function, resumes the original scheduler state once every component is ready."""
    from frappe.installer import update_site_config

    from capxul import clock, setup

    frappe.set_user("Administrator")
    if browser_core_url:
        target = urlsplit(browser_core_url)
        if target.scheme not in ("http", "https") or not target.netloc:
            frappe.throw("Expected an absolute HTTP(S) browser Core URL", frappe.ValidationError)
        origin = f"{target.scheme}://{target.netloc}"

        def rebase(url):
            # Keep the suffix byte-for-byte, including escaped paths and empty ?/# delimiters.
            return re.sub(r"^https?://[^/?#]+", lambda _: origin, url, count=1, flags=re.IGNORECASE)

        # plugs.answer-origin: migrate the durable answer with the readable references, in one commit.
        for req in frappe.get_all("Capxul Payment Request", fields=["name", "approval_url", "answer_json"], limit_page_length=0):
            updates = {}
            if req.approval_url and (url := rebase(req.approval_url)) != req.approval_url:
                updates["approval_url"] = url
            if req.answer_json:
                answer = json.loads(req.answer_json)
                if answer.get("approval_url") and (url := rebase(answer["approval_url"])) != answer["approval_url"]:
                    answer["approval_url"] = url
                    updates["answer_json"] = json.dumps(answer, sort_keys=True)
            if updates:
                frappe.db.set_value("Capxul Payment Request", req.name, updates, update_modified=False)
        for pe in frappe.get_all("Payment Entry", filters={"capxul_approval_url": ["!=", ""]},
                                 fields=["name", "capxul_approval_url"], limit_page_length=0):
            if (url := rebase(pe.capxul_approval_url)) != pe.capxul_approval_url:
                frappe.db.set_value("Payment Entry", pe.name, "capxul_approval_url", url, update_modified=False)
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
