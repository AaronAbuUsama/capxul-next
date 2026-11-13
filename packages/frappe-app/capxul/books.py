"""What a purchase line books to when the person who keeps the books names no item and no account.

ERPNext takes a Purchase Invoice line's expense account from its Item, and refuses a line with neither an item nor an
account ("Expense account is mandatory for item ..."). A company on Capxul buys services that are not stock and has no
Item for them (the starting world `payment-drafted` invoices "Office cleaning" by name), so such a line books to the
company's default expense account, as ERPNext itself does for an Item with no account of its own. A line that names
an item or an account is left as it is.
"""
import frappe


def default_expense_account(doc, method=None):
    lines = [row for row in doc.get("items") or [] if not row.get("item_code") and not row.get("expense_account")]
    if not lines:
        return
    account = frappe.get_cached_value("Company", doc.company, "default_expense_account")
    if not account:
        return
    for row in lines:
        row.expense_account = account
