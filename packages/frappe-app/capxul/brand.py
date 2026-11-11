"""Names only: a person on the site reads "Capxul", not "Frappe" or "ERPNext". Configuration and our own app; no fork.

What does the work (each is measured by bin/find-names.sh and written up in FINDINGS.md):
  1. Settings that carry the product name: System Settings app name and OTP issuer, Website Settings app name and "powered by" footer,
     the standard email footer replaced by "Sent via Capxul".
  2. The site's language is English (UK) (`en-GB`), and Capxul's own Translation rows for that language rewrite every interface string
     that holds the names. Frappe does not apply Translation rows to plain `en`, but does to `en-GB`: the desk, the apps screen, the
     Workspaces, the onboarding, the CRM front end and the server's messages all pass their text through `__()` / `_()`.
     The rows are made from what is installed (the strings in the JS bundles, the Workspace, Onboarding and Module records), so a new
     app version is covered by running `apply` again (it runs after every migrate).
  3. `after_request`: the <title> and PWA title of a page that Frappe or CRM render with the name fixed in a template.
  4. The Navbar's "Frappe Support" link (it points at frappe.io) is removed. "About" stays.
What stays, on purpose: the copyright and licence notices ("(c) Frappe Technologies Pvt. Ltd. and contributors", the About dialog),
the names of third-party services ("Frappe Mail", "Frappe Cloud"), code, URLs and permission lists.
"""
import glob
import os
import re

import frappe

LANG = "en-GB"
BRAND = "Capxul"
KEEP = r"(?! Technologies| Mail| Cloud)"  # the copyright holder and other companies' services keep their names
RULES = [
    (r"\bFrappe Helpdesk\b", "Helpdesk"), (r"\bFrappe HR\b", f"{BRAND} HR"), (r"\bFrappe CRM\b", f"{BRAND} CRM"),
    (r"\bFrappe Whats[Aa]pp\b", f"{BRAND} WhatsApp"), (r"\bFrappe Support( Portal)?\b", f"{BRAND} Support"),
    (r"\bFrappe Framework\b", BRAND), (r"\bERPNext\b", BRAND), (rf"\bFrappe\b{KEEP}", BRAND),
]
BENCH = "/home/frappe/vol/frappe-bench/apps"
BUNDLES = ["crm/crm/public/frontend/assets/*.js", "frappe/frappe/public/dist/js/*.js", "erpnext/erpnext/public/dist/js/*.js",
           "hrms/hrms/public/dist/js/*.js", "frappe_whatsapp/frappe_whatsapp/public/**/*.js"]
NAME = re.compile(r"(?<![A-Za-z_.])(?<!X-)(?:Frappe|ERPNext)(?![A-Za-z_])(?!\.[a-z_])")
PY_MSG = re.compile(r"""\b_\(\s*(?:f?)(["'])((?:(?!\1).)*?(?:Frappe|ERPNext)(?:(?!\1).)*?)\1""")
PYTHON = ["crm/crm/**/*.py", "erpnext/erpnext/**/*.py", "hrms/hrms/**/*.py", "frappe/frappe/**/*.py", "frappe_whatsapp/frappe_whatsapp/**/*.py"]
QUOTES, OPENERS = "\"'`", "(,[:=+{ ?|&!>\t"


def literals_with_names(body):  # (the crawler's copy also reports whether the text went through __())
    """Every JS string literal that holds the name: from the name left to the quote that opens it, right to the one that closes it."""
    out = set()
    for m in NAME.finditer(body):
        idx, pos = m.start(), m.start()
        for _ in range(300):
            pos -= 1
            if pos < 0:
                break
            if body[pos] in QUOTES and (pos == 0 or body[pos - 1] in OPENERS):
                c = body[pos]
                r = body.find(c, idx)
                while r != -1 and body[r - 1] == "\\":
                    r = body.find(c, r + 1)
                if r != -1 and r - pos <= 700 and "\n" not in body[pos + 1:r]:
                    out.add(body[pos + 1:r])
                    break
    return out


# DB records whose text a person reads: (doctype, fields)
RECORDS = [("Workspace", ["title", "label"]), ("Module Onboarding", ["title", "subtitle", "success_message"]), ("Onboarding Step", ["title", "description"]),
           ("Module Def", ["name"]), ("Email Template", ["subject"]), ("Page", ["title"]), ("Number Card", ["label"]), ("DocType", ["name"]),
           ("Report", ["name"]), ("Desktop Icon", ["label"]), ("Workspace Sidebar", ["title"])]
EXTRA = {"Framework": "System"}  # the apps-screen tile of the framework itself


def rebrand(text):
    out = text
    for rx, to in RULES:
        out = re.sub(rx, to, out)
    return out


def _bundle_strings():
    found = set()
    for pat in BUNDLES:
        for path in glob.glob(os.path.join(BENCH, pat), recursive=True):
            try:
                body = open(path, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            for s in literals_with_names(body):
                if re.search(r"https?://|/assets/|frappe\.[a-z]|frappeframework|github", s) and not re.search(r"\s[A-Za-z]", s):
                    continue
                if re.match(r"^[A-Za-z_.]+$", s) or "{{" in s or len(s) > 700:
                    continue
                found.add(s)
    return found


def _python_strings():
    """The server's own messages: `_("... Frappe CRM ...")` in the installed apps' Python (shown as errors, emails, pages)."""
    found = set()
    for pat in PYTHON:
        for path in glob.glob(os.path.join(BENCH, pat), recursive=True):
            if "/tests/" in path or "/patches/" in path or path.endswith("test_" + os.path.basename(path)[5:]):
                continue
            try:
                body = open(path, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            if "Frappe" not in body and "ERPNext" not in body:
                continue
            for m in PY_MSG.finditer(body):
                s = m.group(2)
                if "{" not in s.replace("{0}", "").replace("{1}", "") and not re.search(r"https?://|\.py\b", s):
                    found.add(s)
    return found


def _record_strings():
    found = set()
    for dt, fields in RECORDS:
        if not frappe.db.exists("DocType", dt):
            continue
        for f in fields:
            if not frappe.db.has_column(dt, f):
                continue
            for (v,) in frappe.db.sql(f"select `{f}` from `tab{dt}` where `{f}` like '%%Frappe%%' or `{f}` like '%%ERPNext%%'"):
                if v:
                    found.add(v)
    for h in frappe.get_hooks("add_to_apps_screen") or []:
        found.add(h.get("title") or "")
    return found


def translations():
    """{source: replacement} for every string the site shows that holds a name."""
    out = {s: rebrand(s) for s in _bundle_strings() | _record_strings() | _python_strings() if s and rebrand(s) != s}
    out.update(EXTRA)
    return out


def _set_translations(pairs):
    have = {t.source_text: t for t in frappe.get_all("Translation", {"language": LANG}, ["name", "source_text", "translated_text"])}
    made = 0
    for src, to in pairs.items():
        if src in have:
            if have[src].translated_text != to:
                frappe.db.set_value("Translation", have[src].name, "translated_text", to)
            continue
        frappe.get_doc({"doctype": "Translation", "language": LANG, "source_text": src, "translated_text": to}).insert(ignore_permissions=True)
        made += 1
    return made


def apply():
    """Idempotent. Run by configure_site and after every migrate."""
    frappe.set_user("Administrator")
    if frappe.db.exists("Language", LANG):
        frappe.db.set_value("Language", LANG, "enabled", 1)
    ss = frappe.get_doc("System Settings")
    ss.update({"language": LANG, "app_name": BRAND, "otp_issuer_name": BRAND})
    ss.save(ignore_permissions=True)
    ws = frappe.get_doc("Website Settings")
    ws.update({"app_name": BRAND, "footer_powered": f"Powered by {BRAND}"})
    ws.save(ignore_permissions=True)
    frappe.db.set_default("disable_standard_email_footer", 1)  # the standard footer says "Sent via ERPNext"; ours is the sender address block
    frappe.db.set_default("email_footer_address", f"Sent via {BRAND}")
    if frappe.db.exists("DocType", "FCRM Settings"):
        frappe.db.set_single_value("FCRM Settings", "brand_name", f"{BRAND} CRM")  # CRM's own Settings > Branding: the name in its sidebar
    nav = frappe.get_doc("Navbar Settings")
    nav.help_dropdown = [r for r in nav.help_dropdown if not re.search(r"Frappe|ERPNext", r.item_label or "")]
    nav.save(ignore_permissions=True)
    for u in frappe.get_all("User", {"language": ["in", ["", "en"]], "name": ["not in", ["Guest"]]}, pluck="name"):
        frappe.db.set_value("User", u, "language", LANG)
    made = _set_translations(translations())
    frappe.clear_cache()
    frappe.db.commit()
    return {"translations_made": made, "language": LANG}


def user_language(doc, method=None):
    """User.validate: a person made by a hat starts on the site's language, so the Translation rows reach them."""
    if doc.get("language") in (None, "", "en"):
        doc.language = LANG


# ---- the <title> that a template fixes -------------------------------------------------------------------------------------------
TITLE = re.compile(r"(<title>)([^<]*)(</title>)|(<meta[^>]+(?:application-name|apple-mobile-web-app-title|og:title|og:site_name)[^>]+content=\")([^\"]*)(\")")


def after_request(response=None, request=None):
    """Pages that Frappe or CRM render with the name written into the template: say Capxul in the <title> and the PWA titles."""
    try:
        if response is None or response.status_code >= 500 or "text/html" not in (response.mimetype or "") or response.direct_passthrough:
            return
        body = response.get_data(as_text=True)
        if "Frappe" not in body and "ERPNext" not in body:
            return

        def fix(m):
            if m.group(1):
                return m.group(1) + rebrand(m.group(2)) + m.group(3)
            return m.group(4) + rebrand(m.group(5)) + m.group(6)

        new = TITLE.sub(fix, body)
        if new != body:
            response.set_data(new)
    except Exception:  # a cosmetic rewrite must never break a page
        pass
