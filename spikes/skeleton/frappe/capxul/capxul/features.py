"""Feature switches: which parts of the product a company's site shows. The state is a `Capxul Feature` row per feature (readable on
the site), `capxul.features.status` returns it, and four layers make "off" mean off. Nothing is deleted: off only refuses.

  1. User.block_modules  (native)  the part disappears from every person's desk, and /crm's own permission check fails
  2. has_permission "*"  (hook)    a document of an off DocType is refused to everyone but Administrator (Frappe skips hooks for it)
  3. permission_query_conditions "*" (hook)  lists of an off DocType come back empty
  4. before_request      (hook)    REST/RPC naming an off DocType, an off app's methods or /crm is a 403, Administrator included
Not closed: bench console / bench execute, raw SQL, the database, Server Scripts, a person's own already-open browser page until reload.
"""
import frappe
from frappe import _

from capxul.locks import applying

SHARED_MASTERS = {  # DocTypes other parts need to exist, so they stay reachable when the part that owns them is off
    "stock": {"Item", "Item Price", "Price List", "Brand", "Item Attribute", "Item Attribute Value", "Item Barcode", "UOM", "UOM Conversion Factor", "Item Group"},
}

# modules: Frappe modules whose DocTypes and desk pages belong to the part. apps: every module of these apps too.
# prefixes: dotted method paths that are the part's own API. paths: website routes. needs: other features that must be on.
CATALOG = {
    "accounts": dict(label="Accounts", modules=["Accounts"], default=1),
    "people": dict(label="People (HR)", modules=["HR", "Tax and Benefits", "Performance", "Expenses", "Leaves", "Shift and Attendance", "Recruitment", "Tenure", "HR Setup"], default=1),
    "payroll": dict(label="Payroll", modules=["Payroll"], prefixes=["hrms.payroll."], default=1),
    "projects": dict(label="Projects", modules=["Projects"], prefixes=["erpnext.projects."], default=1),
    "crm": dict(label="CRM (Frappe CRM)", apps=["crm"], prefixes=["crm."], paths=["/crm", "/crm-form"], app="crm", default=1),
    "whatsapp": dict(label="WhatsApp", apps=["frappe_whatsapp"], prefixes=["frappe_whatsapp."], needs=["crm"], app="frappe_whatsapp", default=0),
    "stock": dict(label="Stock", modules=["Stock"], default=0),
    "manufacturing": dict(label="Manufacturing", modules=["Manufacturing"], prefixes=["erpnext.manufacturing."], default=0),
}
CACHE_KEY = "capxul_off_map"
EXEMPT_FLAGS = ("in_install", "in_migrate", "in_patch", "in_setup_wizard", "in_test", "capxul_applying")


def ensure_rows():
    with applying():
        for name, c in CATALOG.items():
            if not frappe.db.exists("Capxul Feature", name):
                frappe.get_doc({"doctype": "Capxul Feature", "feature": name, "enabled": c["default"], "note": c["label"]}).insert(ignore_permissions=True)


def state():
    rows = {r.feature: bool(r.enabled) for r in frappe.get_all("Capxul Feature", ["feature", "enabled"])}
    return {f: ("on" if rows.get(f, bool(c["default"])) else "off") for f, c in CATALOG.items()}


@frappe.whitelist()
def status():
    """Any signed-in person may read which parts are on; it is not a secret and the desk needs it."""
    return {"features": state()}


def _modules_of(feature):
    c = CATALOG[feature]
    mods = set(c.get("modules", []))
    if c.get("apps"):
        mods |= {m.name for m in frappe.get_all("Module Def", {"app_name": ["in", c["apps"]]}, ["name"])}
    return mods


def _compute():
    """{doctype: feature} for every off feature, plus the off modules, prefixes and paths. Cached; cleared on every switch."""
    st, dts, mods, prefixes, paths = state(), {}, set(), [], []
    for f, c in CATALOG.items():
        if st[f] == "on":
            continue
        m = _modules_of(f)
        mods |= m
        for d in frappe.get_all("DocType", {"module": ["in", list(m)]} if m else {"name": ""}, ["name"]):
            if d.name not in SHARED_MASTERS.get(f, ()):
                dts[d.name] = f
        prefixes += [(p, f) for p in c.get("prefixes", [])]
        paths += [(p, f) for p in c.get("paths", [])]
    return {"doctypes": dts, "modules": sorted(mods), "prefixes": prefixes, "paths": paths}


def off_map():
    if not frappe.db:  # no site (e.g. hooks read at import)
        return {"doctypes": {}, "modules": [], "prefixes": [], "paths": []}
    return frappe.cache.get_value(CACHE_KEY, generator=_compute)


def _exempt():
    return any(frappe.flags.get(f) for f in EXEMPT_FLAGS)


def _refuse(feature):
    frappe.throw(_("{0} is switched off for this company.").format(CATALOG[feature]["label"]), frappe.PermissionError)


# ---- layer 2 and 3: permission hooks -------------------------------------------------------------------------------------------
def has_permission(doc, ptype=None, user=None, debug=False):
    return False if (doc.doctype in off_map()["doctypes"] and not _exempt()) else True


def query_conditions(user, doctype=None):
    return "1=0" if (doctype in off_map()["doctypes"] and not _exempt()) else ""


# ---- layer 4: the request guard (REST and RPC, every user including Administrator) -----------------------------------------
def guard_request():
    if not frappe.request or not frappe.db:
        return
    m = off_map()
    if not (m["doctypes"] or m["prefixes"] or m["paths"]):
        return
    path = frappe.request.path
    for p, f in m["paths"]:
        if path == p or path.startswith(p + "/"):
            _refuse(f)
    if path.startswith("/api/resource/"):
        dt = path[len("/api/resource/"):].split("/")[0]
        from urllib.parse import unquote
        if unquote(dt) in m["doctypes"]:
            _refuse(m["doctypes"][unquote(dt)])
    elif path.startswith("/api/method/"):
        method = path[len("/api/method/"):]
        for p, f in m["prefixes"]:
            if method.startswith(p):
                _refuse(f)
        fd = frappe.form_dict
        for k in ("doctype", "dt", "reference_doctype", "parent"):
            v = fd.get(k)
            if isinstance(v, str) and v in m["doctypes"]:
                _refuse(m["doctypes"][v])
        d = fd.get("doc")  # frappe.client.insert / save / submit send the whole document as JSON
        if isinstance(d, str) and d.startswith("{"):
            import json
            try:
                v = json.loads(d).get("doctype")
            except ValueError:
                v = None
            if v in m["doctypes"]:
                _refuse(m["doctypes"][v])


# ---- layer 1: block_modules on every user --------------------------------------------------------------------------------------
def _managed_modules():
    return set().union(*[_modules_of(f) for f in CATALOG])


def apply_user_blocks(doc, method=None):
    """User.validate: the user's Block Module rows are the off modules (plus any the site set that are not ours)."""
    if doc.flags.get("capxul_skip_blocks"):
        return
    managed, off = _managed_modules(), set(off_map()["modules"])
    keep = [b.module for b in doc.get("block_modules") or [] if b.module not in managed]
    want = sorted(off | set(keep))
    if sorted(b.module for b in doc.get("block_modules") or []) != want:
        doc.set("block_modules", [{"module": m} for m in want])


def sync_users():
    for u in frappe.get_all("User", {"user_type": "System User"}, pluck="name"):
        doc = frappe.get_doc("User", u)
        doc.flags.ignore_permissions = True
        with applying():
            doc.save()  # validate runs apply_user_blocks


# ---- the switch --------------------------------------------------------------------------------------------------------------------
def set_feature(feature, on):
    if feature not in CATALOG:
        frappe.throw(_("Unknown feature {0}. Known: {1}").format(feature, ", ".join(CATALOG)), frappe.ValidationError)
    st = state()
    if on:
        for n in CATALOG[feature].get("needs", []):
            if st[n] != "on":
                frappe.throw(_("{0} needs {1}, which is off. Turn {1} on first.").format(feature, n), frappe.ValidationError)
    else:
        for f, c in CATALOG.items():
            if feature in c.get("needs", []) and st[f] == "on":
                frappe.throw(_("{0} is on and needs {1}. Turn {0} off first.").format(f, feature), frappe.ValidationError)
    ensure_rows()
    with applying():
        frappe.db.set_value("Capxul Feature", feature, "enabled", 1 if on else 0)
    frappe.cache.delete_value(CACHE_KEY)
    frappe.clear_cache()
    frappe.db.commit()
    sync_users()
    frappe.db.commit()
    return state()


def sync():
    """After an app is installed or the catalog changed: make rows, caches and desk blocks match."""
    ensure_rows()
    frappe.cache.delete_value(CACHE_KEY)
    frappe.clear_cache()
    frappe.db.commit()
    sync_users()
    frappe.db.commit()
    return state()


# ---- what feature.sh calls (through `bench execute`) ---------------------------------------------------------------------------
def precheck(feature, on):
    """Refusals that must come before anything is installed. Returns {"ok": True} or {"ok": False, "reason": ...}."""
    try:
        if feature not in CATALOG:
            frappe.throw(_("Unknown feature {0}. Known: {1}").format(feature, ", ".join(CATALOG)), frappe.ValidationError)
        st = state()
        if on:
            for n in CATALOG[feature].get("needs", []):
                if st[n] != "on":
                    frappe.throw(_("{0} needs {1}, which is off. Turn {1} on first.").format(feature, n), frappe.ValidationError)
        else:
            for f, c in CATALOG.items():
                if feature in c.get("needs", []) and st[f] == "on":
                    frappe.throw(_("{0} is on and needs {1}. Turn {0} off first.").format(f, feature), frappe.ValidationError)
    except frappe.ValidationError as e:
        return {"ok": False, "reason": str(e)}
    return {"ok": True, "app": CATALOG[feature].get("app"), "state": st[feature]}


def switch(feature, on):
    r = precheck(feature, on)
    if not r["ok"]:
        return r
    return {"ok": True, "features": set_feature(feature, bool(on))}


def count(doctype):
    """Rows in the database, whatever the switch says (a bench-side check that off kept the data)."""
    return frappe.db.count(doctype)


def roles_of(user):
    return frappe.get_roles(user) if frappe.db.exists("User", user) else []
