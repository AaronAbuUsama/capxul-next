"""Q5: what a warp costs a site. Core's world.clock.warp calls `capxul.core_api.warp` on every company site of the
world through the door (packages/core src/site-ops/world.ts): the site steps through 01:00 of every day between and
runs what fell due at each stop, inline, and the last site writes the world's clock on the bench. Here: one site, as
its API user over HTTP through web (gunicorn's timeout is 120 s, src/bench.ts), each warp continuing from the last.
    warp.py <site> <days> [<days>...]"""
import sys
import time

from lib import call, emit, ok, saved_credential

site, spans = sys.argv[1], [int(d) for d in sys.argv[2:]]
auth = saved_credential(site)
DAY = 86_400_000
now, _ = ok(site, "GET", "/api/method/capxul.clock.now")
start = round(time.time() * 1000) + now["message"]["offset_ms"]
results, at = [], start
for days in spans:
    status, body, ms = call(site, "POST", "/api/method/capxul.core_api.warp",
                            {"from_ms": at, "to_ms": at + days * DAY, "frozen": True, "write": True}, auth, timeout=1800)
    msg = body.get("message") if isinstance(body, dict) else None
    results.append({"days": days, "status": status, "ms": ms, "stops": (msg or {}).get("stops"),
                    "jobs_run": (msg or {}).get("jobs"),
                    "error": None if status < 300 else str(body)[:300]})
    if status < 300:
        at += days * DAY
after, _ = ok(site, "GET", "/api/method/capxul.clock.now")
emit({"question": "Q5 warp on one site (capxul.core_api.warp over HTTP)", "site": site, "warps": results,
      "clock_after": after["message"]})
