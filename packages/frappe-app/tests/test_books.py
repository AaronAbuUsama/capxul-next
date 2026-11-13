"""What a purchase line with no item and no account books to (capxul.books): the company's default expense account, as
ERPNext does for an Item with none of its own; a line that names an item or an account is left as it is."""
import sys
import unittest
from unittest.mock import patch

from frappe_fake import Doc, install

books = None


def setUpModule():
    global books
    if "frappe" not in sys.modules:
        install()
    from capxul import books  # noqa: F811


class DefaultExpenseAccount(unittest.TestCase):
    def invoice(self, *lines):
        return Doc(company="Northwind Trading", items=[Doc(line) for line in lines])

    def test_an_item_less_line_books_to_the_default_expense_account(self):
        doc = self.invoice({"item_name": "Office cleaning", "qty": 1, "rate": 125.5})
        with patch.object(books.frappe, "get_cached_value", create=True, return_value="Cost of Goods Sold - NT") as read:
            books.default_expense_account(doc)
        read.assert_called_once_with("Company", "Northwind Trading", "default_expense_account")
        self.assertEqual(doc["items"][0]["expense_account"], "Cost of Goods Sold - NT")

    def test_a_line_naming_an_item_or_an_account_is_left_alone(self):
        doc = self.invoice({"item_code": "SVC-1"}, {"item_name": "Rent", "expense_account": "Rent - NT"})
        with patch.object(books.frappe, "get_cached_value", create=True, return_value="Cost of Goods Sold - NT") as read:
            books.default_expense_account(doc)
        read.assert_not_called()
        self.assertNotIn("expense_account", doc["items"][0])
        self.assertEqual(doc["items"][1]["expense_account"], "Rent - NT")

    def test_a_company_with_no_default_leaves_erpnext_to_refuse(self):
        doc = self.invoice({"item_name": "Office cleaning"})
        with patch.object(books.frappe, "get_cached_value", create=True, return_value=None):
            books.default_expense_account(doc)
        self.assertNotIn("expense_account", doc["items"][0])


if __name__ == "__main__":
    unittest.main()
