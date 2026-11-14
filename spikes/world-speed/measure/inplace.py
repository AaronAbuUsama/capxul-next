"""Question 5 on a real world made by the platform's world.create: reset it IN PLACE to its world.snapshot.save, with
no deploy, and compare world.show (and the chain and the index) with what they read at the snapshot.

python3 -I measure/inplace.py <world> <snapshot> <world branch id> <snapshot branch id> <step>
  step "move":  the world moves on after the snapshot: a 5 USDC mint to dana's Safe (index), then fingerprint
  step "reset": the reset in place, timed part by part, then world.show and the fingerprint

The door is read from .door-<world> (door.sh writes it); world.show is the command line against the local platform.
"""

import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from lib import HERE, Neon, http, now_ms, stamp, write  # noqa: E402

OPERATOR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
TOKEN = "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6"


def word(value):
    return format(int(value, 16) if isinstance(value, str) else value, "064x")


class Door:
    def __init__(self, world):
        self.base = (HERE / f".door-{world}").read_text().strip()

    def call(self, method, path, body=None, timeout=300):
        return http(method, self.base + path, body, timeout=timeout)

    def rpc(self, method, params=None):
        status, answer, ms = self.call("POST", "/rpc", {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []})
        if not isinstance(answer, dict) or "error" in answer:
            raise RuntimeError(f"{method}: {str(answer)[:300]}")
        return answer.get("result")

    def snapshot_state(self, name):
        import urllib.request

        request = urllib.request.Request(self.base + f"/chain/snapshot/{name}", headers={"User-Agent": "world-speed-spike/1"})
        with urllib.request.urlopen(request, timeout=300) as response:
            return response.read().decode()


def show(world):
    began = now_ms()
    out = subprocess.run([str(HERE / "capxul.sh"), "world", "show", "--world", world], capture_output=True, text=True, check=False)
    return json.loads(out.stdout or "null"), now_ms() - began


def fingerprint(door, neon, branch, dana):
    head = door.rpc("eth_getBlockByNumber", ["latest", False])
    balance = door.rpc("eth_call", [{"to": TOKEN, "data": "0x70a08231" + word(dana)}, "latest"])
    _, rows, _ = neon.sql(branch, "select (select indexed_block::text from ponder.indexer_progress limit 1) as block, (select indexed_block_hash from ponder.indexer_progress limit 1) as hash, (select count(*)::int from ponder.transfers) as transfers, (select count(*)::int from app.events) as events, (select row_to_json(c)::text from app.clock c) as clock")
    return {
        "chain": {"head": int(head["number"], 16), "hash": head["hash"], "timestamp": int(head["timestamp"], 16), "danaUsdc": int(balance, 16)},
        "db": rows["rows"][0] if isinstance(rows, dict) and rows.get("rows") else rows,
    }


def caught_up(door, neon, branch, timeout_s=240):
    began = now_ms()
    while now_ms() - began < timeout_s * 1000:
        head = door.rpc("eth_getBlockByNumber", ["latest", False])
        _, rows, _ = neon.sql(branch, "select indexed_block::text as block, indexed_block_hash as hash from ponder.indexer_progress limit 1")
        row = (rows or {}).get("rows", [None])[0] if isinstance(rows, dict) else None
        if row and row["block"] == str(int(head["number"], 16)) and row["hash"] == head["hash"]:
            return round(now_ms() - began)
        time.sleep(0.5)
    return None


def timed(log, what, fn):
    began = now_ms()
    result = fn()
    ms = round(now_ms() - began, 1)
    log.append({"step": what, "ms": ms, "result": result})
    print(f"  {what}: {ms:.0f} ms")
    return result


def main():
    world, snapshot, branch, snap_branch, step = sys.argv[1:6]
    door, neon = Door(world), Neon()
    viewed, _ = show(world)
    dana = next(p["safe"] for p in viewed["success"]["cast"] if p["person"] == "dana")
    log = []
    record = {"world": world, "snapshot": snapshot, "step": step, "at": stamp(), "steps": log}
    if step == "mark":
        record["fingerprint"] = timed(log, "fingerprint", lambda: fingerprint(door, neon, branch, dana))
        record["show"], record["showMs"] = show(world)
        write(f"e6-inplace-{world}-mark.json", record)
        return
    if step == "move":
        timed(log, "mint 5 USDC to dana's Safe through the door", lambda: door.rpc("eth_sendTransaction", [{"from": OPERATOR, "to": TOKEN, "data": "0x40c10f19" + word(dana) + word(5_000_000)}]))
        timed(log, "index caught up", lambda: caught_up(door, neon, branch))
        record["fingerprint"] = timed(log, "fingerprint", lambda: fingerprint(door, neon, branch, dana))
        record["show"], record["showMs"] = show(world)
        write(f"e6-inplace-{world}-moved.json", record)
        return
    began = now_ms()
    timed(log, "index stop (door POST /index/stop)", lambda: door.call("POST", "/index/stop", {})[1])
    state = timed(log, "chain state of the snapshot from R2 (door GET /chain/snapshot)", lambda: door.snapshot_state(snapshot))
    log[-1]["result"] = {"bytes": len(state)}
    restored = timed(log, "neon restore of the world's branch from the snapshot's branch", lambda: neon.restore(branch, snap_branch, preserve_under_name=f"ws-pre-{world}"))
    timed(log, "first SQL answer after the restore", lambda: neon.sql(branch, "select 1 as one")[0])
    timed(log, "anvil_reset (through the door's /rpc)", lambda: door.rpc("anvil_reset", []))
    timed(log, "anvil_loadState of the snapshot's state", lambda: door.rpc("anvil_loadState", [state]))
    timed(log, "index start (door POST /index/start)", lambda: door.call("POST", "/index/start", {})[1])

    def ready():
        t0 = now_ms()
        while now_ms() - t0 < 240_000:
            _, status, _ = door.call("GET", "/index/status")
            if isinstance(status, dict) and status.get("ready") == 200:
                return {"ms": round(now_ms() - t0), "start": (status.get("starts") or [None])[-1]}
            time.sleep(0.5)
        return None

    timed(log, "index ready (/ready answers 200)", ready)
    timed(log, "index caught up with the chain", lambda: caught_up(door, neon, branch))
    record["resetMs"] = round(now_ms() - began)
    record["restore"] = restored
    record["show"], record["showMs"] = timed(log, "world.show after the reset", lambda: show(world))
    record["fingerprint"] = timed(log, "fingerprint after the reset", lambda: fingerprint(door, neon, branch, dana))
    write(f"e6-inplace-{world}-reset.json", record)


if __name__ == "__main__":
    main()
