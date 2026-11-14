"""Question 6: does a chain snapshot carry the world's clock? What time does the next block get after a reset?

python3 -I measure/clock.py <hub url>

anvil started from the seed; its clock moved to a world time W (as world.create's mineStart and world.clock.warp do:
evm_setNextBlockTimestamp then evm_mine); a snapshot (evm_snapshot and anvil_dumpState); 20 s of host time; then the
timestamp of a newly mined block after each kind of reset, against W, the snapshot's head and host time.
"""

import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from lib import Hub, now_ms, stamp, write  # noqa: E402

EMPTY = ["anvil", "--host", "0.0.0.0", "--port", "8545", "--chain-id", "84532", "--no-request-size-limit"]


def main():
    hub = Hub(sys.argv[1])
    name = f"clk-{int(time.time()) % 100000}"
    out = {"claim": "what time a block mined after a snapshot or reset gets, against the world clock", "at": stamp(), "world": name, "observations": []}

    def rpc(method, params=None, world=name):
        answer, _ = hub.rpc(world, method, params or [])
        if "error" in answer:
            raise RuntimeError(f"{method}: {answer['error']}")
        return answer.get("result")

    def head(world=name):
        block = rpc("eth_getBlockByNumber", ["latest", False], world)
        return {"number": int(block["number"], 16), "timestamp": int(block["timestamp"], 16)}

    def note(what, world=name):
        h = head(world)
        host = int(time.time())
        row = {"what": what, **h, "host": host, "headMinusHost": h["timestamp"] - host}
        out["observations"].append(row)
        print(row)
        return h

    try:
        hub.start("chain", name)
        seed = note("seed head")
        world_time = int(time.time()) - 30 * 86400  # a world clock 30 days behind host time
        rpc("evm_setNextBlockTimestamp", [world_time])
        rpc("evm_mine")
        note(f"after mineStart at world time {world_time} (host - 30 days)")
        rpc("evm_mine")
        note("one more evm_mine right after")
        snap = rpc("evm_snapshot")
        dump = rpc("anvil_dumpState")
        snap_head = note("snapshot taken here")
        time.sleep(20)
        rpc("evm_mine")
        note("evm_mine 20 s after the snapshot, no reset")
        rpc("evm_revert", [snap])
        note("after evm_revert")
        rpc("evm_mine")
        note("evm_mine after evm_revert")
        rpc("anvil_reset")
        rpc("anvil_loadState", [dump])
        note("after anvil_reset + anvil_loadState")
        rpc("evm_mine")
        note("evm_mine after anvil_reset + anvil_loadState")
        fresh = name + "-r"
        hub.start("chain", fresh, entrypoint=EMPTY)
        rpc("anvil_loadState", [dump], fresh)
        note("new anvil, empty, after anvil_loadState", fresh)
        rpc("evm_mine", [], fresh)
        note("evm_mine on the new anvil after anvil_loadState", fresh)
        out["worldTime"] = world_time
        out["seed"] = seed
        out["snapshotHead"] = snap_head
    except Exception as error:
        out["error"] = repr(error)
    finally:
        out["cleanup"] = [hub.forget("chain", w)[1] for w in (name, name + "-r")]
        write("e6-clock.json", out)


if __name__ == "__main__":
    main()
