"""A role change forgets Frappe's per-user masked-field cache after it commits, and only the changed user's."""
import json
import sys
import unittest

from frappe_fake import DB, Doc, install

if "frappe" not in sys.modules:
    install()
from capxul import hats  # noqa: E402


class MaskCacheFollowsRoles(unittest.TestCase):
    def setUp(self):
        DB.reset()
        self.callbacks, self.deleted = [], []
        hats.frappe.db.after_commit = type("Callbacks", (), {"add": lambda _, fn: self.callbacks.append(fn)})()
        hats.frappe.cache = type("Cache", (), {"delete_keys": lambda _, pattern: self.deleted.append(pattern)})()

    def user(self, email, *roles):
        DB.insert(Doc(doctype="User", name=email, roles=[Doc(role=r) for r in roles]))

    def grant(self, email, hat, roles):
        DB.insert(Doc(doctype="Capxul Hat Grant", user=email, hat=hat, department="", roles_given=json.dumps(roles)))

    def commit(self):
        for fn in self.callbacks:
            fn()

    def test_revoke_that_drops_roles_forgets_masks_once_committed(self):
        self.user("person@example.test", "Accounts User", "Purchase User")
        self.grant("person@example.test", "budget-holder", ["Accounts User", "Purchase User"])
        hats.apply_hat_revoked({"hat": "budget-holder", "person_email": " Person@Example.test "})
        self.assertEqual(self.deleted, [], "an uncommitted or rolled-back change must not be forgotten early")
        self.commit()
        self.assertEqual(self.deleted, ["masked_fields::*::person@example.test"])
        self.assertEqual(DB.find("User", "person@example.test")[0].roles, [])

    def test_revoke_whose_roles_another_grant_keeps_forgets_nothing(self):
        self.user("person@example.test", "Accounts User")
        self.grant("person@example.test", "budget-holder", ["Accounts User"])
        self.grant("person@example.test", "sales", ["Accounts User"])
        hats.apply_hat_revoked({"hat": "budget-holder", "person_email": "person@example.test"})
        self.commit()
        self.assertEqual(self.deleted, [])

    def test_added_role_forgets_masks_with_glob_characters_literal(self):
        self.user("a*b?@example.test", "Accounts User")
        hats.ensure_user("a*b?@example.test", "A B", ["Accounts User", "Purchase User"])
        hats.ensure_user("a*b?@example.test", "A B", ["Accounts User", "Purchase User"])  # no change, nothing more to forget
        self.commit()
        self.assertEqual(self.deleted, [r"masked_fields::*::a\*b\?@example.test"])


if __name__ == "__main__":
    unittest.main()
