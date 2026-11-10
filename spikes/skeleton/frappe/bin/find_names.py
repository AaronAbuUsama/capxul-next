"""find_names.py <slug> <admin email> <member email>: where does the site still say "Frappe" or "ERPNext" to a person?

Signs in through the stand-in provider as an admin-hat person and as a member-hat person (and fetches the signed-out pages as a
guest), fetches the main pages, the boot data the desk loads, the lists a person reads (workspaces, onboarding, navbar, settings),
the CRM page and the JavaScript bundles, and lists every place the two names appear. THROWAWAY: dev only, stdlib only.

  shown    text a person reads: page text and titles, display fields of the boot data and of the lists, text inside JS bundles
  internal the name is there but is an identifier (a module, an app id, a path, a permission list): not read as text
Exit 0 always; the last line is `FOUND shown=<n> internal=<n>` for run.sh.
"""
import html.parser
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar

FR, CORE_BROWSER = "http://127.0.0.1:8000", "http://localhost:8787"
slug, admin_email, member_email = sys.argv[1:4]
SITE = f"{slug}.localhost"
NAME = re.compile(r"(?<![A-Za-z_.])(?<!X-)(frappe|erpnext)(?![A-Za-z_])(?!\.[a-z_])", re.I)
TRANSLATED = {}  # source text -> translated text, from the site's own Translation rows (the desk shows these through __())
DISPLAY_KEYS = {"title", "label", "app_title", "description", "app_name", "otp_issuer_name", "default_letter_head_content", "message", "subtitle",
                "success_message", "content", "text", "heading", "name", "brand_html", "footer_text", "banner_html", "item_label", "tooltip",
                "subtext", "intro_message", "help_html", "report_name", "footer_powered", "copyright", "address"}
INTERNAL_KEYS = {"app", "module", "key", "logo", "icon", "route", "link_to", "reference_document", "doctype", "link", "url", "href", "src"}
shown, internal, seen = [], [], set()


def named(text):
    """The name in the text a person reads: links are not read, their address is not text."""
    return NAME.search(re.sub(r"https?://[^\s)\]\"'<>]+", "", text))


covered, unread, done_bundles, kept = [], set(), set(), []


def record(who, url, where, text, kind, final=False):  # final: the exact text the server sent, so a Translation row cannot have changed it
    raw, text = text, re.sub(r"\s+", " ", text).strip()
    if kind == "shown" and not final:
        for key in (raw, text, raw.strip()):
            if key in TRANSLATED and not named(TRANSLATED[key]):
                covered.append((who, url, where, text[:160], TRANSLATED[key][:60]))
                return
    if kind == "shown" and KEPT.search(text) and not re.search(r"Frappe(?! (Technologies|Mail|Cloud))", text) and not re.search(r"ERPNext", text):
        kept.append((who, url, where, text[:160]))
        return
    if kind == "shown" and re.search(r"`\)|/\^|\.replace\(|=>", text):  # a mispaired quote in minified code, not text
        kind = "internal"
    if len(text) > 160 and (m := NAME.search(text)):  # long text (a letter head, an email): show the words around the name
        text = "..." + text[max(0, m.start() - 70): m.end() + 70] + "..."
    k = (who, url, where, text[:160])
    if k in seen:
        return
    seen.add(k)
    (shown if kind == "shown" else internal).append((who, url, where, text[:160]))


def opener():
    jar = CookieJar()

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None

    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar)), urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), NoRedirect)


def get(op, url, host_header=True, data=None):
    req = urllib.request.Request(url, data=data, headers={"X-Frappe-Site-Name": SITE} if host_header else {})
    try:
        with op.open(req, timeout=30) as r:
            return r.status, r.read().decode("utf-8", "replace"), r.geturl()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace"), url


def sso(email):
    op, nr = opener()
    _, page, _ = get(op, FR + "/login")
    m = re.search(r'href="(http://localhost:8787/oauth/authorize[^"]*)"', page)
    q = dict(urllib.parse.parse_qsl(m.group(1).replace("&amp;", "&").split("?", 1)[1]))
    q["email"] = email
    try:
        nr.open(urllib.request.Request(CORE_BROWSER + "/oauth/authorize", data=urllib.parse.urlencode(q).encode()), timeout=30)
    except urllib.error.HTTPError as e:  # the 302 to the site's callback
        loc = e.headers.get("Location", "")
    loc = loc.replace(f"http://{SITE}:8000", FR)
    get(op, loc)
    who = json.loads(get(op, FR + "/api/method/frappe.auth.get_logged_user")[1]).get("message")
    assert who == email, f"sign-in as {email} gave {who}"
    return op


class Text(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.out, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1
        a = dict(attrs)
        for k in ("title", "alt", "placeholder", "aria-label", "content", "value"):
            if k in a and a[k] and (k != "content" or a.get("name") in ("title", "description", "author", "generator", "application-name") or (a.get("property") or "").startswith("og:")):
                self.out.append((f"{tag}[{k}]", a[k]))

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip and data.strip():
            self.out.append(("text", data))


def scan_html(who, url, body):
    p = Text()
    p.feed(body)
    for where, t in p.out:
        if named(t):
            record(who, url, where, t, "internal" if where == "meta[content]" and t.strip().lower() == "frappe" else "shown", final=True)
    for c in re.findall(r"<!--(.*?)-->", body, re.S):  # comments in the page source: not read, but they say the name
        if NAME.search(c):
            record(who, url, "html comment", c, "internal")


def scan_json(who, url, obj, path="", key="", rows=False):
    """rows=True: a record read through REST, where every text field is something a person can read."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            scan_json(who, url, v, f"{path}.{k}", k, rows)
    elif isinstance(obj, list):
        for v in obj:
            scan_json(who, url, v, path + "[]", key, rows)
    elif isinstance(obj, str) and named(obj):
        looks_like_id = obj.strip() in ("frappe", "erpnext") or bool(re.search(r"/assets/|^https?://|\.py\b|^[a-z_]+(\.[a-z_]+)+$", obj)) or key in INTERNAL_KEYS or path.startswith(".user.can_") or ".all_read" in path
        record(who, url, path, obj, "shown" if ((key in DISPLAY_KEYS or rows) and key not in INTERNAL_KEYS and not looks_like_id) else "internal")


QUOTES = "\"'`"
OPENERS = "(,[:=+{ ?|&!>\t"


def literals_with_names(body):
    """Every JS string literal that holds the name: from the name, go left to the quote that opens it, right to the one that closes it."""
    out = set()
    for m in re.finditer(r"(?<![A-Za-z_.])(?<!X-)(?:Frappe|ERPNext)(?![A-Za-z_])(?!\.[a-z_])", body):
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
                    out.add((body[pos + 1:r], bool(re.search(r"__\(\s*$", body[max(0, pos - 8):pos]))))  # (text, passed through __())
                    break
    return out


KEPT = re.compile(r"Frappe (Technologies|Mail|Cloud)")


def scan_bundle(who, url, body):
    for s, wrapped in literals_with_names(body):
        if re.search(r"https?://|/assets/|frappe\.[a-z]|frappeframework|github", s) and not re.search(r"\s[A-Za-z]", s):
            record(who, url, "bundle (code or link)", s, "internal")
        elif re.match(r"^[A-Za-z_.]+$", s):
            record(who, url, "bundle (code or link)", s, "internal")
        else:
            # written straight into the front end (not through __()) a translation cannot reach it
            record(who, url, "bundle (text in the interface)" if wrapped else "bundle (text in the interface, NOT translatable)", s, "shown", final=not wrapped)


def boot_of(body):
    i = body.find("frappe.boot = ")
    return json.JSONDecoder().raw_decode(body[i + 14:])[0] if i >= 0 else None


def person_translations(op):
    """What this person's own desk and CRM would apply through __(): the boot data's messages and the CRM's translations for them."""
    TRANSLATED.clear()
    boot = boot_of(get(op, FR + "/desk")[1]) or {}
    TRANSLATED.update(boot.get("__messages") or {})
    st, body, _ = get(op, FR + "/api/method/crm.api.get_translations")
    if st == 200:
        TRANSLATED.update(json.loads(body).get("message") or {})


def crawl(who, op, member):
    person_translations(op)
    for path in ("/desk", "/crm", "/crm/leads/view/list", "/crm/setup", "/login", "/update-password", "/this-page-does-not-exist", "/desk/user/profile", "/app/home", "/me"):
        status, body, _ = get(op, FR + path)
        scan_html(who, f"{path} [{status}]", body)
        if path == "/desk" and (boot := boot_of(body)):
            scan_json(who, "/desk (boot data)", boot)
            for src in sorted(set(re.findall(r'(?:src|href)="(/assets/[^"]+\.(?:js|css))"', body)))[:30]:
                s2, b2, _ = get(op, FR + src)
                if s2 == 200 and src.endswith(".js"):
                    scan_bundle(who, src, b2)
        if path == "/crm" and status == 200 and who not in done_bundles:
            done_bundles.add(who)  # the CRM front end is many lazily loaded files: follow every file the entry file names
            base = "/assets/crm/frontend/assets/"
            todo = set(re.findall(r'/assets/crm/[^"\']+\.js', body)) | set(re.findall(r'/assets/crm/frontend/assets/[A-Za-z0-9_.-]+\.js', get(op, FR + "/assets/crm/frontend/index.html")[1]))
            seen_js = set()
            while todo:
                src = todo.pop()
                if src in seen_js:
                    continue
                seen_js.add(src)
                st, code, _ = get(op, FR + src)
                if st != 200 or code.lstrip()[:1] in "<{":  # not a file of the front end: a name that merely looks like one
                    continue
                scan_bundle(who, src, code)
                todo |= {base + n for n in re.findall(r'[\"\'`/]([A-Za-z0-9_.-]+\.js)[\"\'`]', code)} - seen_js
    lists = ["Workspace", "Module Onboarding", "Onboarding Step", "Navbar Item", "Desktop Icon", "Email Template", "Number Card", "Dashboard", "Help Article",
             "Workspace Sidebar", "Page", "Letter Head", "Print Format", "Notification", "Module Def", "CRM Status Change Log", "CRM Lead Status", "CRM Deal Status",
             "CRM View Settings", "CRM Dashboard", "Custom HTML Block", "Web Page", "Blog Post", "Print Style"]
    for dt in lists:
        q = urllib.parse.urlencode({"fields": '["*"]', "limit_page_length": 1000})
        status, body, _ = get(op, f"{FR}/api/resource/{urllib.parse.quote(dt)}?{q}")
        if status == 200:
            for row in json.loads(body).get("data", []):
                scan_json(who, f"/api/resource/{dt}", row, f".{dt}", rows=True)
        else:
            unread.add((who.split()[0], dt, status))
    for dt in ("Website Settings", "Navbar Settings", "System Settings"):
        status, body, _ = get(op, f"{FR}/api/resource/{urllib.parse.quote(dt)}/{urllib.parse.quote(dt)}")
        if status == 200:
            scan_json(who, f"/api/resource/{dt}", json.loads(body).get("data", {}), f".{dt}")
    st, body, _ = get(op, FR + "/assets/crm/frontend/manifest.webmanifest")  # the name a person sees when they install the CRM as an app on a phone
    if st == 200:
        for k, v in json.loads(body).items():
            if isinstance(v, str) and named(v):
                record(who, "/assets/crm/frontend/manifest.webmanifest", "." + k, v, "shown", final=True)
    # the translations a person's desk asks for, and the app list / apps screen
    for m in ("frappe.translate.get_all_translations", "crm.api.get_translations", "frappe.apps.get_apps", "frappe.desk.desktop.get_workspace_sidebar_items"):
        status, body, _ = get(op, f"{FR}/api/method/{m}")
        if status == 200:
            try:
                scan_json(who, f"/api/method/{m}", json.loads(body).get("message"))
            except ValueError:
                pass


guest, _ = opener()
crawl_guest = ("guest", guest)
admin_op, member_op = sso(admin_email), sso(member_email)
for who, op in (("guest", guest), ("admin-hat " + admin_email, admin_op), ("member-hat " + member_email, member_op)):
    crawl(who, op, who.startswith("member"))

shown_unique = sorted({t for _, u, w, t in shown})  # distinct strings; the same text in two files or for three people counts once
internal_unique = sorted({(u, w, t) for _, u, w, t in internal})
print(f"== where {slug} still shows Frappe or ERPNext to a person ({len(shown)} places, {len(shown_unique)} distinct)")
for who, u, w, t in sorted(shown, key=lambda r: (r[1], r[2])):
    print(f"SHOWN  [{who.split()[0]}] {u} {w} :: {t}")
kept_u = sorted({(u, w, t) for _, u, w, t in kept})
third = [k for k in kept_u if not re.search(r"Technologies", k[2])]
legal = [k for k in kept_u if re.search(r"Technologies", k[2])]
print(f"== kept on purpose: the copyright holder's notice ({len(legal)} distinct)")
for u, w, t in legal:
    print(f"legal  {u} {w} :: {t[:100]}")
print(f"== third-party product names in lists and dialogs, not ours to rename: hide the option or leave it ({len(third)} distinct)")
for u, w, t in third:
    print(f"third  {u} {w} :: {t[:100]}")
cov = sorted({(u, w, t, r) for _, u, w, t, r in covered})
print(f"== names the person's own translations replace when the desk or CRM show them through __() ({len(cov)} distinct; not verified one by one)")
for u, w, t, r in cov:
    print(f"covered {u} {w} :: {t[:80]} -> {r}")
print(f"== the name is also present as an identifier, not read as text ({len(internal)} places, {len(internal_unique)} distinct; first 25)")
for who, u, w, t in internal[:25]:
    print(f"intern [{who.split()[0]}] {u} {w} :: {t[:100]}")
for who, dt, status in sorted(u for u in unread if u[0] != "guest"):
    print(f"note   [{who}] could not read {dt} ({status}): not scanned for that person")
print(f"places: {len(shown)} places show {len(shown_unique)} distinct strings")
print(f"FOUND shown={len(shown_unique)} internal={len(internal_unique)} covered={len(cov)} legal={len(legal)} thirdparty={len(third)}")
