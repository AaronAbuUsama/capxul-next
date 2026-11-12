"""The door, site side. A person reaches this site from the CLI as themselves: Core vouches for the person with a short-lived signed
assertion (`X-Capxul-Assertion`), the site checks it and makes that person the request's user, and from then on it is plain Frappe: the
person's roles, the person's permissions, the feature switches. Nothing is stored for the person anywhere (no password, no key, no token).
The assertion is HMAC-signed with the shared secret over {user, site, expiry}. In the product the signer is Core after a passkey sign-in.

Also here: what a person can discover (`types`, `schema`, `next_documents`, `reports`), from Frappe's own metadata and permission engine.
"""
import base64
import inspect
import json
import time

import frappe
from frappe import _

from capxul import features, sign

LAYOUT = {"Section Break", "Column Break", "Tab Break", "HTML", "Heading", "Fold", "Button", "Image"}


# ---- sign-in ----------------------------------------------------------------------------------------------------------------
def validate_assertion():
    """auth_hooks: runs for every request. No header: nothing to do (cookie, API key and Guest work as before)."""
    from capxul.payments import LISTENER

    authorization = frappe.get_request_header("Authorization") or ""
    if authorization.startswith("CapxulListener "):
        try:
            encoded, signature = authorization.split(" ", 1)[1].split(".", 1)
            raw = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
            p = json.loads(raw)
            ok = (sign.valid(raw, signature) and p.get("s") == frappe.local.site
                  and p.get("aud") == "payment-request-listener" and time.time() < float(p.get("exp", 0)) <= time.time() + 60)
        except Exception:
            ok = False
        if not ok or frappe.request.path != "/api/method/frappe.realtime.get_user_info":
            frappe.throw(_("Invalid listener credential or scope"), frappe.AuthenticationError)
        fd = frappe.local.form_dict
        frappe.set_user(LISTENER)
        frappe.local.form_dict = fd
        return
    # This service identity has no interactive or API-key login surface, even if someone sets a password for it.
    if frappe.session.user == LISTENER:
        frappe.throw(_("The request listener is not a person"), frappe.AuthenticationError)
    tok = frappe.get_request_header("X-Capxul-Assertion")
    if not tok:
        return
    ok, p = False, {}
    try:
        b, sig = tok.split(".", 1)
        raw = base64.urlsafe_b64decode(b + "=" * (-len(b) % 4))
        ok = sign.valid(raw, sig)
        p = json.loads(raw) if ok else {}
    except Exception:
        ok = False
    # the expiry is the HOST's time on purpose: Core and this site agree on it even when the world's clock was moved
    if not ok or p.get("s") != frappe.local.site or float(p.get("exp", 0)) < time.time():
        frappe.throw(_("The sign-in assertion is not valid"), frappe.AuthenticationError)
    email = p.get("u") or ""
    if not frappe.db.get_value("User", email, "enabled") or not frappe.db.exists("Capxul Hat Grant", {"user": email}):
        frappe.throw(_("{0} wears no hat on this site, so Capxul does not know them as a person here").format(email), frappe.AuthenticationError)
    fd = frappe.local.form_dict
    frappe.set_user(email)
    frappe.local.form_dict = fd   # set_user clears it, and the request's own arguments are still wanted


@frappe.whitelist()
def whoami():
    return {"user": frappe.session.user, "site": frappe.local.site, "roles": sorted(frappe.get_roles()),
            "hats": frappe.get_all("Capxul Hat Grant", {"user": frappe.session.user}, ["hat", "department"], ignore_permissions=True)}


# ---- discovery ---------------------------------------------------------------------------------------------------------------
def _feature_maps():
    modules, doctypes = {}, {}
    for f in features.CATALOG:
        for m in features._modules_of(f):
            modules[m] = f
        for dt in features.CATALOG[f].get("doctypes", []):
            doctypes[dt] = f
    return modules, doctypes


@frappe.whitelist()
def types(feature=None):
    """The DocTypes this person can read on this site (Frappe's own permission engine), with what else they may do. Off features are not listed."""
    mf, df = _feature_maps()
    off = features.off_map()["doctypes"]
    if feature:
        if feature != "core" and feature not in features.CATALOG:
            frappe.throw(_("Unknown feature {0}. Known: core, {1}").format(feature, ", ".join(features.CATALOG)), frappe.ValidationError)
        if feature != "core" and features.state()[feature] == "off":
            features._refuse(feature)
    u = frappe.get_user()
    readable = u.get_can_read()   # builds the permission sets used just below
    create, write, delete, submit, cancel = (set(x) for x in (u.can_create, u.can_write, u.can_delete, u.can_submit, u.can_cancel))
    rows = []
    for dt in sorted(readable):
        if dt in off:
            continue
        m = frappe.get_meta(dt)
        f = df.get(dt, mf.get(m.module, "core"))
        if feature and f != feature:
            continue
        rows.append({"doctype": dt, "module": m.module, "feature": f, "single": bool(m.issingle), "child": bool(m.istable),
                     "submittable": bool(m.is_submittable), "create": dt in create, "write": dt in write, "delete": dt in delete,
                     "submit": dt in submit, "cancel": dt in cancel})
    return {"count": len(rows), "types": rows}


def _fields(meta):
    out = []
    for df in meta.fields:
        if df.fieldtype in LAYOUT:
            continue
        out.append({k: v for k, v in {"fieldname": df.fieldname, "label": df.label, "type": df.fieldtype, "options": df.options or None,
                                      "required": bool(df.reqd) or None, "read_only": bool(df.read_only) or None, "default": df.default or None,
                                      "unique": bool(df.unique) or None, "in_list_view": bool(df.in_list_view) or None}.items() if v is not None})
    return out


@frappe.whitelist()
def schema(doctype):
    frappe.has_permission(doctype, "read", throw=True)
    m = frappe.get_meta(doctype)
    mf, df = _feature_maps()
    kids = {df.fieldname: {"doctype": df.options, "fields": _fields(frappe.get_meta(df.options))} for df in m.get_table_fields()}
    perms = frappe.permissions.get_role_permissions(m)
    return {"doctype": doctype, "module": m.module, "feature": df.get(doctype, mf.get(m.module, "core")), "single": bool(m.issingle), "child": bool(m.istable),
            "submittable": bool(m.is_submittable), "naming": m.autoname or m.naming_rule, "title_field": m.title_field,
            "sort": f"{m.sort_field} {m.sort_order}", "you_may": {k: bool(v) for k, v in perms.items() if k in ("read", "write", "create", "delete", "submit", "cancel", "amend", "report")},
            "fields": _fields(m), "child_tables": kids,
            "links_out": sorted({(df.fieldname, df.options) for df in m.fields if df.fieldtype == "Link"}),
            "workflows": frappe.get_all("Workflow", {"document_type": doctype, "is_active": 1}, pluck="name", ignore_permissions=True)}


def _target_of(fname):
    for p in ("make_", "create_"):
        if fname.startswith(p):
            return fname[len(p):].replace("_", " ").title()
    return None


def _module_of(doctype):
    from frappe.modules import scrub

    m = frappe.get_meta(doctype)
    app = frappe.local.module_app.get(scrub(m.module))
    if not app:
        return None
    try:
        return frappe.get_module(f"{app}.{scrub(m.module)}.doctype.{scrub(doctype)}.{scrub(doctype)}")
    except Exception:
        return None


@frappe.whitelist()
def next_documents(doctype, name):
    """What Frappe says can follow a document. Two sources, both partial (see FINDINGS.md): the form's Connections (declared in the
    DocType's dashboard: which DocTypes link back to it) and the whitelisted `make_*` functions in the controller modules of the
    document's own DocType and of the follow-on DocTypes (a convention, not a registry). The form's "Create" buttons are client JavaScript
    and are not in any metadata."""
    frappe.get_doc(doctype, name).check_permission("read")
    dash = frappe.get_meta(doctype).get_dashboard_data() or {}
    off = features.off_map()["doctypes"]
    conns = [{"group": t["label"], "doctype": i, "you_may_create": bool(frappe.has_permission(i, "create"))}
             for t in dash.get("transactions", []) for i in t["items"] if i not in off and frappe.db.exists("DocType", i)]
    makers, seen = [], set()
    for dt in [doctype] + [c["doctype"] for c in conns]:
        mod = _module_of(dt)
        for fname, fn in (inspect.getmembers(mod, inspect.isfunction) if mod else []):
            if fn not in frappe.whitelisted or fn.__module__ != mod.__name__ or (mod.__name__, fname) in seen:
                continue
            params = list(inspect.signature(fn).parameters)
            if not params or params[0] not in ("source_name", "dn", "dt", "source", "name") and not fname.startswith("get_payment_entry"):
                continue
            tgt = _target_of(fname) or ("Payment Entry" if fname == "get_payment_entry" else None)
            if tgt is None or (dt != doctype and tgt != dt) or (dt == doctype and tgt not in [c["doctype"] for c in conns]):
                continue
            seen.add((mod.__name__, fname))
            args = {"dt": doctype, "dn": name} if params[0] == "dt" else {"source_name": name}
            makers.append({"builds": tgt, "method": f"{mod.__name__}.{fname}", "params": params, "try": {"args": args}})
    return {"doctype": doctype, "name": name, "connections": conns, "makers": makers,
            "note": "makers are discovered by name (make_<doctype>) from whitelisted controller functions; call one with `doc call`, then `doc create` the result"}


@frappe.whitelist()
def reports():
    off_mods = set(features.off_map()["modules"])
    out = []
    for r in frappe.db.sql("select name, report_type, ref_doctype, module from `tabReport` where disabled=0 order by name", as_dict=True):
        if r.module in off_mods or r.ref_doctype in features.off_map()["doctypes"]:
            continue
        try:
            if not frappe.get_doc("Report", r.name).is_permitted() or not (frappe.has_permission(r.ref_doctype, "report") if r.ref_doctype and r.report_type != "Custom Report" else True):
                continue
        except Exception:
            continue
        out.append({"name": r.name, "type": r.report_type, "doctype": r.ref_doctype, "module": r.module})
    return {"count": len(out), "reports": out}
