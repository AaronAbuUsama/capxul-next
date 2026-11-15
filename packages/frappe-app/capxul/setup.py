"""Install-time and site-creation-time setup. `configure_site` is idempotent (bin/new-site.sh runs it)."""
import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from capxul.generated.site import SAFE_ACCOUNT_PREFIX, WALLET_ADDRESS_FIELD

DEFAULT_HAT_ROLES = {
    "admin": ["System Manager", "Accounts Manager", "Accounts User", "HR Manager", "HR User", "Purchase Manager", "Purchase User", "Purchase Master Manager",
              # Frappe CRM (and its WhatsApp tab) need Sales User or Sales Manager; the other parts get their manager role
              "Sales Manager", "Sales User", "Projects Manager", "Stock Manager", "Manufacturing Manager"],
    # Purchase Master Manager: ERPNext lets only it create a Supplier, which the person who keeps the books does
    # (the starting world `payment-drafted`; rehearsed on a real bench, 13 November 2026: "No permission for Supplier").
    "budget-holder": ["Accounts User", "Purchase User", "Purchase Master Manager", "Expense Approver"],
    "payroll-approver": ["HR Manager", "HR User"],
    "member": ["Employee"],
    # the door's test people (added with the door: the four hats above were too few for sales, HR and projects work)
    "sales": ["Sales User", "Sales Manager", "Accounts User"],
    "hr-manager": ["HR Manager", "HR User", "Employee"],
    "project-manager": ["Projects Manager", "Projects User", "Employee"],
}

CUSTOM_FIELDS = {
    "Supplier": [dict(fieldname=WALLET_ADDRESS_FIELD, label="Capxul Wallet Address", fieldtype="Data", insert_after="supplier_name")],
    "Customer": [dict(fieldname=WALLET_ADDRESS_FIELD, label="Capxul Wallet Address", fieldtype="Data", insert_after="customer_name")],
    "Employee": [dict(fieldname=WALLET_ADDRESS_FIELD, label="Capxul Wallet Address", fieldtype="Data", insert_after="employee_name")],
    "GL Entry": [dict(fieldname="capxul_trace", label="Capxul Trace", fieldtype="Data", read_only=1, no_copy=1, search_index=1)],
    "Payment Entry": [
        dict(fieldname="capxul_status", label="Capxul Status", fieldtype="Data", read_only=1, no_copy=1, insert_after="posting_date"),
        dict(fieldname="capxul_approval_url", label="Capxul Approval Link", fieldtype="Data", options="URL", read_only=1, no_copy=1, hidden=0, insert_after="capxul_status"),
    ],
}


def after_install():
    ensure_encryption_key()
    ensure_defaults()


def ensure_encryption_key():
    """Write the site's encryption key while the site is being made, before anything can serve it. Frappe makes the key the
    first time a secret is stored; a web process holding a site_config.json older than that (it keeps one for up to 60 s)
    would make a second key and write it over the first, and whatever the first key encrypted could not be read again."""
    from frappe.utils.password import get_encryption_key

    return get_encryption_key()


def after_migrate():
    """The brand and the privacy settings, again after every migrate. Both save System Settings, which needs the time zone
    the setup wizard sets, so a site that has not run the wizard yet skips them (configure_site applies them after it)."""
    ensure_defaults()
    from capxul import clock

    clock.name_daily_job()
    if not frappe.is_setup_complete():
        return
    from capxul import brand, privacy, features

    features.sync()
    brand.apply()
    privacy.apply()


def boot_session(bootinfo):
    if frappe.session.user != "Guest":
        bootinfo.capxul = {"safe_account": frappe.db.get_single_value("Capxul Settings", "safe_account")}


def remove_legacy_oauth():
    """Old sites and restored backups must not retain a server-to-Core OAuth exchange."""
    frappe.db.delete("Singles", {"doctype": "Capxul Settings", "field": "core_url"})
    if frappe.db.exists("Social Login Key", "capxul"):
        frappe.delete_doc("Social Login Key", "capxul", ignore_permissions=True, force=True)


def ensure_defaults():
    create_custom_fields(CUSTOM_FIELDS, ignore_validate=True)
    from capxul import features, hats
    from capxul.payments import LISTENER

    hats.reproject_grants()
    for dt in ("Capxul Hat Map", "Capxul Hat Role"):
        if frappe.db.exists("DocType", dt):
            frappe.delete_doc("DocType", dt, ignore_permissions=True, force=True)
    remove_legacy_oauth()
    if not frappe.db.exists("User", LISTENER):
        frappe.get_doc({"doctype": "User", "email": LISTENER, "first_name": "Capxul request listener",
                        "user_type": "Website User", "send_welcome_email": 0, "enabled": 1}).insert(ignore_permissions=True)
    features.ensure_rows()
    for g in frappe.get_all("Capxul Hat Grant", pluck="user"):  # people made before hats.ensure_employee stopped ERPNext restricting them to their own Employee
        frappe.db.delete("User Permission", {"user": g, "allow": "Employee"})
    frappe.db.set_single_value("Capxul Settings", "last_seq", frappe.db.get_single_value("Capxul Settings", "last_seq") or 0)
    frappe.db.set_single_value("Capxul Settings", "request_seq", frappe.db.get_single_value("Capxul Settings", "request_seq") or 0)
    frappe.db.commit()


def _abbr(name):
    letters = "".join(w[0] for w in name.split() if w and w[0].isalnum()).upper()
    return (letters or "CX")[:5]


def run_wizard(company_name, currency, country):
    """The setup wizard, run programmatically. No `email` is passed on purpose: with an email the wizard makes that
    person a System Manager itself, which would be a second, un-chained way to get a role."""
    from frappe.desk.page.setup_wizard.setup_wizard import setup_complete
    from frappe.utils import getdate, nowdate

    if frappe.is_setup_complete():
        return "already complete"
    year = getdate(nowdate()).year
    args = {
        "language": "English", "country": country, "timezone": "Europe/London", "currency": currency,
        "company_name": company_name, "company_abbr": _abbr(company_name), "chart_of_accounts": "Standard",
        "fy_start_date": f"{year}-01-01", "fy_end_date": f"{year}-12-31", "domain": "Services",
        "full_name": "Site Administrator", "enable_telemetry": 0,
    }
    done = setup_complete(args)
    # The wizard has just set the site's time zone; the job types install made were stamped in Frappe's default one.
    from capxul.jobs import settle_jobs

    settle_jobs()
    frappe.db.commit()
    return done


def ensure_safe_account(company, safe_address, currency="USD"):
    """A bank, a ledger account that stands for the Safe, and the Bank Account that ties them together. Answers the
    account's name and the Bank Account's. Idempotent."""
    abbr = frappe.db.get_value("Company", company, "abbr")
    if not frappe.db.exists("Bank", SAFE_ACCOUNT_PREFIX):
        frappe.get_doc({"doctype": "Bank", "bank_name": SAFE_ACCOUNT_PREFIX}).insert()
    acct_name = f"{SAFE_ACCOUNT_PREFIX} (USDC) - {abbr}"
    if not frappe.db.exists("Account", acct_name):
        parent = frappe.db.get_value("Account", {"company": company, "account_type": "Bank", "is_group": 1}) or f"Current Assets - {abbr}"
        frappe.get_doc({"doctype": "Account", "account_name": f"{SAFE_ACCOUNT_PREFIX} (USDC)", "parent_account": parent, "company": company,
                        "account_type": "Bank", "account_currency": currency, "is_group": 0}).insert()
    stale = frappe.db.get_value("Bank Account", {"account": acct_name})
    if stale and not frappe.db.exists("Bank Account", {"integration_id": safe_address}):  # a site made from the template: its placeholder Safe account becomes this one
        frappe.db.set_value("Bank Account", stale, {"integration_id": safe_address, "account_name": f"Safe {safe_address[:10]}"})
    if not frappe.db.exists("Bank Account", {"integration_id": safe_address}):
        frappe.get_doc({"doctype": "Bank Account", "account_name": f"Safe {safe_address[:10]}", "bank": SAFE_ACCOUNT_PREFIX, "account": acct_name,
                        "company": company, "is_company_account": 1, "is_default": 1, "integration_id": safe_address}).insert()
    ba = frappe.db.get_value("Bank Account", {"integration_id": safe_address})
    return acct_name, ba


def configure_site(slug, company_name, safe_address, admin_email, core_url, secret, currency="USD", country="United Kingdom"):
    frappe.set_user("Administrator")
    print("wizard:", run_wizard(company_name, currency, country))
    ensure_defaults()
    if not frappe.db.exists("Company", company_name):  # a site made from the company template: its one Company is the template's; it takes the new name
        old = frappe.db.get_value("Company", {})
        if old:
            frappe.rename_doc("Company", old, company_name, force=True)
            frappe.db.commit()
    company = frappe.db.get_value("Company", {"company_name": company_name}) or frappe.db.get_value("Company", {})
    acct_name, ba = ensure_safe_account(company, safe_address, currency)

    s = frappe.get_doc("Capxul Settings")
    # core_url remains an accepted argument for old provisioners; the site never uses it.
    s.update({"org_slug": slug, "safe_address": safe_address, "asset": "USDC", "secret": secret,
              "safe_account": acct_name, "safe_bank_account": ba})
    s.save(ignore_permissions=True)

    remove_legacy_oauth()
    frappe.db.commit()
    if "crm" in frappe.get_installed_apps():
        print("crm link:", configure_crm(company))
    from capxul import features

    print("features:", features.sync())
    from capxul import brand

    print("brand:", brand.apply())
    from capxul import privacy

    print("privacy:", privacy.apply())
    print("configured", slug, company, acct_name, ba)


def configure_crm(company_name=None):
    """The link that turns a won Frappe CRM deal into an ERPNext Customer. It is configuration only (no code of ours):
    ERPNext's `CRM Settings` allows Frappe CRM to write to it, and Frappe CRM's `ERPNext CRM Settings` names the company and
    the deal status that creates the Customer. Idempotent."""
    frappe.set_user("Administrator")
    company = company_name or frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value("Company", {})
    frappe.db.set_single_value("CRM Settings", "enable_frappe_crm_data_synchronization", 1)
    s = frappe.get_doc("ERPNext CRM Settings")
    s.update({"enabled": 1, "is_erpnext_in_different_site": 0, "erpnext_company": company, "create_customer_on_status_change": 1,
              "deal_status": "Won", "sync_products": 0})
    s.save(ignore_permissions=True)
    # The CRM reckons deals in the company's own currency. Its default (INR on CRM 16.0.x) makes every USD deal fetch an
    # exchange rate from a public API on save: a call out of the site, and a failure with no internet.
    currency = frappe.db.get_value("Company", company, "default_currency") if company else None
    if currency and frappe.db.exists("DocType", "FCRM Settings"):
        frappe.db.set_single_value("FCRM Settings", "currency", currency)
    from capxul import hats  # the Sales roles were added to the admin hat; give them to people already wearing it
    ensure_defaults()
    frappe.db.commit()
    return {"company": company, "deal_status": s.deal_status}


def reset_chain_cursor():
    """After the chain was redeployed from nothing (a spike-only event): the site's event cursor starts again at 0."""
    frappe.db.set_single_value("Capxul Settings", "last_seq", 0)
    frappe.db.commit()
    return "last_seq=0"
