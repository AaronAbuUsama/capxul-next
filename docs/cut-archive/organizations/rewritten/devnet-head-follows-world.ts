// The decision devnet.head-follows-world as it stood before stage 3 rewrote it as devnet.site-follows-world (a head became every company's hosted site).
// Kept intact: nothing is deleted (cut.principle). Imports as the file had them.

export const decision_devnet_head_follows_world = defineDecision({
  id: "devnet.head-follows-world",
  title: "A head follows its world's clock through the Capxul app's hooks, no fork",
  question:
    "aaron.world-clock: a connected Frappe head follows the world's clock. Frappe, ERPNext, Frappe HR and Frappe CRM " +
    "read time through Frappe's now_datetime (about 700 calls outside tests, with Frappe's now, nowdate, today, " +
    "getdate() and get_datetime(), which call it); 88 modules of those apps and the WhatsApp app import that function " +
    "by name (develop, 8 November 2026); Frappe's scheduler enqueues a Scheduled Job Type once its next execution is " +
    "not after now_datetime(); its Email Queue sends every head email over the site's own SMTP account; and a few " +
    "modules read the host's clock directly. How does the Capxul app make a head's now, its jobs and its mail the " +
    "world's, on a devnet and across a network, without forking Frappe?",
  options: [
    {
      label: "code-hook",
      text:
        "When its site config names a world (`capxul_world`: the protocol's address and a follower grant, or a devnet's " +
        "handoff file), the Capxul app does five things (docs/design/time.md 7.5). (1) It replaces the code of " +
        "frappe.utils.data.now_datetime, so every module that imported it reads the world's now in the site's zone, by " +
        "the protocol's formula from the clock event cached in Redis (read once per request or job, else at a " +
        "context's first read; with none cached a request answers 503). The module making the replacement is imported " +
        "in every process through the app's before_request, before_job and override_doctype_class (Scheduled Job Type) " +
        "hooks, since Frappe outside developer mode reads hooks from its cache and never imports hooks.py itself. (2) " +
        "The modules whose own host-clock reads decide something (the CRM's deal status log, ERPNext's stock freeze by " +
        "days, its service-level agreement's user time and bulk-transaction log, Frappe HR's interview reminder, " +
        "Frappe's unreplied-email notice and session end) get their datetime and date names rebound to world-clock " +
        "stand-ins; reads that protect or measure stay real; B3 scans the pinned apps so each direct read is rebound " +
        "or named real. (3) `bench --site <site> capxul follow` joins as `head:<site>`, writes each event to the cache, " +
        "enqueues the Scheduled Job Types due at each stop and waits for them, acknowledging with its next " +
        "daily-or-slower job as its next due (devnet.head-warp-stops), and between stops enqueues the due ones every " +
        "world minute, since Frappe's scheduler wakes every 240 real seconds; is_event_due and the job's id keep each " +
        "run to one. (4) Its override_email_send hook hands every email the Email Queue sends to the supervisor " +
        "(`POST /v1/mail`, on the follower grant), which keeps it in the mail sink at the world's now; nothing reaches " +
        "SMTP. (5) Off a world the clock part is not installed; on staging the mail hook sends only to " +
        "MAIL_ALLOWED_RECIPIENTS and raises for any other address.",
    },
    { label: "freezegun", text: "Start freezegun's freeze_time at the world's now around every request and job." },
    { label: "fork", text: "Patch frappe/utils/data.py in a Capxul fork of Frappe." },
  ],
  chosen: "code-hook",
  why:
    "Replacing one function's code reaches every binding of it, the imports by name included, so one seam moves most " +
    "of the head's dates, and aaron.erp-on-capxul asks for no fork. Rebinding the module attribute alone would miss " +
    "every module that imported the name first. Frappe's own tests move time with freezegun " +
    "(frappe/tests/classes/context_managers.py), but freezegun scans every loaded module on each start and freezes " +
    "time.time and the monotonic clock, which Frappe's Redis locks, RQ and its scheduler heartbeat need real, and it " +
    "has no rate; the rebinding in (2) is freezegun's technique kept to the few modules that decide on the host's " +
    "clock. A patch applied only in hooks.py would leave a worker or the scheduler on the host's clock, because Frappe " +
    "reads app hooks from its cache (frappe/__init__.py get_hooks) and imports a hook's own module only when it calls " +
    "it. One cache read per request or job is the head's RequestTime: no network call per date. Waiting for the due " +
    "jobs at a stop lets a warp see a head's daily work on its day, and the follower's world-minute enqueue keeps a " +
    "head's faster jobs on their cadence at any rate. A head's own email (ERPNext's and Frappe HR's notifications, " +
    "its auto email reports) would otherwise leave the world over SMTP, dated at the world's now; the CRM's own " +
    "conversations never go through the head (contacts.conversations-head-sync). A real bench in a shared world " +
    "follows over HTTPS with a follower grant, its offset measured as any remote follower's. The stand-in head " +
    "already follows (devnet.head-stand-in). For component frappe-app's owner: its text should say this.",
  source: WORLD_CLOCK(
    "frappe@1a7ea577 utils/data.py:373, scheduler.py:44, __init__.py:1050, model/document.py:170, email_queue.py:248; direct reads listed in docs/design/time.md 7.5",
  ),
  affects: [component_frappe_app, integration_mail, table_mail_messages, component_devnet, environment_devnet, environment_shared_world],
});

