"""Small site-free Frappe fixture; transaction behavior is validated on the real bench."""
import sys
import types
from pathlib import Path

APP = Path(__file__).resolve().parents[1]


class Doc(dict):
    def __getattr__(self, k):
        try:
            return self[k]
        except KeyError:
            raise AttributeError(k)

    def __setattr__(self, k, v):
        self[k] = v

    def db_set(self, values):
        self.update(values)

    def submit(self):
        self["docstatus"] = 1

    def check_permission(self, permission):
        if self.get("deny"):
            raise RuntimeError("Permission denied")

    def insert(self, ignore_permissions=False):
        DB.insert(self)
        return self

    def add_roles(self, *roles):
        self.roles.extend(Doc(role=role) for role in roles if role not in {r.role for r in self.roles})

    def remove_roles(self, *roles):
        self.roles = [row for row in self.roles if row.role not in roles]


class Flags(dict):
    __getattr__ = dict.get

    def __setattr__(self, k, v):
        self[k] = v


class FakeDB:
    def __init__(self):
        self.rows = {}
        self.singles = {}

    def reset(self, **singles):
        self.rows = {}
        self.singles = dict(singles)

    def insert(self, doc):
        if doc["doctype"] == "Capxul Chain Event" and "name" not in doc:
            doc["name"] = doc["event_key"]
        doc.setdefault("name", f"{doc['doctype']}-{len(self.rows.get(doc['doctype'], [])) + 1}")
        doc.setdefault("docstatus", 0)
        doc.setdefault("creation", len(self.all()))
        doc.setdefault("flags", Flags())
        if doc["doctype"] == "Capxul Payment Request":
            doc.setdefault("answer_json", None)
            doc.setdefault("approval_url", None)
        self.rows.setdefault(doc["doctype"], []).append(doc)
        return doc

    def all(self):
        return [d for docs in self.rows.values() for d in docs]

    def _match(self, doc, filters):
        if isinstance(filters, str):
            return doc["name"] == filters
        for k, v in filters.items():
            if isinstance(v, list) and v and v[0] == "in":
                if doc.get(k) not in v[1]:
                    return False
            elif isinstance(v, list) and v[0] == ">":
                if (doc.get(k) or 0) <= v[1]:
                    return False
            elif isinstance(v, list) and v[0] == "!=":
                if doc.get(k) == v[1]:
                    return False
            elif doc.get(k) != v:
                return False
        return True

    def find(self, doctype, filters):
        return [d for d in self.rows.get(doctype, []) if self._match(d, filters)]

    def get_value(self, doctype, filters, field="name", order_by=None, as_dict=False, for_update=False):
        found = self.find(doctype, filters)
        if order_by and "desc" in order_by:
            found = sorted(found, key=lambda d: d["creation"], reverse=True)
        if not found:
            return None
        d = found[0]
        if isinstance(field, list):
            return Doc({f: d.get(f) for f in field}) if as_dict else [d.get(f) for f in field]
        return d.get(field)

    def exists(self, doctype, filters):
        return bool(self.find(doctype, filters))

    def set_value(self, doctype, name, field, value=None, update_modified=True):
        doc = self.find(doctype, name)[0]
        doc.update(field if isinstance(field, dict) else {field: value})

    def get_single_value(self, doctype, field):
        return self.singles.get(field)

    def set_single_value(self, doctype, field, value):
        self.singles[field] = value

    def sql(self, query, args=None):
        if "field='request_seq'" in query:
            return [(self.singles["request_seq"],)] if "request_seq" in self.singles else []
        if "field='last_seq'" in query:
            return [(self.singles["last_seq"],)]
        return []

    def savepoint(self, name):
        pass

    def rollback(self, save_point=None):
        pass

    def commit(self):
        pass


DB = FakeDB()


def install():
    frappe = types.ModuleType("frappe")
    frappe.db = DB
    frappe.flags = Flags()
    frappe._ = lambda s: s

    def get_doc(doctype, name=None, **kwargs):
        if isinstance(doctype, dict):
            return Doc(doctype)
        if name is None:
            return Doc(DB.singles)
        return DB.find(doctype, name)[0]

    def throw(msg, *a, **k):
        raise RuntimeError(msg)

    frappe.get_doc = get_doc
    frappe.delete_doc = lambda doctype, name, **kwargs: DB.rows[doctype].remove(DB.find(doctype, name)[0])
    frappe.throw = throw
    frappe.ValidationError = frappe.AuthenticationError = frappe.PermissionError = frappe.DoesNotExistError = RuntimeError
    frappe.QueryDeadlockError = type("QueryDeadlockError", (Exception,), {})
    frappe.whitelist = lambda **kwargs: lambda f: f
    frappe.session = Flags(user="admin@example.invalid")
    frappe.local = Flags(site="boundary.localhost", response=Flags(), form_dict=Flags())
    frappe.set_user = lambda user: setattr(frappe.session, "user", user)
    frappe.get_request_header = lambda key: None

    def get_all(doctype, filters=None, fields=None, order_by=None, limit_page_length=100):
        rows = DB.find(doctype, filters or {})
        if order_by:
            field, direction = order_by.split()
            rows = sorted(rows, key=lambda d: d[field], reverse=direction == "desc")
        return rows[:limit_page_length] if limit_page_length else rows

    frappe.get_all = get_all
    frappe.publish_realtime = lambda *a, **k: None
    utils = types.ModuleType("frappe.utils")
    utils.flt = lambda v, p=None: round(float(v or 0), p) if p is not None else float(v or 0)
    utils.getdate = lambda s: s
    utils.now_datetime = lambda: "2026-11-11 00:00:00"
    password = types.ModuleType("frappe.utils.password")
    password.get_decrypted_password = lambda *a, **k: "secret"
    frappe.utils = utils
    sys.modules.update({"frappe": frappe, "frappe.utils": utils, "frappe.utils.password": password})
    pkg = types.ModuleType("capxul")
    pkg.__path__ = [str(APP / "capxul")]
    sys.modules["capxul"] = pkg
