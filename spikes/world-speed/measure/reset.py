"""Questions 4 and 5 on the hub: snapshot a live world, move it on, reset it IN PLACE, and fork its index.

python3 -I measure/reset.py <hub url> <label>

A world here is a hub name (anvil, Ponder) plus its own Neon branch B. Every step is timed, and the world's
fingerprint (chain head, hash, clock, balances; the index's progress, transfers and checkpoint) is read at each point
so that "reads the same as at the snapshot" is a comparison, not a claim. Everything made is removed at the end.
"""

import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from lib import HERE, Hub, Neon, now_ms, stamp, write  # noqa: E402

OPERATOR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
TOKEN = "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6"
HOLDER = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"
EMPTY_ANVIL = ["anvil", "--host", "0.0.0.0", "--port", "8545", "--chain-id", "84532", "--no-request-size-limit"]
USDC_CODE = (HERE.parent.parent / "packages/world/src/parts/chain/test-usdc.hex").read_text().strip()


def word(hex_or_int):
    value = hex_or_int if isinstance(hex_or_int, int) else int(hex_or_int, 16)
    return format(value, "064x")


def text(value):
    data = value.encode().hex()
    return word(len(value)) + data.ljust(((len(data) + 63) // 64) * 64, "0")


def ctor(name, symbol, decimals):
    first = text(name)
    return word(96) + word(96 + len(first) // 2) + word(decimals) + first + text(symbol)


class World:
    def __init__(self, hub, neon, name, log):
        self.hub, self.neon, self.name, self.log = hub, neon, name, log
        self.branch = None
        self.uri = None

    def step(self, what, fn):
        began = now_ms()
        result = fn()
        ms = now_ms() - began
        self.log.append({"step": what, "ms": round(ms, 1), "result": result})
        print(f"  {what}: {ms:.0f} ms")
        return result

    def rpc(self, method, params=None):
        answer, _ = self.hub.rpc(self.name, method, params or [])
        if not isinstance(answer, dict) or "error" in answer:
            raise RuntimeError(f"{method}: {str(answer)[:300]}")
        return answer.get("result")

    def send(self, to, data):
        tx = self.rpc("eth_sendTransaction", [{"from": OPERATOR, **({"to": to} if to else {}), "data": data, "gas": hex(5_000_000)}])
        receipt = self.rpc("eth_getTransactionReceipt", [tx])
        return receipt

    def mint(self, amount):
        return self.send(TOKEN, "0x40c10f19" + word(HOLDER) + word(amount))["status"]

    def sql(self, query):
        status, answer, ms = self.neon.sql(self.branch, query)
        if status != 200:
            raise RuntimeError(f"sql {status}: {str(answer)[:300]}")
        return answer["rows"]

    def chain_print(self):
        head = self.rpc("eth_getBlockByNumber", ["latest", False])
        balance = self.rpc("eth_call", [{"to": TOKEN, "data": "0x70a08231" + word(HOLDER)}, "latest"])
        return {
            "head": int(head["number"], 16),
            "hash": head["hash"],
            "timestamp": int(head["timestamp"], 16),
            "holderUsdc": int(balance, 16) if balance and balance != "0x" else None,
            "operatorNonce": int(self.rpc("eth_getTransactionCount", [OPERATOR, "latest"]), 16),
        }

    def index_print(self):
        rows = self.sql(
            "select (select indexed_block::text from ponder.indexer_progress limit 1) as block,"
            " (select indexed_block_hash from ponder.indexer_progress limit 1) as hash,"
            " (select count(*)::int from ponder.transfers) as transfers,"
            " (select value->>'is_locked' from ponder._ponder_meta where key='app') as locked,"
            " (select value->>'build_id' from ponder._ponder_meta where key='app') as build"
        )
        return rows[0] if rows else None

    def caught_up(self, timeout_s=240):
        """Waits until the index has indexed the chain's head; gives back how long that took."""
        began = now_ms()
        target = self.chain_print()
        last = None
        while now_ms() - began < timeout_s * 1000:
            try:
                last = self.index_print()
                if last and last["block"] == str(target["head"]) and last["hash"] == target["hash"]:
                    return {"ms": round(now_ms() - began), "index": last}
            except RuntimeError as error:
                last = {"error": str(error)[:200]}
            time.sleep(0.5)
        return {"ms": None, "timedOut": True, "index": last, "chain": target}

    def fingerprint(self):
        return {"chain": self.chain_print(), "index": self.index_print()}

    def start_index(self):
        status, started, ms = self.hub.start("index", self.name, enableInternet=True, env={"DATABASE_URL": self.uri, "RPC_URL": self.hub.quiet_url(self.name)})
        ready = None
        began = now_ms()
        while now_ms() - began < 120_000:
            code, _, _ = self.hub.probe("index", self.name, "/ready")
            if code == 200:
                ready = now_ms() - began
                break
            time.sleep(0.5)
        _, metrics, _ = self.hub.probe("index", self.name, "/metrics")
        keep = [line for line in str(metrics).splitlines() if line.startswith(("ponder_indexing_completed_events", "ponder_historical_total_blocks", "ponder_historical_cached_blocks", "ponder_historical_completed_blocks", "ponder_indexing_has_error", "ponder_settings_info", "ponder_sync_block "))]
        return {"status": status, "healthyMs": (started or {}).get("readyMs"), "startCalls": (started or {}).get("startCalls"), "refusals": (started or {}).get("refusals"), "readyAfterHealthyMs": None if ready is None else round(ready), "metrics": keep}


def same(a, b):
    """The fields that must match for a world to read the same; lists those that do not."""
    diffs = []
    for part in ("chain", "index"):
        for key in set((a.get(part) or {})) | set((b.get(part) or {})):
            if key in ("locked",):
                continue
            if (a.get(part) or {}).get(key) != (b.get(part) or {}).get(key):
                diffs.append(f"{part}.{key}: {(a.get(part) or {}).get(key)} != {(b.get(part) or {}).get(key)}")
    return diffs


def restore_branch(neon, branch, source, preserve):
    first = neon.restore(branch, source)
    if first["status"] < 300:
        return first
    second = neon.restore(branch, source, preserve_under_name=preserve)
    second["firstTry"] = first
    return second


def main():
    url, label = sys.argv[1], sys.argv[2]
    hub, neon = Hub(url), Neon()
    log = []
    name = f"{label}-{int(time.time()) % 100000}"
    w = World(hub, neon, name, log)
    fork = World(hub, neon, name + "-f", log)
    made = []
    record = {"claim": "a live world reset in place to a snapshot, and its index forked with its database", "world": name, "at": stamp(), "steps": log}
    try:
        print("setup")
        w.branch, record["branchCreate"] = neon.create_branch(f"ws-{name}", compute=True)
        made.append(w.branch)
        w.uri = neon.connection_uri(w.branch)
        record["chainStart"] = w.step("chain start (seed)", lambda: hub.start("chain", name)[1])
        w.step("deploy test USDC", lambda: w.send(None, "0x" + USDC_CODE + ctor("Test USD Coin", "USDC", 6))["contractAddress"])
        w.step("mint 1 USDC", lambda: w.mint(1_000_000))
        record["freshBackfill"] = w.step("index start: fresh backfill from the seed", w.start_index)
        w.step("index caught up", w.caught_up)

        print("snapshot at P1")
        f1 = w.step("fingerprint P1", w.fingerprint)
        snap_branch, ms = w.step("neon: snapshot branch of B, no compute", lambda: neon.create_branch(f"ws-{name}-s1", parent=w.branch, compute=False))
        made.append(snap_branch)
        snap_id = w.step("anvil: evm_snapshot", lambda: w.rpc("evm_snapshot"))
        dump = w.step("anvil: anvil_dumpState", lambda: w.rpc("anvil_dumpState"))
        log[-1]["result"] = {"bytes": len(dump)}

        print("move on to P2")
        w.step("mint 3 more", lambda: [w.mint(1_000_000) for _ in range(3)])
        w.step("evm_increaseTime 1 day and mine 3", lambda: [w.rpc("evm_increaseTime", [86400]), *[w.rpc("evm_mine") for _ in range(3)]])
        w.step("index caught up", w.caught_up)
        f2 = w.step("fingerprint P2", w.fingerprint)
        record["p2DiffersFromP1"] = same(f1, f2)

        print("reset R1: Ponder stopped, Neon restore, evm_revert, Ponder started")
        r1_began = now_ms()
        w.step("R1 index stop (destroy)", lambda: hub.stop("index", name)[1])
        w.step("R1 neon restore B from snapshot", lambda: restore_branch(neon, w.branch, snap_branch, f"ws-{name}-pre-r1"))
        w.step("R1 first SQL answer after restore", lambda: w.sql("select 1 as one"))
        w.step("R1 anvil: evm_revert", lambda: w.rpc("evm_revert", [snap_id]))
        record["r1IndexStart"] = w.step("R1 index start (resume)", w.start_index)
        w.step("R1 index caught up", w.caught_up)
        record["r1TotalMs"] = round(now_ms() - r1_began)
        f3 = w.step("fingerprint after R1", w.fingerprint)
        record["r1VersusP1"] = same(f1, f3)
        w.step("R1 liveness: mint after reset", lambda: w.mint(5))
        record["r1LivenessIndexed"] = w.step("R1 liveness: indexed", w.caught_up)

        print("reset R2: Neon restore again, anvil_reset + anvil_loadState")
        r2_began = now_ms()
        w.step("R2 index stop (SIGTERM)", lambda: hub.call("POST", "index", name, "term", {})[1])
        w.step("R2 lock after SIGTERM", lambda: w.sql("select value->>'is_locked' as locked from ponder._ponder_meta where key='app'"))
        w.step("R2 neon restore B from snapshot", lambda: restore_branch(neon, w.branch, snap_branch, f"ws-{name}-pre-r2"))
        w.step("R2 anvil: anvil_reset", lambda: w.rpc("anvil_reset", []))
        w.step("R2 anvil: anvil_loadState", lambda: w.rpc("anvil_loadState", [dump]))
        record["r2IndexStart"] = w.step("R2 index start (resume)", w.start_index)
        w.step("R2 index caught up", w.caught_up)
        record["r2TotalMs"] = round(now_ms() - r2_began)
        f4 = w.step("fingerprint after R2", w.fingerprint)
        record["r2VersusP1"] = same(f1, f4)

        print("reset R3: chain container restarted empty, loadState (what Chain.wake does)")
        r3_began = now_ms()
        w.step("R3 index stop (destroy)", lambda: hub.stop("index", name)[1])
        w.step("R3 neon restore B from snapshot", lambda: restore_branch(neon, w.branch, snap_branch, f"ws-{name}-pre-r3"))
        w.step("R3 chain stop", lambda: hub.stop("chain", name)[1])
        w.step("R3 chain start empty", lambda: hub.start("chain", name, entrypoint=["anvil", "--host", "0.0.0.0", "--port", "8545", "--chain-id", "84532", "--no-request-size-limit"])[1])
        w.step("R3 anvil: anvil_loadState", lambda: w.rpc("anvil_loadState", [dump]))
        record["r3IndexStart"] = w.step("R3 index start (resume)", w.start_index)
        w.step("R3 index caught up", w.caught_up)
        record["r3TotalMs"] = round(now_ms() - r3_began)
        f5 = w.step("fingerprint after R3", w.fingerprint)
        record["r3VersusP1"] = same(f1, f5)

        print("Q4: what makes Ponder refuse")
        w.step("mint 2 more and mine (move on)", lambda: [w.mint(7), w.mint(7)])
        w.step("index caught up", w.caught_up)
        w.step("K index killed (destroy), chain reverted to P1 by loadState, database NOT restored", lambda: [hub.stop("index", name)[1], w.rpc("anvil_reset", []), w.rpc("anvil_loadState", [dump])])
        record["refusalIndexStart"] = w.step("K index start against a chain behind its database", w.start_index)
        record["refusalStatus"] = w.step("K index /status and meta", lambda: {"status": hub.probe("index", name, "/status")[1], "ready": hub.probe("index", name, "/ready")[0], "index": w.index_print(), "box": hub.status("index", name)[1]})

        print("Q4: fork the index with the database")
        w.step("restore B to the snapshot again, and start its index", lambda: [hub.stop("index", name)[1], restore_branch(neon, w.branch, snap_branch, f"ws-{name}-pre-k")])
        fork.branch, record["forkBranchCreate"] = w.step("F neon: branch of B with compute (the fork's database)", lambda: neon.create_branch(f"ws-{name}-f", parent=w.branch, compute=True))
        made.append(fork.branch)
        fork.uri = neon.connection_uri(fork.branch)
        w.step("F chain start empty for the fork", lambda: hub.start("chain", fork.name, entrypoint=["anvil", "--host", "0.0.0.0", "--port", "8545", "--chain-id", "84532", "--no-request-size-limit"])[1])
        w.step("F anvil_loadState of P1 into the fork", lambda: fork.rpc("anvil_loadState", [dump]))
        record["forkIndexStart"] = w.step("F fork's index start (resume on the forked database)", fork.start_index)
        w.step("F fork's index caught up", fork.caught_up)
        f6 = w.step("F fingerprint of the fork", fork.fingerprint)
        record["forkVersusP1"] = same(f1, f6)
        w.step("F fork moves on: mint", lambda: fork.mint(9))
        record["forkLiveness"] = w.step("F fork's index indexes it", fork.caught_up)
        record["fingerprints"] = {"P1": f1, "P2": f2, "R1": f3, "R2": f4, "R3": f5, "fork": f6}
    except Exception as error:
        record["error"] = repr(error)[:2000]
        print("error", repr(error)[:500])
    finally:
        cleanup = {}
        for world in (fork.name, name):
            for kind in ("index", "chain"):
                cleanup[f"{world}/{kind}"] = hub.forget(kind, world)[1]
        for branch in neon.branches():
            if branch["name"].startswith(f"ws-{name}") and branch["id"] not in made:
                made.append(branch["id"])
        # Children before parents. A restore with preserve_under_name moves the children to the preserved branch,
        # so delete whatever has no children, again and again, until none of ours is left.
        for _ in range(6):
            ours = [b for b in neon.branches() if b["name"].startswith(f"ws-{name}")]
            if not ours:
                break
            parents = {b.get("parent_id") for b in ours}
            for branch in ours:
                if branch["id"] not in parents:
                    cleanup[branch["id"]] = neon.delete_branch(branch["id"])
        record["cleanup"] = cleanup
        write(f"e5-reset-{label}.json", record)


if __name__ == "__main__":
    main()
