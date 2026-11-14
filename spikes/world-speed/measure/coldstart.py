"""Question 3: a world as a Durable Object name on the hub, plus a Neon branch. Nothing is deployed per world.

python3 -I measure/coldstart.py <hub url> <mode label> <count> [--parallel]

For each world: its Neon branch (with compute) forked from the empty default branch, anvil started from the seed,
Ponder started against the branch and the hub's quiet chain path (a fresh backfill from the seed), alto started
against the chain with its two keys funded. Timed separately and from the first request to the moment all three
answer. Every branch is deleted and every container stopped at the end, also on failure.
"""

import sys
import threading
import time

sys.path.insert(0, __import__("os").path.dirname(__file__))
from lib import Hub, Neon, now_ms, stamp, write  # noqa: E402

KEY9 = "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720"
KEY10 = "0xBcd4042DE499D14e55001CcbB24a551F3b954096"
ALTO = {
    "ALTO_ENTRYPOINTS": "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    "ALTO_EXECUTOR_PRIVATE_KEYS": "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6",
    "ALTO_UTILITY_PRIVATE_KEY": "0xf214f2b2cd398c806f84e317254e0f0b801d0643303237d97a22a48e01628897",
    "ALTO_PORT": "4337",
    "ALTO_SAFE_MODE": "false",
    "ALTO_BLOCK_TIME": "2000",
    "ALTO_LOG_LEVEL": "info",
    "ALTO_PUBLIC_CLIENT_LOG_LEVEL": "error",
    "ALTO_WALLET_CLIENT_LOG_LEVEL": "error",
}


def wait_ready(hub, world, timeout_s=240):
    began = now_ms()
    while now_ms() - began < timeout_s * 1000:
        status, _, _ = hub.probe("index", world, "/ready")
        if status == 200:
            return now_ms() - began
        time.sleep(0.5)
    return None


def one_world(hub, neon, label, world, out, instance=None):
    record = {"world": world, "began": stamp()}
    branch = None
    t0 = now_ms()
    try:
        # The branch and the chain do not depend on each other: start both at once, as a deploy would.
        made = {}

        def make_branch():
            made["branch"] = neon.create_branch(f"ws-{world}", compute=True)

        maker = threading.Thread(target=make_branch)
        maker.start()
        status, chain, ms = hub.start("chain", world)
        record["chain"] = {"status": status, "clientMs": ms, **(chain if isinstance(chain, dict) else {"answer": chain})}
        record["chainReadyAtMs"] = now_ms() - t0
        maker.join()
        branch, branch_ms = made["branch"]
        record["branch"] = branch_ms
        record["branchReadyAtMs"] = now_ms() - t0
        uri = neon.connection_uri(branch)
        # Ponder and alto start side by side once the chain answers.
        results = {}

        def index():
            status, started, ms = hub.start("index", world, enableInternet=True, env={"DATABASE_URL": uri, "RPC_URL": hub.quiet_url(world)}, **({"instance": instance} if instance else {}))
            results["index"] = {"status": status, "clientMs": ms, **(started if isinstance(started, dict) else {"answer": started})}
            results["indexHealthyAtMs"] = now_ms() - t0
            results["indexReadyAfterHealthyMs"] = wait_ready(hub, world)
            results["indexReadyAtMs"] = now_ms() - t0
            _, metrics, _ = hub.probe("index", world, "/metrics")
            results["indexMetrics"] = [line for line in str(metrics).splitlines() if line.startswith("ponder_") and ("duration" in line or "seconds" in line or "total" in line)][:200]

        def bundler():
            hub.rpc(world, "anvil_setBalance", [KEY9, hex(10**21)])
            hub.rpc(world, "anvil_setBalance", [KEY10, hex(10**21)])
            status, started, ms = hub.start("bundler", world, enableInternet=True, env={**ALTO, "ALTO_RPC_URL": hub.quiet_url(world)})
            results["bundler"] = {"status": status, "clientMs": ms, **(started if isinstance(started, dict) else {"answer": started})}
            results["bundlerReadyAtMs"] = now_ms() - t0

        threads = [threading.Thread(target=index), threading.Thread(target=bundler)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        record.update(results)
        record["worldAnswersAtMs"] = now_ms() - t0
        status, head, _ = hub.call("POST", "chain", world, "port/", {"jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": []})
        record["head"] = head
    except Exception as error:  # a spike: keep whatever was measured
        record["error"] = repr(error)
    finally:
        stopped = {}
        for kind in ("bundler", "index", "chain"):
            status, answer, ms = hub.forget(kind, world)
            stopped[kind] = {"status": status, "answer": answer, "ms": ms}
        record["stopped"] = stopped
        if branch:
            record["branchDeleted"] = neon.delete_branch(branch)
        else:
            # The thread may have made it after a failure elsewhere.
            for b in neon.branches():
                if b["name"] == f"ws-{world}":
                    record["branchDeleted"] = neon.delete_branch(b["id"])
    out.append(record)


def main():
    url, label, count = sys.argv[1], sys.argv[2], int(sys.argv[3])
    parallel = "--parallel" in sys.argv
    instance = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--instance=")), None)
    hub, neon = Hub(url), Neon()
    worlds = [f"{label}-{int(time.time()) % 100000}-{i}" for i in range(count)]
    out = []
    began = now_ms()
    if parallel:
        threads = [threading.Thread(target=one_world, args=(hub, neon, label, w, out, instance)) for w in worlds]
        [t.start() for t in threads]
        [t.join() for t in threads]
    else:
        for w in worlds:
            one_world(hub, neon, label, w, out, instance)
    write(f"e3-coldstart-{label}{'-parallel' if parallel else ''}.json", {
        "claim": "a world as Durable Object names on one hub plus a Neon branch: time until chain, index and bundler answer",
        "hub": label,
        "parallel": parallel,
        "instance": instance,
        "at": stamp(),
        "totalMs": now_ms() - began,
        "worlds": sorted(out, key=lambda r: r["world"]),
        "summary": [{k: r.get(k) for k in ("world", "chainReadyAtMs", "branchReadyAtMs", "indexHealthyAtMs", "indexReadyAtMs", "bundlerReadyAtMs", "worldAnswersAtMs", "error")} | {"chainRefusals": (r.get("chain") or {}).get("refusals"), "indexRefusals": (r.get("index") or {}).get("refusals"), "bundlerRefusals": (r.get("bundler") or {}).get("refusals")} for r in sorted(out, key=lambda r: r["world"])],
    })


if __name__ == "__main__":
    main()
