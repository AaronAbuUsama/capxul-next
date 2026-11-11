"""Nothing reports outward by default. What a site could send to its software vendors, and how each is shut (FINDINGS.md has the list):
  1. Frappe/CRM "pulse" telemetry: needs conf `pulse_api_key` AND System Settings `enable_telemetry`. No key ships; the setting is forced to 0
     here, so the CRM's pre-ticked "Share usage data" box (which writes that setting) cannot turn it on.
  2. The weekly update check (`frappe.utils.change_log.check_for_update`, GitHub): System Settings `disable_system_update_notification` = 1.
  3. CRM's first-run screen that carries the consent box: `FCRM Settings.setup_completed` = 1 (the screen is skipped).
  4. CRM Domain Enrichment (crawls company websites): `CRM Enrichment Settings.enabled` = 0.
Not switchable by configuration: see FINDINGS.md (exchange-rate lookups on use, CRM's own SDK defaults, the code paths themselves)."""
import frappe

CONF_KEYS = ("pulse_api_key", "pulse_force_enabled", "pulse_host", "fc_team", "posthog_host")


def guard_system_settings(doc, method=None):
    """System Settings.validate: telemetry stays off whoever ticks the box, and the update check stays off."""
    doc.enable_telemetry = 0
    doc.disable_system_update_notification = 1


def apply():
    frappe.set_user("Administrator")
    ss = frappe.get_doc("System Settings")
    ss.save(ignore_permissions=True)  # the guard sets both
    if frappe.db.exists("DocType", "FCRM Settings"):
        frappe.db.set_single_value("FCRM Settings", "setup_completed", 1)
    if frappe.db.exists("DocType", "CRM Enrichment Settings"):
        frappe.db.set_single_value("CRM Enrichment Settings", "enabled", 0)
    frappe.db.commit()
    return status()


def status():
    """What would be sent, read from the site: every value must be 0 / empty for 'nothing phones home'."""
    from frappe.utils.telemetry import is_pulse_enabled

    st = {
        "enable_telemetry": int(frappe.db.get_single_value("System Settings", "enable_telemetry") or 0),
        "update_check_on": 1 - int(frappe.db.get_single_value("System Settings", "disable_system_update_notification") or 0),
        "crm_first_run_screen_pending": 0,
        "domain_enrichment_on": 0,
        "pulse_enabled_by_frappe": int(bool(is_pulse_enabled())),
        "conf_keys_set": [k for k in CONF_KEYS if frappe.conf.get(k)],
    }
    if frappe.db.exists("DocType", "FCRM Settings"):
        st["crm_first_run_screen_pending"] = 1 - int(frappe.db.get_single_value("FCRM Settings", "setup_completed") or 0)
    if frappe.db.exists("DocType", "CRM Enrichment Settings"):
        st["domain_enrichment_on"] = int(frappe.db.get_single_value("CRM Enrichment Settings", "enabled") or 0)
    st["phoning_home"] = bool(st["enable_telemetry"] or st["update_check_on"] or st["crm_first_run_screen_pending"] or st["domain_enrichment_on"]
                              or st["pulse_enabled_by_frappe"] or st["conf_keys_set"])
    return st
