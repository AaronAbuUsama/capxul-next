"""What Core tells a company's site that the chain decided (packages/core, src/organizations/site.ts): the company and
its Safe, each hat a person of the world wears, the founder's capital, and a payment the chain sent. Core calls these
through the bench's site door as the site's own API user, `capxul-core@service.invalid`; they refuse anyone else, and a
company other than the site's own once the site has one. Each is idempotent: Core hands a delivery again until the
site has taken it.

  configure  {org, company_name, safe_address}   the site becomes the company's: `org_slug` is the org id, the Safe's
                                                 bank account and ledger account exist (setup.ensure_safe_account)
  grant      {org, email, name, hat}             the person's user and the hat's roles (hats.apply_hat_granted)
  capital    {org, tx_hash, amount, block_time,  the founder's capital, booked once (capital.apply_founder_capital)
              founder_email, founder_name, to}
  paid       {org, document_hash, tx_hash,       the Payment Entry held for this hash posts, as the chain paid it
              amount, to, block_time}            (payments.apply_payment_sent)
"""
import frappe

from capxul import capital as capital_books
from capxul import hats, payments

CORE_USER = "capxul-core@service.invalid"


def _as_core(org, configuring=False):
    """Only Core, and only for this site's company; `configure` makes a site the company's, once."""
    if frappe.session.user != CORE_USER:
        frappe.throw("Only Capxul Core calls this", frappe.PermissionError)
    slug = frappe.db.get_single_value("Capxul Settings", "org_slug")
    if slug != org and not (configuring and not slug):
        frappe.throw(f"This site is not {org}'s", frappe.PermissionError)
    frappe.set_user("Administrator")


@frappe.whitelist(methods=["POST"])
def configure(org, company_name, safe_address):
    _as_core(org, configuring=True)
    from capxul import setup  # setup reaches Frappe's custom fields, which only a running site has

    company = frappe.db.get_value("Company", {"company_name": company_name}) or frappe.db.get_value("Company", {})
    account, bank_account = setup.ensure_safe_account(company, safe_address)
    s = frappe.get_doc("Capxul Settings")
    s.update({"org_slug": org, "safe_address": safe_address, "asset": "USDC", "safe_account": account,
              "safe_bank_account": bank_account})
    s.save(ignore_permissions=True)
    return {"org": org, "company": company, "safe_account": account}


@frappe.whitelist(methods=["POST"])
def grant(org, email, name, hat):
    _as_core(org)
    hats.apply_hat_granted({"hat": hat, "person_email": email, "person_name": name})
    return {"org": org, "user": email.strip().lower(), "hat": hat}


@frappe.whitelist(methods=["POST"])
def capital(org, tx_hash, amount, block_time, founder_email, founder_name, to):
    _as_core(org)
    capital_books.apply_founder_capital({"tx_hash": tx_hash, "amount": amount, "block_time": block_time,
                                         "founder_email": founder_email, "founder_name": founder_name, "to": to})
    return {"org": org, "tx_hash": tx_hash}


@frappe.whitelist(methods=["POST"])
def paid(org, document_hash, tx_hash, amount, to, block_time):
    _as_core(org)
    payments.apply_payment_sent({"document_hash": document_hash, "tx_hash": tx_hash, "amount": amount, "to": to,
                                 "block_time": block_time})
    return {"org": org, "tx_hash": tx_hash}
