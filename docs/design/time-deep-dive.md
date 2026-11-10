# Time: what it takes for a site to believe a world's clock

Written 10 November 2026, for the owner. Research only; nothing was changed or run against a site's database.

Tags on every claim: **[code]** read in the installed code, with `file:line` (paths under `apps/<app>/` in the bench: frappe v16.55.2, erpnext v16.54.0, hrms v16.53.1, crm v16.0.2); **[measured]** by a command shown here; **[spike]** from `spikes/skeleton/`; **[web]** a public source with its URL; **[judgment]** mine.

## 0. Short answer

- Replacing Frappe's "now" function (the current design) is **sound for what people and the books see**: dates on documents, ledger postings, periods, accruals, what is due. It is **not complete**. About 85 places read the machine's clock or the database's clock directly, and about 20 of them decide something (section 2). The design already says so (it "rebinds" some and scans for the rest).
- A fork of Frappe alone **cannot** fix this, because 27 of those places (and the ones that decide stock and payment questions) are in ERPNext, HRMS and CRM, which are separate GPL and AGPL code bases. A fork would be four forks.
- The one part that cannot be made fully right without a fork or a fake clock beneath Python: **database-side time and expiry that lives outside Python** (the `NOW()` in SQL, Redis expiry, the sign-in code library, the job queue library). For a world that is run forward only and where nobody cares about log cleanup, those are harmless. In a world that is **moved into the past or run at a rate** they are not all harmless (section 4).
- Recommendation in section 7: keep option (a), harden it, add a build-failing scan and a month-end test, and **propose the hook upstream (option c) while carrying a tiny patch (b) only if the scan shows it is needed**. A bench per world under libfaketime (d) is the fallback for any world that must be exact.

## 1. What "a site follows a world's clock" has to mean

A **world** is one chain with every company on it and one clock; it can be frozen, stepped, or run faster than real time (`aaron.world-clock`, `books/target/shared/rulings.ts:502`) [code].

| Who looks | What they must see | Matters for the product? |
|---|---|---|
| A person in a document | Today's date, `posting_date`, due dates default to the world's date | **Yes** |
| The books | Ledger entries (GL Entry) dated by the world; Fiscal Year and Accounting Period checks use the world's date; the period a month-end closes | **Yes** |
| HR | Leave accrual, payroll period, "who is on leave today" | **Yes** |
| A scheduled job | A job falls due when the world passes its time, exactly once; a recurring invoice is created on its day | **Yes** |
| Auto Repeat, subscriptions, reminders | Fire on the world's day | **Yes** |
| Emails and notifications | Dated at the world's now; held in a sink, never sent | **Yes** |
| Sessions | Do not expire or live forever because the world moved | **Yes for watchers**; agents use fresh sign-ins |
| The chain | Block time equals the world's time, so a payment's reference date agrees with the ledger | **Yes** (spike B7 checks it) |
| Log timestamps, `creation`/`modified` on log rows | Best if world time (they are, since they call `now()`), harmless if not | No |
| Cache expiry (Redis TTL), file locks, rate limits, how long a PDF took | Must stay on **real** time; faking them breaks them | No, and must **not** follow |
| A person's browser | Shows the real "today" in date pickers | Matters to a watcher; see section 4 |

The rule that falls out [judgment]: **anything that is recorded or decided as a date or a due time follows the world; anything that measures elapsed real time stays real.** Every option below is a way to draw that line.

## 2. How Frappe gets the time today

Counts below are from one command (run in the bench container, non-test code, excluding `patches/`, `tests/`, `.github/`). Fully shown so it can be re-run [measured]:

```bash
cd apps; EX='--include=*.py --exclude-dir=tests --exclude-dir=node_modules --exclude=test_*.py --exclude-dir=patches --exclude-dir=.github'
c(){ grep -rP "$1" $EX $a | wc -l; }          # for a in frappe erpnext hrms crm
c '(?<![\w.])now_datetime\('   c '(?<![\w])(frappe\.utils\.)?nowdate\('   c '(?<![\w.])today\(\)|frappe\.utils\.today\('
c '(?<![\w.])now\(\)|utils\.now\(\)'   c 'getdate\(\)'   c 'get_datetime\(\)'                 # framework reads
c '(datetime|dt)\.now\('  c '(?<![\w])date\.today\('  c '(?<![\w])time\.time\(\)'  c 'utcnow\('      # the host's clock, direct
c '\bNOW\(\)|CURRENT_TIMESTAMP|CURRENT_DATE|CURDATE\(\)|UNIX_TIMESTAMP\(|\bNow\(\)'                  # the database's clock
```

| App | Through the framework (`now_datetime`, `nowdate`, `today`, `now`, `getdate()`, `get_datetime()`) | Host clock direct (Python) | Database clock (SQL) |
|---|---|---|---|
| frappe | 167 | 34 | 24 |
| erpnext | 336 | 5 | 8 |
| hrms | 69 | 2 | 0 |
| crm | 57 | 12 (9 are demo data) | 0 |
| **Total** | **629** | **53** | **32** |

Tests use the framework functions 1,296 more times (`now_datetime|nowdate` only) [measured]; they run on freezegun, not on this seam. The existing note counted "about 700" and the spike counted 86 direct reads with tests included (`FINDINGS.md`, "What still reads the host's time"); the figures agree to within the different filters [judgment]. Patches (one-off migrations) were excluded on purpose; they run once.

### 2.1 Source one: `now_datetime()`, the root of the framework's time

```python
# apps/frappe/frappe/utils/data.py:372
def now_datetime() -> datetime.datetime:
	return datetime.datetime.now(ZoneInfo(get_system_timezone())).replace(tzinfo=None)
# :416 now()      -> now_datetime().strftime(DATETIME_FORMAT)      (this stamps creation and modified)
# :428 nowdate()  -> now_datetime().strftime(DATE_FORMAT);  :433 today() -> nowdate();  :457 nowtime()
# :151 get_datetime(None) -> now_datetime();  :119 getdate(None) -> get_datetime().date()
```

Every framework read funnels into this one line. About 56 non-test files import the name `now_datetime` directly (`from frappe.utils import now_datetime`: frappe 32, erpnext 15, hrms 1, crm 8) [measured, a regex], so changing the module attribute alone would miss them; changing the function's code reaches every binding [judgment].

**An official side door already exists.** `now()` honours `frappe.flags.current_date` (`data.py:418-421`), and HRMS reads it for leave accrual (`leave_policy_assignment.py:166,213,292,410,444`; `leave_allocation.py:359`) [code]. It only affects `now()`, not `nowdate()` or `now_datetime()`, and exists for tests [judgment]. It shows upstream accepts "a flag that stands in for today" in a few places, not as a general clock.

### 2.2 Source two: the host's clock, direct (53 Python reads)

Most are timing (how long a PDF, report or search took: `utils/pdf.py:166`, `report.py:194,216`, `rate_limiter.py:52,96`, `search/sqlite_search.py:259,285`) and must stay real. These **decide something a person or the books would see** [code]:

| Where | What it decides | Follows the world? |
|---|---|---|
| `frappe/sessions.py:377` | Session ends after a fixed `session_end` instant | No (real) |
| `frappe/email/doctype/email_account/email_account.py:972,978` | "Unreplied email" notice window | No |
| `frappe/utils/data.py:406` `get_datetime_in_timezone` | "now" in a named zone | No |
| `frappe/oauth.py:358`, `integrations/.../token_cache.py:78` | Token expiry checks | No, and arguably should not (third parties use real time) |
| `frappe/model/meta.py:509` | "Large table" recency threshold | No; performance only |
| `frappe/utils/scheduler.py:88` | When the scheduler wakes (aligned to the real minute) | No, and must not |
| `erpnext/stock/.../stock_ledger_entry.py:475` | **Stock frozen "up to N days ago"** compares `posting_date` with `date.today()` | No: **books** |
| `erpnext/utilities/bulk_transaction.py:162,165,237` | Bulk-transaction log dates | No |
| `erpnext/support/.../service_level_agreement.py:1198` | SLA time in the user's zone (`utcnow`) | No |
| `hrms/hr/doctype/interview/interview.py:261,268` | Interview reminder window | No |
| `crm/fcrm/doctype/crm_status_change_log/crm_status_change_log.py:54,70,81` | How long a deal sat in each status | No: **a deal log mixing real and world time** |
| `frappe/model/naming.py:297` | Random-looking prefix for "hash" names (`time.time()*10`) | Not needed |

### 2.3 Source three: the database's own clock (32 reads)

- **No `CURRENT_TIMESTAMP` default exists in Frappe's table definitions** (`grep` over `frappe/database` found none) [measured]. `creation`, `modified` and `lastupdate` are all written by Python from `now()` (`model/document.py:1038,2791`, `sessions.py:443`) [code]. So the stamps on records follow the world. Good.
- SQL reads that compare a stored world time with the database's real "now":
  - **Log retention deletes**, `creation < Now() - Interval(days=N)`: Access Log, Activity Log, API Request Log, Deleted Document, Error Log, Scheduled Job Log, Submission Queue, View Log, Notification Log, Route History, Integration Request, Webhook Request Log, **Email Queue** (`email_queue.py:287,296`) and more (`core/doctype/*/…py` the lines are `*_log.py:28-75`).
  - **ERPNext decisions:** purchase invoices on hold released by `release_date <= CURRENT_DATE` (`payment_entry.py:2847`, `accounts/utils.py:1253`); Issues and Opportunities auto-closed after N days (`issue.py:358`, `opportunity.py:738`); `price_list.py:105` `modified=NOW()`; two "inactive" reports.
  - `core/doctype/user/user.py:1383,1398`: users active in the last 72 hours, in SQL.
- ERPNext's own authors already hit the "database date vs app date" problem once: `sales_order_analysis.py:63` has a comment choosing the app's `today` over the database's `CURRENT_DATE` [code].

### 2.4 Source four: the scheduler

```python
# core/doctype/scheduled_job_type/scheduled_job_type.py:90
def is_event_due(self, current_time=None):  return self.get_next_execution() <= (current_time or now_datetime())
# :136  last_execution = get_datetime(self.last_execution or self.creation)   # cold start falls back to creation
# :173,187  db_set("last_execution", now_datetime())
# frappe/utils/scheduler.py:88  sleep_duration(): datetime.datetime.now(UTC) -> sleeps to the next multiple of the tick (default 240 s, scheduled_job_type.py:126)
```

What is due is decided by the framework's now (follows the world). **When** it is asked is the real clock: the scheduler process wakes every 240 real seconds. So at a rate of 4, a daily job gets a chance only about every 16 world minutes, and in a jump nothing asks until the next tick. This is why the design has its own follower that enqueues due jobs at each stop (`devnet.site-follows-world`). Hourly and "All" jobs, and jobs that were already enqueued, run on whatever world time the worker sees when it starts them [code/judgment].

### 2.5 Source five: background jobs, Redis and locks

Jobs hand work to a worker (RQ, a library). RQ stamps `enqueued_at` itself with the real clock; Frappe's own wrapper does not control that. Redis key expiry (`redis_wrapper.py:81`, `ex=expires_in_sec`) is the Redis server's real time. Frappe's file locks and the in-process cache use `time.monotonic()` (`redis_wrapper.py:567,599`) [code]. All of these should stay real; they only misbehave if something **mixes** them with world dates.

### 2.6 Source six: sessions

`sessions.py:371-377`: a session is dead if `now() - last_updated > expiry`, or the fixed `session_end` has passed. Default expiry is 240 hours (`sessions.py:526`). Because `now()` follows the world, **moving the world forward more than 10 days ends every session**; moving it back makes the difference negative, so sessions never expire [code/judgment]. The spike saw the first effect: a session did not survive a clock move (`FINDINGS.md`, "What still reads the host's time") [spike].

### 2.7 Source seven: naming, fiscal years, periods, accruals, email, Auto Repeat

- **Naming series** with `.YYYY.`, `.MM.`, `.DD.` use `today = now_datetime()` (`model/naming.py:349-371`): follows the world [code].
- **Fiscal Year** lookup takes the document's date, not the clock, and `get_fiscal_year(date=None)` falls back to today (`erpnext/accounts/utils.py:65-123`) [code]. **ERPNext creates no next fiscal year by itself**, so a world run past 31 December cannot post until one is made [spike: `FINDINGS.md`, "What the clock does not do"].
- **Accounting Period** refuses closing a period that has not ended with `getdate(self.end_date) > getdate(nowdate())` (`accounting_period.py:47`) [code]: follows the world.
- **Leave accrual** uses `getdate(frappe.flags.current_date) or getdate()` (`leave_policy_assignment.py:166,213,292`): follows the world.
- **Email Queue** `send_after` is computed with `add_days(nowdate(), n)` (`email_queue.py:714-716`); sending is gated on that. The design hands every mail to a sink instead [code].
- **Auto Repeat** is the sharpest edge:

```python
# frappe/automation/doctype/auto_repeat/auto_repeat.py:557-563
current_date = getdate(today())
schedule_date = getdate(doc.next_schedule_date)
if schedule_date == current_date and not doc.disabled:      # equality, not "<="
    doc.create_documents()
```

If the world jumps over the scheduled day, **the document is never made**. Stepping must stop on every day the job could fire. The spike's weekly invoice worked because its advance stopped at every midnight [spike, `clock.py` `advance`].

## 3. Every way to make a site use another clock

### (a) The app replaces the framework's "now" at runtime (current design; the spike did this)

```python
# spikes/skeleton/frappe/capxul/capxul/clock.py:install()  (read, 193 lines)
orig = data.now_datetime
def now_datetime():
    off = offset_ms(); t = orig()
    return t + timedelta(milliseconds=off) if off else t
for mod in list(sys.modules.values()):        # rebinding `from frappe.utils import now_datetime`
    if mod.__dict__.get("now_datetime") is orig: mod.__dict__["now_datetime"] = now_datetime
```

The design's version (`devnet.site-follows-world`, option `code-hook`) replaces the function's code, so no rebinding is needed, and adds rebinding for a few direct reads and a follower that enqueues due jobs.

- **Changes:** one function in memory, in each process, plus rebinding of listed modules. **Covers:** all 629 framework reads. **Misses:** the 53 direct reads except those rebound, and the 32 SQL reads.
- **Upgrade:** breaks if `now_datetime` is renamed, moved, becomes a builtin-bound alias or is cached (`functools.cache`), or if a new module reads `datetime.now()`. You would know only if a test fails **or the scan below** does. Silent new direct reads are the main risk.
- **Many worlds on one machine:** cheap. One bench, offset per world, per site (`capxul-world-clocks.json`; the spike ran `main` and `w2` on one bench) [spike]. One process serves many sites, so the offset must be read from the request's site; a leak between sites in one worker is the bug to test.
- **A mistake shows up as:** a document dated by the real clock while its neighbours are dated by the world, often unnoticed until a month-end. Hence the tests in section 6.
- **Tested by:** the scan, a month-end run, two worlds on one bench.

### (b) A small maintained patch to Frappe itself (a fork that tracks upstream)

```diff
--- a/frappe/utils/data.py
+++ b/frappe/utils/data.py
@@ def now_datetime() -> datetime.datetime:
-	return datetime.datetime.now(ZoneInfo(get_system_timezone())).replace(tzinfo=None)
+	return utcnow().astimezone(ZoneInfo(get_system_timezone())).replace(tzinfo=None)
+
+def utcnow() -> datetime.datetime:
+	"""The one place the framework asks for the real time. A site may name another source."""
+	src = frappe.conf.get("clock_source")           # e.g. "capxul.clock.utcnow"
+	return frappe.get_attr(src)() if src else datetime.datetime.now(datetime.UTC)
```

That is the three-line version (**covers the 629 reads and nothing else**; it is (a) with the seam inside Frappe). The honest version also replaces the Frappe direct reads that decide something (`sessions.py:377`, `email_account.py:972,978`, `data.py:406`, `oauth.py`) by `utcnow()`: roughly 8 lines in 6 files, and the SQL `Now()` reads by a Python value (`add_days(now(), -n)`): about 15 lines in 15 files [judgment, sized from the tables above].

- **Misses:** ERPNext, HRMS and CRM direct reads (19 in Python, 8 SQL), which need their own patches (below), and everything beneath Python.
- **Upgrade:** a patch in `data.py` conflicts only if upstream edits those lines (I did not check the function's history; judgment). Frappe ships about weekly (section 5), so a rebase is weekly and mostly mechanical; the six-file honest version conflicts occasionally.
- **Many worlds on one machine:** same as (a).
- **Mistake shows up as:** a failed rebase (loud), or the clock source missing in a worker (the same as (a)).
- **Tested by:** the same scan, plus a test that the hook is called.

### (c) The same idea proposed upstream as a hook, a fork only until it lands

The same diff as (b), shaped as a documented hook (`clock_source` in `hooks.py`, default the real clock) and a test using it, sent to `frappe/frappe`. If accepted, we carry no patch. If refused or slow, we carry (b). **Cost:** one pull request plus review time. **Risk:** upstream has never discussed it (section 5); it is a request for a feature whose only users are simulators, and Frappe's maintainers choose small, test-covered changes. Chance of acceptance: **unknown; I would guess low to medium** [judgment].

### (d) Faking the clock beneath Python for the bench process (libfaketime)

```bash
# the world's bench, one per world
LD_PRELOAD=/usr/lib/x86_64-linux-gnu/faketime/libfaketime.so.1 \
FAKETIME_TIMESTAMP_FILE=/worlds/w2/clock FAKETIME_NO_CACHE=1 \
bench start        # web, workers, scheduler, socketio all inherit it
# /worlds/w2/clock contains: @2026-03-02 09:00:00      (or: +0 x4 for a rate)
```

[web: <https://raw.githubusercontent.com/wolfcw/libfaketime/master/README>] confirms the file-based runtime change, `x` speed factors, a 10-second default cache (turn off with `FAKETIME_NO_CACHE=1`), no support for static or setuid binaries, and that runtimes using the vDSO can bypass it.

- **Covers:** every Python read, framework and direct, **and** the libraries (RQ, the sign-in code, JWT). **Misses:** MariaDB's and Redis's own clocks, unless they are faked too (separate processes), so SQL `NOW()` and Redis expiry stay real; and `time.monotonic` is faked unless excluded, which can make locks, RQ and gunicorn timeouts misbehave [judgment from the README; untested here].
- **One clock per bench**, so a **bench per world**, and each bench needs its own MariaDB and Redis to be exact (that is option (e)).
- **Upgrade:** nothing in Frappe breaks. A new Python image or a static binary can break the preload silently.
- **Cost:** a bench is about 6 processes and, from the spike, a full site database each; a bench per world is a few hundred MB per world and the sites of one world share it [judgment, not measured].
- **A mistake shows up as:** time stuck, workers hanging, or a job that runs forever (monotonic faked).
- **Tested by:** every test in section 6, plus one that a Redis key and a SQL `NOW()` are read at the world's time.

### (e) Faking it at the container or virtual-machine level

A time namespace (Linux `CLONE_NEWTIME`, kernel 5.6 and later) or a VM with its own clock gives each world a clock for **every** process in it, MariaDB and Redis included. This is the only option that makes everything agree, and it is also the heaviest: a container or VM per world, with its own MariaDB and Redis. Offsets only (a time namespace cannot run faster; a VM can be stepped, with the guest's timers drifting) [judgment]. Sessions, locks and TTLs then all behave as if the world were real, **including expiring when the world jumps**. Upgrades: untouched. Cost: highest per world; a snapshot and restore of a whole world becomes natural. **Not measured.**

### (f) Do not fake time: the world's "time" is only the dates on documents and the order of events

```bash
# a "world day" is an agent's explicit act
capxul doc create "Sales Invoice" --data '{"set_posting_time":1,"posting_date":"2026-03-12", ...}'
capxul jobs run --site acme --as-of 2026-03-12        # runs the due jobs, once, by name
```

- **Covers:** whatever the caller sets; documents carry the right dates; `creation` stays real (the record keeps both). **Misses:** every default date, every job unless triggered, Auto Repeat, naming series, accruals, "today" in reports; and the books cannot prove each date by construction. Many agents would forget one.
- **Upgrade:** very robust. **Cost:** none to run. **A mistake shows up as:** quietly wrong dates. It fails `aaron.world-clock`'s "everything follows the clock" [code, `rulings.ts:502`].

### (g) Other real options

1. **freezegun-style process-wide patching around each request** (the book's rejected option `freezegun`): scans every loaded module at each start and freezes `time.time` and `monotonic`, which Frappe's locks and RQ need real (`devnet/decisions.ts`, `devnet.site-follows-world` "why"). No rate [code].
2. **A Python import hook / `sitecustomize` that replaces the `datetime` class** with one whose `now()` is the world's. Covers the 53 Python direct reads, **only** where the code says `datetime.now()` (not `from datetime import datetime` captured before the hook, not C code). Fragile; I would not choose it [judgment].
3. **Option (a) plus SQL rewriting in the database layer**: wrap `frappe.db.sql` to replace `NOW()`/`CURRENT_DATE` by literals. Covers the 32 SQL reads without editing apps; risk of rewriting a string that is not a call; cheap to test with the scan [judgment].

### Side by side

| | Covers framework reads (629) | Direct Python (53) | SQL (32) | Libraries (RQ, TOTP, JWT) | Rate | Worlds per bench | Upgrade risk |
|---|---|---|---|---|---|---|---|
| a. runtime replace | yes | rebound list only | no | no | yes (ten lines, `FINDINGS.md`) | many | silent new reads |
| b. patch Frappe | yes | Frappe's only | Frappe's only | no | yes | many | weekly rebase |
| c. upstream hook | yes | no | no | no | yes | many | none once merged |
| d. libfaketime | yes | yes | no | yes | yes (`x`) | one | image changes |
| e. container or VM clock | yes | yes | yes | yes | stepping | one | none |
| f. no fake | no | no | no | no | n/a | many | none |

## 4. What can go wrong

Likelihood and badness for the **chosen design (a)** unless stated. L = likely, M = maybe, U = unlikely. Bad: H high, M medium, L low.

| # | Failure | How it happens | Likely | Bad |
|---|---|---|---|---|
| 1 | A document dated with the machine's time inside a world | A new or untracked direct read; or a `from datetime import datetime` imported **after** rebinding (sections 2.2, 3a) | **L** over a year of upgrades | **H** (the books) |
| 2 | Two clocks disagree inside one request | A request reads `now_datetime` (world) and `stock_ledger_entry.py:475` (`date.today()`, real) | M | H (stock freeze) |
| 3 | A job runs twice or never across a jump | Auto Repeat is `==` (section 2.7); a scheduled job's `last_execution` was written in an older world time | **L** if stops are skipped | **H** (missing invoices; the spike hit it) |
| 4 | Time moves while a request is in flight | A world step in the middle of a posting: the request's own cached offset (design: read once per request) keeps it consistent; a job started before the step and finished after sees two times | M | M |
| 5 | Time goes backwards (restore or rewind) | `last_execution` is in the future, jobs wait until the world catches up (the spike added `rewind_jobs`); `creation > now`; naming series and "latest per day" checks | M | M |
| 6 | Sessions and tokens expire or never do | Forward jump > 10 days ends every session; backward jump never expires (section 2.6); JWTs and sign-in codes use real time by design | **L** | L for agents, M for a watcher |
| 7 | A fiscal or payroll period crossed in one jump | No next Fiscal Year exists; Accounting Period or payroll not closed at the boundary; accrual run once for the whole jump instead of per period | **L** | **H** (cannot post past 31 December: spike) |
| 8 | Date-based naming series | The prefix follows the world (`naming.py:349`) but the counter is stored, so a rewound world gets old-dated prefixes with new counters: numbers no longer sort by date; a restore that rewinds the counter table but not the documents could collide (judgment) | M | M |
| 9 | Database timestamps and what reads them | Retention jobs: `creation < Now() - N days`. A world **in the past** deletes its own logs, including Email Queue rows, at once; a world in the future keeps them for ever (section 2.3) | **L** in a past world | M (loses the record of sent mail) |
| 10 | Caches and locks with real-time expiry | Redis TTL and file locks must stay real. Danger only if someone fakes them (options d, g1) or stores a world time with a real TTL | U | M |
| 11 | Emails and notifications with wrong dates | `send_after`, "unreplied", reminders: some real, some world; the design sends all mail to the sink at the world's now | M | L |
| 12 | Reports compare a world date with a real one | SQL `CURRENT_DATE` in the two "inactive" reports and the hold-release query (`accounts/utils.py:1253`): a past world sees every hold as released | M | M |
| 13 | The chain's block time and the site's time drift | The chain is set by `anvil_setTime`; the site by an offset; a restart of anvil forgets it (the spike re-syncs on every transaction). A real chain cannot be moved | M | **H** (payment reference dates) |
| 14 | A watcher's browser shows the real "today" | Date pickers use the page's clock: `FINDINGS.md` says the desk's default dates come from the browser. A person typing a date gets the real default | **L** | M (an operator posts a real-dated entry by hand) |
| 15 | An upgrade silently adds a direct read | Frappe ships about weekly; the CRM and ERPNext add `datetime.now()` in new code | **L** | H (this is failure 1) |
| 16 | A leak between sites or worlds in one process | One worker serves several sites; an offset kept in a module global instead of per site | M | **H** (two companies on two clocks mix) |
| 17 | The follower is down | Nobody enqueues due jobs; at a rate, the real scheduler's 240 s tick is a world hour | M | M |

**What the spike actually hit:** (i) a cookie session did not survive a clock move; (ii) a job that never ran falls back to `creation` (real time), so a world moved back needed `rewind_jobs`; (iii) the scheduler's work had to run inline (`enqueue` forced to `now=True` while stepping) or a worker would run it at the wrong time; (iv) the world cannot pass 31 December (no fiscal year); (v) the coordinator's re-run failed the B7 clock checks.

### What the failed re-run does and does not tell us [spike]

The output (`verify-epsilon.out`, lines 86 to 101): three advances of 10, 10 and 9 days from 2 March should land on 31 March; the world ended on **21 March**, the payments were dated 2, **2**, 12, 21, and the first advance printed `(stops per site, scheduled jobs run)` **with no numbers** after 34 s, while the second printed `(11, 0)`. The first advance's result could not be read, which matches the unstaged diff in the working tree: the CLI now reads the answer after a `CAPXUL_RESULT:` marker, where it used to take the last line (`core/src/clock.ts`, `frappe/bin/bench-exec.sh`, `capxul/emit.py`).

- **Does tell us:** the check script and the CLI's way of reading a site's answer were fragile; one advance was lost from the world's total. A failed parse is a silent failure, so the world and the books could end up on different days if the CLI does not stop on it [judgment].
- **Does not tell us:** that Frappe's `now_datetime` replacement is wrong. The sites did move (the 9-day step ran 5,107 jobs over 10 stops, and the ledger dates follow the world on the days that did run). I cannot say from the file alone that parse failure is the whole cause; the re-run after the fix is the evidence [judgment]. The first test of the clock is therefore still open, and the design's note that the clock has "no evidence" (`devnet.site-follows-world`, "Assumption, not yet tested") still stands for a rate and for the design's follower, which the spike did not build (it stepped and ran jobs inline).

## 5. The fork question, answered directly

**What "a fork that stays in line with upstream" means for Frappe.** Frappe publishes about weekly: v16.55.0, .55.1, .55.2 on 3 and 4 November, v16.54.0 on 27 October, v16.53.0 on 22 October, v16.52.0 on 14 October, with v15 released on the same days [web: <https://github.com/frappe/frappe/releases>]. A carried patch is a branch `capxul/version-16` on top of `version-16`; each weekly release is a rebase (or a merge) of that branch. A **three-line** patch in `data.py` almost never conflicts; the patch set only costs you when it touches busy files. The "honest" patch (section 3b) touches roughly 15 files and conflicts a few times a year [judgment]. You also have to build your own bench image from the fork, and keep ERPNext's and HRMS's pins in step [judgment].

**Is patching Frappe alone enough?** No. By the counts: 19 of the 53 Python direct reads and 8 of the 32 SQL reads are outside Frappe, and the ones that decide **books** decisions are in ERPNext (`stock_ledger_entry.py:475`, `payment_entry.py:2847`, `accounts/utils.py:1253`, `issue.py:358`, `opportunity.py:738`), HRMS (`interview.py`) and CRM (`crm_status_change_log.py`). So a fork means **ERPNext, HRMS and CRM patches too**, roughly 10 lines in 6 files; or one rule: "no pinned app may read the host's clock", enforced by the scan, with the few that matter rebound by (a).

**Licences** [code, from the installed `LICENSE` or `license.txt`]:

| App | Licence | What forking obliges |
|---|---|---|
| Frappe | MIT | Keep the notice; nothing else. A fork may stay private. |
| ERPNext | GPL-3.0 | A modified copy that is **conveyed** to others must be offered under GPL-3.0 with source. Hosting it for customers without giving them the code is not "conveying" under GPL (the network clause is the AGPL's). Our patch would be GPL, kept in a repository we can publish. |
| HRMS | GPL-3.0 | Same as ERPNext. |
| CRM | **AGPL-3.0** | Users **interacting over a network** with a modified version must be offered its source. A hosted patched CRM obliges publishing the patch (the modified source) to those users. Published patch, not the whole product, and only if the product's other code is a separate work [judgment, not legal advice; ask a lawyer before shipping a fork of CRM]. |

Important: **option (a) is not a "modification" in the licence sense if it lives in our own app** [judgment]; patching someone else's file is. That favours (a) and (c) for CRM.

**Has upstream discussed a pluggable clock?** I found nothing. A GitHub issue search for fake or mock time in `frappe/frappe` returned only #45571 ("test_account_unlock no longer depends on wall-clock time", a test change) [web: <https://github.com/frappe/frappe/issues?q=is%3Aissue%20now_datetime%20mock%20OR%20freeze%20OR%20%22system%20time%22>]. The forum has users asking to change the date: moving the server clock, or "modify `getdate`" ([Is it posible to change the date?](https://discuss.frappe.io/t/is-it-posible-to-change-the-date/95492), [ERP next time change](https://discuss.frappe.io/t/erp-next-time-change/14765)), and a maintainer's answer to backdating being maintenance mode and pausing the scheduler ([Temporal change of date](https://discuss.frappe.io/t/temporal-change-of-date-to-create-documents-in-a-previous-year-docker-container/142996)). Nobody proposes a hook. Frappe's tests use freezegun (`frappe/tests/classes/context_managers.py:28-43`) [code]. I did not search every issue by hand; a search is not proof of absence.

## 6. How to prove time is right

Whichever option is chosen. "Spike" marks what exists.

| # | Test | Passes when | Exists? |
|---|---|---|---|
| T1 | **Scan: no new direct clock read.** Run the section 2 command per pinned app; compare with a committed list of every direct read, each marked *rebound*, *real on purpose*, or *world*; fail the build on any difference | the list equals the scan | **No** (the design promises "B3 scans"; none is built) |
| T2 | **Month-end run:** a world from 1 to 31 March, documents posted on each day, the month closed; every GL Entry date equals the world's date on the day it was made; no `creation` on a document is dated off by more than a day | zero mismatches | **Partly:** spike B7 (it checks ledger dates and chain block time; it did not pass the independent run) |
| T3 | **Jump across a fiscal year** with the next year made first; Auto Repeat, accrual and period close happen once per due period | exact counts | No (spike says it cannot pass 31 December) |
| T4 | **Restore to the past:** save at day 20, run to day 30, restore; jobs are neither lost nor doubled; naming series continue | no duplicate names; one invoice per Auto Repeat date | **Partly:** spike B9 restored in place; no job counts |
| T5 | **Two worlds, two dates, one bench:** the same request to both returns each its own date; under load, from one worker | no mixing | **Partly:** spike B9 (`w2` and `main`) |
| T6 | **Past-world retention:** a world three months behind real time keeps its Error Log and Email Queue rows after the daily jobs | rows remain | No |
| T7 | **Every scheduled job once per due period** across a 60-day jump at a rate of 1, 4 and 60 | each job's run count equals the number of due periods | **Partly:** a weekly Auto Repeat (spike) |
| T8 | **Session test:** a person signed in survives a 1-day step, and a 30-day step ends the session cleanly with a clear message | as stated | **Partly:** spike noticed the failure only |
| T9 | **Chain and site agree**: the block time of a payment equals the ledger date | equal | Yes (B7, part of the failed run) |
| T10 | **Upgrade rehearsal:** on every new Frappe, ERPNext, HRMS or CRM release in the pin, run T1 to T3 before the pin moves | green | No |

## 7. Recommendation

1. **Keep (a), and treat it as unproven until T1, T2 and T5 pass.** The mechanism is sound for the 629 framework reads, for sessions, naming, periods, accruals and Auto Repeat (all go through `now_datetime`). The independent re-run's failure is most plausibly the harness, not the idea (section 4), but it is not proof.
2. **First thing to do:** build T1 (the scan) and commit the list of the 85 direct reads with a label each. It costs a day, tells us exactly what (a) leaves open, and is the same safety net a fork would need.
3. **Fix by (a) the ~12 that decide things people or the books see:** `stock_ledger_entry.py:475`, the SLA, bulk transaction, interview reminder, the CRM status log, `email_account.py:972,978`, and the three ERPNext SQL date reads. Replace the SQL `Now()` retention deletes with a switch: **do not run the log-retention jobs in a world** (a world is recorded elsewhere) [judgment].
4. **In parallel, propose (c) upstream** (an issue first, with the diff). It costs little and costs nothing if refused. **Do not fork yet.** If upstream refuses and T1 starts to fail on every release, carry (b), Frappe only, as three lines.
5. **Fallback:** if an owner needs a world to be exact (including SQL and sessions), run it in its own container with a time namespace or libfaketime (d or e). That is a product tier ("exact world"), not the default, because it costs a bench, MariaDB and Redis per world.
6. **The part that cannot be made fully right without a fork or a fake clock beneath Python:** time in the database and in libraries (SQL `NOW()`, Redis expiry, RQ's `enqueued_at`, the sign-in code and tokens). With (a) these stay on real time and some of them are wrong in a past or fast world (failures 6, 9, 12). Fixing them by editing apps is a fork of four apps; fixing them by faking the clock beneath all processes is option (e).

**What would change my mind:** (1) T1 shows new direct reads on **most** weekly releases, so keep patching; then fork Frappe (b) and push ERPNext's few lines upstream as bug fixes ("use the app's `today`", as `sales_order_analysis.py:63` already does); (2) T2 fails with the harness fixed, which means (a) is not enough; (3) an owner needs exact sessions or log retention in a fast world, so go to (e); (4) CRM's AGPL makes any patch to it unacceptable: keep CRM on (a) only.
