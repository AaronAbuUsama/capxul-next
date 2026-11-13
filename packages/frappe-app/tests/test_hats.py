"""A role change forgets Frappe's per-user masked-field cache after it commits, and only the changed user's."""
import json
import re
import sys
import unittest
from unittest.mock import patch

from frappe_fake import DB, Doc, install

if "frappe" not in sys.modules:
    install()
from capxul import hats  # noqa: E402


def glob(pattern):
    """Redis glob: `*`, `?` and `[...]`, with backslash escapes."""
    out, i = "", 0
    while i < len(pattern):
        c = pattern[i]
        if c == "\\" and i + 1 < len(pattern):
            out, i = out + re.escape(pattern[i + 1]), i + 2
            continue
        out += {"*": ".*", "?": "."}.get(c, re.escape(c))
        i += 1
    return re.compile(out + r"\Z", re.S)


class Cache:
    """Frappe's RedisWrapper key handling: keys are `<db>|<key>` bytes and get_keys appends `*` to the pattern."""

    def __init__(self, *keys):
        self.keys = {f"site|{k}".encode() for k in keys}

    def get_keys(self, key):
        match = glob(f"site|{key}*")
        return [k for k in self.keys if match.match(k.decode())]

    def delete_value(self, keys, make_keys=True):
        assert not make_keys
        self.keys -= set(keys)


KEYS = [f"masked_fields::Supplier::::{user}" for user in ("a@x.co", "a@x.com", "a@x.co.uk", "other@x.co")] + \
    ["masked_fields::Payment Entry Reference::Payment Entry::a@x.co", "masked_fields::Supplier::::a*b?@x.co"]


class MaskCacheFollowsRoles(unittest.TestCase):
    def setUp(self):
        DB.reset()
        self.callbacks = []
        self.cache = Cache(*KEYS)
        for target, name, value in ((hats.frappe.db, "after_commit", type("Callbacks", (), {"add": lambda _, fn: self.callbacks.append(fn)})()),
                                    (hats.frappe, "cache", self.cache)):
            p = patch.object(target, name, value, create=True)
            p.start()
            self.addCleanup(p.stop)

    def user(self, email, *roles):
        DB.insert(Doc(doctype="User", name=email, roles=[Doc(role=r) for r in roles]))

    def grant(self, email, hat, roles):
        DB.insert(Doc(doctype="Capxul Hat Grant", user=email, hat=hat, department="", roles_given=json.dumps(roles)))

    def commit(self):
        for fn in self.callbacks:
            fn()

    def remaining(self):
        return sorted(k.decode().split("|", 1)[1] for k in self.cache.keys)

    def test_revoke_that_drops_roles_forgets_only_that_users_masks_once_committed(self):
        self.user("a@x.co", "Accounts User", "Purchase User")
        self.grant("a@x.co", "budget-holder", ["Accounts User", "Purchase User"])
        hats.apply_hat_revoked({"hat": "budget-holder", "person_email": " A@X.co "})
        self.assertEqual(self.remaining(), sorted(KEYS), "an uncommitted or rolled-back change must not forget early")
        self.commit()
        self.assertEqual(self.remaining(), sorted(k for k in KEYS if not k.endswith("::a@x.co")))
        self.assertEqual(DB.find("User", "a@x.co")[0].roles, [])

    def test_revoke_whose_roles_another_grant_keeps_forgets_nothing(self):
        self.user("a@x.co", "Accounts User")
        self.grant("a@x.co", "budget-holder", ["Accounts User"])
        self.grant("a@x.co", "sales", ["Accounts User"])
        hats.apply_hat_revoked({"hat": "budget-holder", "person_email": "a@x.co"})
        self.commit()
        self.assertEqual(self.remaining(), sorted(KEYS))

    def test_added_role_forgets_masks_with_glob_characters_literal(self):
        self.user("a*b?@x.co", "Accounts User")
        hats.ensure_user("a*b?@x.co", "A B", ["Accounts User", "Purchase User"])
        hats.ensure_user("a*b?@x.co", "A B", ["Accounts User", "Purchase User"])  # no change, nothing more to forget
        self.commit()
        self.assertEqual(self.remaining(), sorted(k for k in KEYS if not k.endswith("::a*b?@x.co")))


if __name__ == "__main__":
    unittest.main()
