"""Ready company copies (roadmap 4.8): a run's founded companies stop running Frappe's setup wizard on the run's path.

Every company a run founds reaches the door with the same name and wizard inputs; only its site's label differs. So
the bench keeps a **company template** for each app fingerprint and set of wizard inputs, `co-<app>-<inputs>`: `<app>`
the bench's app fingerprint (templates.app_version) and `<inputs>` the first 8 hex of a SHA-256 of the company's name,
currency, country and fiscal year (capxul/setup.py, run_wizard). It is a copy of the bench's blank (blank.py) with the
wizard and every app's `after_migrate` hooks run (blank.WIZARD_SCRIPT), kept as a template's one site, `company`, and
warm in a pool of DOOR_COMPANY_POOL_SIZE ready copies (pool.py). No world makes, claims or sweeps one.

- **Made off the run's path.** A template is made in the background once the bench is quiet (pool.wait_quiet: no
  `POST /sites`, claim or restore for DOOR_REFILL_QUIET_S) and BENCH_LOCK is free, which it holds while the wizard
  runs, as a blank does.
- **Names learnt, never configured.** Each `POST /sites` records its company's name with the time it was asked
  (`<REGISTRY>/companies.json`). The first company of a name falls back to the blank and asks for its template; at the
  door's start (tidy) every name asked in the last KEEP_S is kept warm, and a `co-` template of other apps, or unused
  for KEEP_S, is removed with its pool.
- **A company's site from it** (`POST /sites`, sites.build): a ready copy taken from the pool (a rename), or copied
  from the template on the request's path with the pool empty (about 5 s); its own encryption key when nothing is
  encrypted yet; then one bench process joins the world, makes Core's API user and turns the scheduler on
  (blank.JOIN_SCRIPT). Its steps are the blueprint's `site.make.take` and `site.make.join` (`Pipeline.siteMake`); a
  fallback is a `site.make.fell_back` step with its reason (the blueprint's MakeFallback), and `made_from` is
  {template, how, fell_back}: `how` a SiteOrigin, `fell_back` the MakeFallback reason or null.
"""

import hashlib
import json
import os
import shutil
import threading
import time

import blank
import db
import pool
import templates
from sites import (BENCH, BENCH_LOCK, FAST, REGISTRY, Refused, drop_database, earlier_steps, fallback_step, read_entry,
                   site_lock, update_entry)

LABEL = "company"
KEEP_S = 7 * 24 * 3600  # a name asked, a template unused: kept 7 days
RETRY_S = blank.RETRY_S  # after a failed make, before another is tried
IDLE_POLL_S = blank.IDLE_POLL_S
ASKED = f"{REGISTRY}/companies.json"
PREFIX = templates.COMPANY  # "co-": the door's own company templates
TAKE, JOIN = "site.make.take", "site.make.join"  # the blueprint's Pipeline.siteMake spans
_cond, _asked_lock = threading.Condition(), threading.Lock()
_state = {}  # template -> {making, made_ms, error, failed_at}


def inputs(company, fiscal_year=None):
    """What the setup wizard is given for a company: its name, currency, country and fiscal year (this year, the
    host's, when none is given)."""
    return {"company": company, "currency": blank.CURRENCY, "country": blank.COUNTRY,
            "fiscal_year": fiscal_year if fiscal_year is not None else time.gmtime().tm_year}


def key(app, given):
    """The company template of apps `app` (a fingerprint) and wizard inputs `given`: `co-<app>-<inputs, 8 hex>`."""
    text = "|".join(str(given[k]) for k in ("company", "currency", "country", "fiscal_year"))
    return f"{PREFIX}{app}-{hashlib.sha256(text.encode()).hexdigest()[:8]}"


def name(company):
    """The company template of the bench's apps as they are and the company's wizard inputs this year."""
    return key(templates.app_version(), inputs(company))


def usable(template):
    return bool(templates.template_sites(template))


def asked():
    """The company names `POST /sites` was asked for, each with when it was last asked (Unix seconds)."""
    try:
        with open(ASKED) as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return {}


def _write_asked(names):
    os.makedirs(REGISTRY, exist_ok=True)
    with open(f"{ASKED}.tmp", "w") as f:
        json.dump(names, f)
    os.replace(f"{ASKED}.tmp", ASKED)


def note_asked(company):
    """Called on every `POST /sites`: the company's name, asked now."""
    with _asked_lock:
        names = asked()
        names[company] = int(time.time())
        _write_asked(names)


def state():
    """For `GET /templates`: each company template being made, made or failed, and the names asked."""
    with _cond:
        return {"pool_size": pool.company_pool_size(), "asked": asked(),
                "templates": {t: {**s, "usable": usable(t)} for t, s in _state.items()}}


def tidy():
    """At the door's start: names not asked for KEEP_S forgotten; `co-` templates of other apps, or unused for KEEP_S,
    removed with their pools; a template build a stopped door left removed; every name still asked kept warm."""
    now, app = int(time.time()), templates.app_version()
    with _asked_lock:
        names = {n: at for n, at in asked().items() if now - at < KEEP_S}
        _write_asked(names)
    for template in templates.names():
        if not template.startswith(PREFIX):
            continue
        used = _used(template)
        if template.split("-")[1] != app:
            why = f"the bench's apps are now {app}"
        elif used is not None and now - used >= KEEP_S:
            why = f"unused for {KEEP_S} s"
        else:
            continue
        templates.drop_template(template)
        print(f"door: company template {template} removed: {why}", flush=True)
    sites_dir = f"{BENCH}/sites"
    for folder in os.listdir(sites_dir) if os.path.isdir(sites_dir) else []:
        if folder.startswith(templates.COMPANY) and folder.endswith(".invalid"):
            drop_database(folder)
            shutil.rmtree(f"{sites_dir}/{folder}", ignore_errors=True)
    for company in names:
        make_site_template_soon(inputs(company))


def _used(template):
    """When the template was last copied from (its `used` file); None when it never was, as one this door did not make."""
    try:
        with open(f"{templates.TEMPLATES}/{template}/used") as f:
            return int(f.read().strip())
    except (FileNotFoundError, ValueError):
        return None


def make_site_template_soon(given):
    """Starts making the company template of these inputs in the background unless it is whole (then its pool is
    topped up), being made, or failed less than RETRY_S ago."""
    template = key(templates.app_version(), given)
    with _cond:
        if usable(template):
            pool.refill_soon(template)
            return
        st = _state.setdefault(template, {"making": False, "made_ms": None, "error": None, "failed_at": None})
        if st["making"] or (st["failed_at"] and time.time() - st["failed_at"] < RETRY_S):
            return
        st["making"] = True
    threading.Thread(target=_make_when_quiet, args=(given, template), daemon=True).start()


def _make_when_quiet(given, template):
    made = False
    try:
        if not blank._wait_for_one():
            raise Refused(503, "no-blank", f"no blank of these apps ({templates.app_version()}) to make it from")
        while True:  # the run's own sites and the bench's long commands go first
            pool.wait_quiet()
            if BENCH_LOCK.acquire(blocking=False):
                break
            time.sleep(IDLE_POLL_S)
        try:
            if not usable(template):
                _make(given, template)
            made = True
        finally:
            BENCH_LOCK.release()
    except Exception as e:  # noqa: BLE001 -- a template that could not be made says why; companies use the blank
        detail = e.detail if isinstance(e, Refused) else repr(e)
        with _cond:
            _state[template].update(error=detail[-600:], failed_at=time.time())
        print(f"door: company template {template} failed: {detail[-300:]}", flush=True)
    finally:
        with _cond:
            _state[template]["making"] = False
            _cond.notify_all()
    if made:
        pool.refill_soon(template)


def _make(given, template):
    """The template: a copy of the blank in a site folder no request can name (`.invalid`), the wizard run on it, then
    moved under the registry as the template's one site. BENCH_LOCK is held by the caller."""
    site, t0, steps, source = f"{template}.invalid", time.monotonic(), [], blank.name()
    folder, making = f"{BENCH}/sites/{site}", f"{templates.TEMPLATES}/{template}{templates.MAKING}"
    templates.remove_making(making)
    try:
        s0 = time.monotonic()
        with templates.template_lock(source):
            metas = templates.template_sites(source)
            if not metas:
                raise Refused(503, "no-blank", f"blank {source} was removed")
            pool.copy_site(metas[0]["db"], metas[0]["folder"], folder)
        steps.append({"step": "copied from the blank", "ms": db.ms_since(s0)})
        s0 = time.monotonic()
        steps.append({"step": "own encryption key" if blank.own_key(folder) else "blank's encryption key kept",
                      "ms": db.ms_since(s0)})
        steps.extend(blank.run_script(site, (blank.WIZARD_SCRIPT,), company=given["company"]))
        conf = db.site_config(folder)
        home = f"{making}/{LABEL}"
        os.makedirs(home, exist_ok=True)
        meta = {"template": template, "label": LABEL, "company": given["company"], "inputs": given,
                "db": conf["db_name"], "made_from": source, "made_by": "door", "made_at": int(time.time()),
                "ms": db.ms_since(t0), "steps": steps}
        templates.write_meta(home, meta)
        os.rename(folder, f"{home}/site")
        db.drop_user(conf.get("db_user") or conf["db_name"])  # never served: copies get users of their own
        with templates.template_lock(template):
            os.rename(making, f"{templates.TEMPLATES}/{template}")
            templates.mark_used(template)
    except BaseException:
        drop_database(site)
        shutil.rmtree(folder, ignore_errors=True)
        templates.remove_making(making)
        raise
    with _cond:
        _state[template].update(made_ms=db.ms_since(t0), error=None, failed_at=None)
    print(f"door: company template {template} made for {given['company']!r} in {db.ms_since(t0)} ms", flush=True)


def join(site, world, api_key, secret):
    """One bench process that joins the copy in `sites/<site>` to the world: the world's clock, Core's API user with
    the world's key and secret, the scheduler (blank.JOIN_SCRIPT). Answers its steps."""
    return blank.run_script(site, (blank.JOIN_SCRIPT,), world=world, key=api_key, secret=secret)


def make(site, world, company, api_key, secret):
    """Makes the company's site from its template; False, having done nothing, when there is none to make it from."""
    template = name(company)
    if not usable(template):
        return False
    update_entry(site, made_from={"template": template})
    steps, t0, dest = earlier_steps(site), time.monotonic(), f"{BENCH}/sites/{site}"
    fell = None
    with site_lock(site), FAST:
        if (read_entry(site) or {}).get("state") != "creating":
            return True  # removed while it waited: nothing to make
        try:
            s0 = time.monotonic()
            if pool.take(template, LABEL, dest):
                how = "company pool"
            else:
                with templates.template_lock(template):
                    metas = templates.template_sites(template)
                    if not metas:
                        update_entry(site, made_from=None)
                        return False
                    fell = "company pool empty"
                    steps.append(fallback_step(site, fell))
                    pool.copy_site(metas[0]["db"], metas[0]["folder"], dest)
                how = "company copy"
            own = blank.own_key(dest)
            steps.append({"step": TAKE, "ms": db.ms_since(s0), "how": how, "own_key": own})
            # The join's own steps, each marked as the blueprint's site.make.join span.
            steps.extend({**each, "span": JOIN} for each in join(site, world, api_key, secret))
            update_entry(site, state="ready", steps=steps, ms=db.ms_since(t0),
                         made_from={"template": template, "how": how, "fell_back": fell})
            _mark_used(template)
            print(f"door: {site} made from {template} ({how}) in {db.ms_since(t0)} ms", flush=True)
        except Exception as e:  # noqa: BLE001 -- a site that could not be made says why; DELETE removes it
            detail = e.detail if isinstance(e, Refused) else repr(e)
            update_entry(site, state="failed", steps=steps, error=detail[-600:])
            print(f"door: {site} from {template} failed: {detail[-300:]}", flush=True)
    pool.refill_soon(template)  # once the bench is quiet (pool.py)
    return True


def _mark_used(template):
    try:
        templates.mark_used(template)
    except FileNotFoundError:  # removed since (tidy, or a person): the copy taken is whole all the same
        pass
