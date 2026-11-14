"""Question 4: Ponder's own words when it resumes, and when it refuses. Its log, read through a side port.

python3 -I measure/refusal.py <hub url>

Ponder is started with a wrapped entrypoint: the real `ponder start` with its output to /tmp/p.log, and a one-line
Node server on port 42070 that answers with the log's tail; after Ponder exits the container stays up so the log can
be read. Three starts on one world: a fresh start (backfill), a resume on the same database after the process is
killed, and a start after the chain was put back to an earlier state while the database was not.
"""

import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from lib import Hub, Neon, now_ms, stamp, write  # noqa: E402
from reset import USDC_CODE, World, ctor  # noqa: E402

SERVE_LOG = "require('http').createServer((q,r)=>{let t='';try{t=require('fs').readFileSync('/tmp/p.log','utf8')}catch(e){t='no log yet'};r.end(t.slice(-30000))}).listen(42070,'0.0.0.0')"
WRAPPED = ["sh", "-c", f'node -e "{SERVE_LOG}" & node_modules/.bin/ponder start --schema ponder --port 42069 --hostname 0.0.0.0 > /tmp/p.log 2>&1; echo "PONDER EXITED $?" >> /tmp/p.log; sleep 3600']


def logs(hub, world):
    status, text, _ = hub.call("GET", "index", world, "logs")
    return text if isinstance(text, str) else str(text)


def start_wrapped(w, wait_s):
    began = now_ms()
    hub = w.hub
    # The container answers on 42070 before Ponder does; start it with patience on the main port anyway.
    status, started, _ = hub.call("POST", "index", w.name, "start", {"enableInternet": True, "entrypoint": WRAPPED, "env": {"DATABASE_URL": w.uri, "RPC_URL": hub.quiet_url(w.name)}, "patienceMs": wait_s * 1000})
    ready = None
    t0 = now_ms()
    while now_ms() - t0 < 20_000:
        code, _, _ = hub.probe("index", w.name, "/ready")
        if code == 200:
            ready = round(now_ms() - t0)
            break
        time.sleep(0.5)
    text = logs(hub, w.name)
    return {"ms": round(now_ms() - began), "healthyMs": (started or {}).get("readyMs"), "readyAfterHealthyMs": ready, "log": [line[:400] for line in text.splitlines()][-60:]}


def main():
    hub, neon = Hub(sys.argv[1]), Neon()
    log = []
    name = f"rf-{int(time.time()) % 100000}"
    w = World(hub, neon, name, log)
    record = {"claim": "what Ponder says when it resumes and when it refuses", "at": stamp(), "world": name, "steps": log}
    try:
        w.branch, _ = neon.create_branch(f"ws-{name}", compute=True)
        w.uri = neon.connection_uri(w.branch)
        hub.start("chain", name)
        w.send(None, "0x" + USDC_CODE + ctor("Test USD Coin", "USDC", 6))
        w.mint(1_000_000)
        record["fresh"] = w.step("fresh start (wrapped)", lambda: start_wrapped(w, 90))
        w.step("caught up", w.caught_up)
        dump = w.rpc("anvil_dumpState")
        w.step("move on: two mints", lambda: [w.mint(3), w.mint(3)])
        w.step("caught up", w.caught_up)
        w.step("kill Ponder (destroy)", lambda: hub.stop("index", name)[1])
        record["resume"] = w.step("resume on the same database and chain (wrapped)", lambda: start_wrapped(w, 90))
        w.step("caught up", w.caught_up)
        w.step("kill Ponder; chain back to the earlier state; database left as it is", lambda: [hub.stop("index", name)[1], w.rpc("anvil_reset"), w.rpc("anvil_loadState", [dump])])
        record["refused"] = w.step("start against the chain behind its database (wrapped)", lambda: start_wrapped(w, 60))
        record["refusedIndex"] = w.index_print()
    except Exception as error:
        record["error"] = repr(error)[:1000]
    finally:
        record["cleanup"] = {kind: hub.forget(kind, name)[1] for kind in ("index", "chain")}
        if w.branch:
            record["cleanup"]["branch"] = neon.delete_branch(w.branch)
        record["leftBranches"] = [b["name"] for b in neon.branches() if b["name"].startswith(f"ws-{name}")]
        write("e4-ponder-words.json", record)


if __name__ == "__main__":
    main()
