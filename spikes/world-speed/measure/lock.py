"""Question 4: does a database copied from a RUNNING Ponder make the next Ponder wait for its lock?

python3 -I measure/lock.py <hub url>

Ponder 0.18 marks its schema locked and writes a heartbeat every 10 s; a new Ponder on a schema whose lock is held
and whose heartbeat is under 25 s old waits out the 25 s (dist/esm/database/index.js). A branch made while Ponder runs
copies that lock. L1: fork the database while Ponder runs, start a Ponder on the fork at once. L2: stop Ponder with
SIGTERM first (it then clears the lock), fork, start at once. Same chain state for both (anvil_dumpState then
anvil_loadState into a fresh anvil).
"""

import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from lib import Hub, Neon, now_ms, stamp, write  # noqa: E402
from reset import EMPTY_ANVIL, USDC_CODE, World, ctor  # noqa: E402


def main():
    hub, neon = Hub(sys.argv[1]), Neon()
    log = []
    name = f"lk-{int(time.time()) % 100000}"
    w = World(hub, neon, name, log)
    l1 = World(hub, neon, name + "-l1", log)
    l2 = World(hub, neon, name + "-l2", log)
    record = {"claim": "a database copied from a running Ponder makes the next Ponder wait out the old lock", "at": stamp(), "world": name, "steps": log}
    try:
        w.branch, _ = neon.create_branch(f"ws-{name}", compute=True)
        w.uri = neon.connection_uri(w.branch)
        hub.start("chain", name)
        w.send(None, "0x" + USDC_CODE + ctor("Test USD Coin", "USDC", 6))
        w.mint(1_000_000)
        w.step("index start (fresh)", w.start_index)
        w.step("caught up", w.caught_up)
        for fork, how in ((l1, "live"), (l2, "after SIGTERM")):
            if how == "after SIGTERM":
                w.step("SIGTERM the source's Ponder", lambda: hub.call("POST", "index", name, "term", {})[1])
            dump = w.rpc("anvil_dumpState")
            began = now_ms()
            meta = w.step(f"{how}: the lock as copied", lambda: w.sql("select value->>'is_locked' as locked, ((extract(epoch from now())*1000)::bigint - (value->>'heartbeat_at')::bigint) as heartbeat_age_ms from ponder._ponder_meta where key='app'"))
            fork.branch, _ = w.step(f"{how}: fork the database", lambda: neon.create_branch(f"ws-{fork.name}", parent=w.branch, compute=True))
            fork.uri = neon.connection_uri(fork.branch)
            w.step(f"{how}: fork's chain", lambda: [hub.start("chain", fork.name, entrypoint=EMPTY_ANVIL)[0], fork.rpc("anvil_loadState", [dump])])
            started = w.step(f"{how}: fork's index start", fork.start_index)
            w.step(f"{how}: fork's index caught up", fork.caught_up)
            record[how] = {"lockAsCopied": meta, "start": started, "fromForkToCaughtUpMs": round(now_ms() - began), "fork": fork.fingerprint()}
    except Exception as error:
        record["error"] = repr(error)[:1000]
    finally:
        cleanup = {}
        for world in (l1.name, l2.name, name):
            for kind in ("index", "chain"):
                cleanup[f"{world}/{kind}"] = hub.forget(kind, world)[1]
        for _ in range(6):
            ours = [b for b in neon.branches() if b["name"].startswith(f"ws-{name}")]
            if not ours:
                break
            parents = {b.get("parent_id") for b in ours}
            for branch in ours:
                if branch["id"] not in parents:
                    cleanup[branch["id"]] = neon.delete_branch(branch["id"])
        record["cleanup"] = cleanup
        record["leftBranches"] = [b["name"] for b in neon.branches() if b["name"].startswith(f"ws-{name}")]
        write("e4-lock.json", record)


if __name__ == "__main__":
    main()
