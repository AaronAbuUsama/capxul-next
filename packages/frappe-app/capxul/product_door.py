"""The public document RPC's site transaction. Authentication stays in capxul.door.

Only the signed person's native permissions run a document operation. A call-id receipt and its
mutation commit together, so a lost HTTP response cannot produce a second insertion on retry.
"""
import hashlib
import json
import re

import frappe

from capxul import features, payments


class DoorError(Exception):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def _identity(org):
    if org != frappe.db.get_single_value("Capxul Settings", "org_slug"):
        raise DoorError("ROLE_PERMISSION_DENIED", "The company does not own this site")
    user = frappe.session.user
    if user in ("Guest", "Administrator") or not frappe.db.exists("Capxul Hat Grant", {"user": user}):
        raise DoorError("ROLE_PERMISSION_DENIED", "The caller wears no hat on this site")


def _object(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            raise DoorError("INVALID_INPUT", "Expected a JSON object") from None
    if not isinstance(value, dict):
        raise DoorError("INVALID_INPUT", "Expected a JSON object")
    return value


def _fields(doctype, values):
    """Do not let Frappe's non-field attributes (flags, ignore_permissions, docstatus) enter a document."""
    meta = frappe.get_meta(doctype)
    permitted = {df.fieldname: df for df in meta.fields}
    result = {}
    for key, value in _object(values).items():
        df = permitted.get(key)
        if not df or df.read_only or key.startswith("_") or key in ("flags", "ignore_permissions", "doctype", "docstatus", "name"):
            raise DoorError("INVALID_INPUT", "Unknown or protected document field")
        if df.fieldtype in ("Table", "Table MultiSelect"):
            if not isinstance(value, list):
                raise DoorError("INVALID_INPUT", "A child table must be an array")
            value = [_fields(df.options, row) for row in value]
        result[key] = value
    return result


def _snapshot(doc):
    # Private immutable mutation evidence; never return this without current read filtering.
    return {"doctype": doc.doctype, "name": doc.name, "docstatus": doc.docstatus, "fields": doc.as_dict()}


def _current_masks(doctype):
    # Frappe 16 caches each user's masked fields (meta.get_masked_fields) and never clears them when roles
    # change, so a revoked hat would keep its unmasked view. Drop this user's entries and recompute.
    user = frappe.session.user
    frappe.cache.delete_value([f"masked_fields::{doctype}::::{user}"] + [
        f"masked_fields::{df.options}::{doctype}::{user}" for df in frappe.get_meta(doctype).get_table_fields()])


def _document(doc):
    doc.check_permission("read")
    _current_masks(doc.doctype)
    doc.apply_fieldlevel_read_permissions()
    return _snapshot(doc)


def _envelope(action):
    frappe.db.savepoint("capxul_product_door")
    try:
        return {"ok": True, "data": action()}
    except Exception as error:
        # Caught exceptions still return normally to Frappe; explicitly undo even a partial insertion.
        frappe.db.rollback(save_point="capxul_product_door")
        kind = type(error).__name__
        if isinstance(error, DoorError):
            code, message = error.code, str(error)
        elif kind == "FeatureNotAvailable":
            code, message = "FEATURE_NOT_AVAILABLE", str(error)
        elif isinstance(error, frappe.PermissionError):
            code, message = "ROLE_PERMISSION_DENIED", str(error)
        elif isinstance(error, (frappe.ValidationError, frappe.DoesNotExistError, frappe.NameError)):
            # NameError covers DuplicateEntryError: a duplicate is the caller's input, not a retryable outage.
            code, message = "INVALID_INPUT", str(error)
        else:
            # Do not return exception traces, SQL, document bodies or service credentials.
            code, message = "PROVIDER_ERROR", "The site could not complete the document call"
        frappe.local.response.http_status_code = {
            "INVALID_INPUT": 400, "ROLE_PERMISSION_DENIED": 403, "FEATURE_NOT_AVAILABLE": 403,
            "WRONG_STATE": 409, "PROVIDER_ERROR": 503,
        }[code]
        return {"ok": False, "error": {"code": code, "message": re.sub("<[^>]+>", "", message)[:500]}}


@frappe.whitelist(methods=["POST"])
def run(org, verb, doctype, name=None, fields=None, call_id=None):
    def action():
        _identity(org)
        if verb not in ("get", "create", "submit") or not isinstance(doctype, str) or not doctype.strip():
            raise DoorError("INVALID_INPUT", "Unknown document operation or type")
        if verb != "create" and (not isinstance(name, str) or not name):
            raise DoorError("INVALID_INPUT", "A document name is required")
        off = features.off_map()["doctypes"].get(doctype)
        if off:
            raise DoorError("FEATURE_NOT_AVAILABLE", f"The {off} feature is off")
        if verb == "get":
            doc = frappe.get_doc(doctype, name)
            doc.check_permission("read")
            return _document(doc)
        if not isinstance(call_id, str) or not 1 <= len(call_id) <= 140:
            raise DoorError("INVALID_INPUT", "A call_id of 1 to 140 characters is required")
        values = _fields(doctype, fields) if verb == "create" else None
        request = {"verb": verb, "doctype": doctype, "name": name, "fields": values}
        fingerprint = hashlib.sha256(json.dumps(request, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        key = hashlib.sha256(call_id.encode()).hexdigest()
        user = frappe.session.user
        # The upsert waits for an uncommitted caller with this key. Row lock, document and receipt share one transaction.
        frappe.db.sql("""insert into `tabCapxul Door Call`
            (name,creation,modified,owner,modified_by,docstatus,idx,person,request_hash,response_json)
            values (%s,NOW(6),NOW(6),%s,%s,0,0,%s,%s,'') on duplicate key update name=name""",
                      (key, user, user, user, fingerprint))
        saved = frappe.db.sql("""select person,request_hash,response_json from `tabCapxul Door Call`
            where name=%s for update""", (key,), as_dict=True)[0]
        if saved.person != user:
            raise DoorError("ROLE_PERMISSION_DENIED", "The call id belongs to another person")
        if saved.request_hash != fingerprint:
            raise DoorError("INVALID_INPUT", "The call id was already used for a different request")
        if saved.response_json:
            # Authorization is fresh even when the document effect has already happened.
            result = json.loads(saved.response_json)
            doc = frappe.get_doc(doctype, result["name"] if verb == "create" else name)
            doc.check_permission("read")
            doc.check_permission("create" if verb == "create" else "submit")
            # Retain the historical values/status, not historical permission to disclose them.
            return result if result.get("safe") else _document(frappe.get_doc(result["fields"]))
        if verb == "create":
            doc = frappe.get_doc({**values, "doctype": doctype, "docstatus": 0}).insert()
            result = _snapshot(doc)
        else:
            doc = frappe.get_doc(doctype, name)
            doc.check_permission("submit")
            if doc.docstatus != 0:
                raise DoorError("WRONG_STATE", "Only a draft can be submitted")
            held = payments.request_payment(name) if doctype == "Payment Entry" else {"safe": False}
            # A later call id can find a site request already answered. Core still reads its committed
            # collector answer; the document transport never turns a site status or URL into authority.
            result = {"safe": True, "status": "Requesting", "approval_url": None, "request": held["request"]} if held["safe"] else _snapshot(doc.submit())
        frappe.db.set_value("Capxul Door Call", key, "response_json", frappe.as_json(result), update_modified=False)
        return result if result.get("safe") else _document(doc)
    return _envelope(action)


@frappe.whitelist(methods=["POST"])
def account(org, reference):
    """Resolve a books annotation on the site's own chart, never a Core chart replica."""
    def action():
        _identity(org)
        if not isinstance(reference, str) or not reference.strip():
            raise DoorError("INVALID_INPUT", "An account name or number is required")
        if "Account" in features.off_map()["doctypes"]:
            raise DoorError("FEATURE_NOT_AVAILABLE", "The accounts feature is off")
        company = frappe.db.get_single_value("Global Defaults", "default_company")
        if not company:
            raise DoorError("INVALID_INPUT", "The site has no Company")
        # get_list applies native role, row and User Permission filters before disclosing candidates.
        matches = frappe.get_list("Account", filters={"company": company},
                                  or_filters={"name": reference, "account_number": reference},
                                  fields=["name"], page_length=2)
        if len(matches) != 1:
            raise DoorError("INVALID_INPUT", "No unique visible ledger account matches the reference")
        doc = frappe.get_doc("Account", matches[0].name)
        doc.check_permission("read")
        if doc.company != company or doc.is_group or doc.disabled:
            raise DoorError("INVALID_INPUT", "The account must be an enabled ledger account of this Company")
        return _document(doc)
    return _envelope(action)


@frappe.whitelist(methods=["POST"])
def report(org, report, filters=None):
    def action():
        _identity(org)
        from frappe.desk.query_report import run as run_report

        if not isinstance(report, str) or not report:
            raise DoorError("INVALID_INPUT", "A report name is required")
        reference = frappe.db.get_value("Report", report, "ref_doctype")
        off = features.off_map()["doctypes"].get(reference)
        if off:
            raise DoorError("FEATURE_NOT_AVAILABLE", f"The {off} feature is off")
        if reference:
            _current_masks(reference)  # Frappe masks report rows with the reference DocType's cached masks.
        data = run_report(report, filters=_object(filters or {}), ignore_prepared_report=True)
        columns = [c if isinstance(c, dict) else {"fieldname": c.split(":")[0], "label": c.split(":")[0]} for c in data["columns"]]
        rows = [dict(zip((c["fieldname"] for c in columns), row)) if isinstance(row, (list, tuple)) else row for row in data["result"]]
        if any(not isinstance(row, dict) for row in rows):
            raise DoorError("INVALID_INPUT", "The report returned an unsupported row")
        return {"columns": columns, "rows": rows}
    return _envelope(action)
