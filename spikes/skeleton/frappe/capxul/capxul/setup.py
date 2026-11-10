"""Install-time and site-creation-time setup. `configure_site` is idempotent (bin/new-site.sh runs it)."""
import json

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

DEFAULT_HAT_ROLES = {
    "admin": ["System Manager", "Accounts Manager", "Accounts User", "HR Manager", "HR User", "Purchase Manager", "Purchase User", "Purchase Master Manager",
              # Frappe CRM (and its WhatsApp tab) need Sales User or Sales Manager; the other parts get their manager role
              "Sales Manager", "Sales User", "Projects Manager", "Stock Manager", "Manufacturing Manager"],
    "budget-holder": ["Accounts User", "Purchase User", "Expense Approver"],
    "payroll-approver": ["HR Manager", "HR User"],
    "member": ["Employee"],
    # the door's test people (added with the door: the four hats above were too few for sales, HR and projects work)
    "sales": ["Sales User", "Sales Manager", "Accounts User"],
    "hr-manager": ["HR Manager", "HR User", "Employee"],
    "project-manager": ["Projects Manager", "Projects User", "Employee"],
}

CUSTOM_FIELDS = {
    "Supplier": [dict(fieldname="capxul_wallet_address", label="Capxul Wallet Address", fieldtype="Data", insert_after="supplier_name")],
    "Customer": [dict(fieldname="capxul_wallet_address", label="Capxul Wallet Address", fieldtype="Data", insert_after="customer_name")],
    "Employee": [dict(fieldname="capxul_wallet_address", label="Capxul Wallet Address", fieldtype="Data", insert_after="employee_name")],
    "GL Entry": [dict(fieldname="capxul_trace", label="Capxul Trace", fieldtype="Data", read_only=1, no_copy=1, search_index=1)],
    "Payment Entry": [
        dict(fieldname="capxul_status", label="Capxul Status", fieldtype="Data", read_only=1, no_copy=1, insert_after="status"),
        dict(fieldname="capxul_approval_url", label="Capxul Approval Link", fieldtype="Data", read_only=1, no_copy=1, hidden=1, insert_after="capxul_status"),
    ],
}


def after_install():
    ensure_defaults()


def boot_session(bootinfo):
    if frappe.session.user != "Guest":
        bootinfo.capxul = {"safe_account": frappe.db.get_single_value("Capxul Settings", "safe_account")}


def topup_hat_map(hat, roles):
    """A site made before the default map grew keeps its map; add the roles it lacks (never remove one), then give them to the
    people already wearing the hat (a map edit is otherwise not replayed to existing grants)."""
    from capxul.locks import applying

    doc = frappe.get_doc("Capxul Hat Map", hat)
    have = {r.role for r in doc.roles}
    add = [r for r in roles if r not in have and frappe.db.exists("Role", r)]
    if not add:
        return
    for r in add:
        doc.append("roles", {"role": r})
    doc.save(ignore_permissions=True)
    with applying():
        for g in frappe.get_all("Capxul Hat Grant", {"hat": hat}, ["name", "user", "roles_given"]):
            if frappe.db.exists("User", g.user):
                frappe.get_doc("User", g.user).add_roles(*add)
            frappe.db.set_value("Capxul Hat Grant", g.name, "roles_given", json.dumps(sorted(set(json.loads(g.roles_given or "[]")) | set(add))))


def ensure_defaults():
    create_custom_fields(CUSTOM_FIELDS, ignore_validate=True)
    for hat, roles in DEFAULT_HAT_ROLES.items():
        if frappe.db.exists("Capxul Hat Map", hat):
            if hat == "admin":  # the only default that has grown; other hats' maps are the site's to edit
                topup_hat_map(hat, roles)
            continue
        frappe.get_doc({"doctype": "Capxul Hat Map", "hat": hat, "roles": [{"role": r} for r in roles if frappe.db.exists("Role", r)]}).insert(ignore_permissions=True)
    from capxul import features

    features.ensure_rows()
    for g in frappe.get_all("Capxul Hat Grant", pluck="user"):  # people made before hats.ensure_employee stopped ERPNext restricting them to their own Employee
        frappe.db.delete("User Permission", {"user": g, "allow": "Employee"})
    frappe.db.set_single_value("Capxul Settings", "last_seq", frappe.db.get_single_value("Capxul Settings", "last_seq") or 0)
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
    return setup_complete(args)


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
    abbr = frappe.db.get_value("Company", company, "abbr")

    # a bank, a ledger account that stands for the Safe, and the Bank Account that ties them together
    if not frappe.db.exists("Bank", "Capxul Safe"):
        frappe.get_doc({"doctype": "Bank", "bank_name": "Capxul Safe"}).insert()
    acct_name = f"Capxul Safe (USDC) - {abbr}"
    if not frappe.db.exists("Account", acct_name):
        parent = frappe.db.get_value("Account", {"company": company, "account_type": "Bank", "is_group": 1}) or f"Current Assets - {abbr}"
        frappe.get_doc({"doctype": "Account", "account_name": "Capxul Safe (USDC)", "parent_account": parent, "company": company,
                        "account_type": "Bank", "account_currency": currency, "is_group": 0}).insert()
    stale = frappe.db.get_value("Bank Account", {"account": acct_name})
    if stale and not frappe.db.exists("Bank Account", {"integration_id": safe_address}):  # a site made from the template: its placeholder Safe account becomes this one
        frappe.db.set_value("Bank Account", stale, {"integration_id": safe_address, "account_name": f"Safe {safe_address[:10]}"})
    if not frappe.db.exists("Bank Account", {"integration_id": safe_address}):
        frappe.get_doc({"doctype": "Bank Account", "account_name": f"Safe {safe_address[:10]}", "bank": "Capxul Safe", "account": acct_name,
                        "company": company, "is_company_account": 1, "is_default": 1, "integration_id": safe_address}).insert()
    ba = frappe.db.get_value("Bank Account", {"integration_id": safe_address})

    s = frappe.get_doc("Capxul Settings")
    s.update({"org_slug": slug, "safe_address": safe_address, "asset": "USDC", "core_url": core_url, "secret": secret,
              "safe_account": acct_name, "safe_bank_account": ba})
    s.save(ignore_permissions=True)

    # sign-in: the Core stub as a custom OAuth2 / OIDC provider. One key holds both URLs: authorize is opened by the
    # browser (localhost), token and userinfo are called by the bench container (host.docker.internal).
    browser_base = core_url.replace("host.docker.internal", "localhost")
    key = {
        "doctype": "Social Login Key", "provider_name": "Capxul", "social_login_provider": "Custom", "enable_social_login": 1,
        "client_id": "capxul-skeleton", "client_secret": secret, "custom_base_url": 0, "base_url": browser_base,  # the login button is hidden without a base_url, even though it is unused here
        "authorize_url": browser_base + "/oauth/authorize", "access_token_url": core_url + "/oauth/token",
        "api_endpoint": core_url + "/oauth/userinfo", "redirect_url": "/api/method/frappe.integrations.oauth2_logins.custom/capxul",
        "auth_url_data": json.dumps({"response_type": "code", "scope": "openid profile email"}), "user_id_property": "sub", "sign_ups": "Deny",
    }
    if frappe.db.exists("Social Login Key", "capxul"):
        doc = frappe.get_doc("Social Login Key", "capxul"); doc.update(key); doc.save()
    else:
        frappe.get_doc(key).insert()
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
    from capxul import hats  # the Sales roles were added to the admin hat; give them to people already wearing it
    ensure_defaults()
    frappe.db.commit()
    return {"company": company, "deal_status": s.deal_status}


def reset_chain_cursor():
    """After the chain was redeployed from nothing (a spike-only event): the site's event cursor starts again at 0."""
    frappe.db.set_single_value("Capxul Settings", "last_seq", 0)
    frappe.db.commit()
    return "last_seq=0"
