"""What a per-world Hyperdrive configuration costs, if Core keeps one per world while the containers are shared.

python3 -I measure/hyperdrive.py <count>

Each round: a Neon branch with compute, a Hyperdrive configuration in front of it (query cache off, as
packages/world's), then both deleted. The connection string goes only to Cloudflare's API, never to the output.
"""

import sys
import time
import urllib.parse

sys.path.insert(0, __import__("os").path.dirname(__file__))
from lib import Neon, http, now_ms, stamp, write  # noqa: E402

CF = "https://api.cloudflare.com/client/v4"


def main():
    count = int(sys.argv[1])
    _, accounts, _ = http("GET", f"{CF}/accounts?per_page=5")
    account = accounts["result"][0]["id"]
    neon = Neon()
    rounds = []
    for i in range(count):
        row = {"round": i}
        branch = config = None
        try:
            branch, row["branch"] = neon.create_branch(f"ws-hd-{int(time.time()) % 100000}-{i}", compute=True)
            uri = urllib.parse.urlparse(neon.connection_uri(branch))
            origin = {"host": uri.hostname, "port": uri.port or 5432, "database": uri.path.lstrip("/"), "user": uri.username, "password": urllib.parse.unquote(uri.password or ""), "scheme": "postgres"}
            status, answer, ms = http("POST", f"{CF}/accounts/{account}/hyperdrive/configs", {"name": f"ws-hd-{i}-{int(time.time())}", "origin": origin, "caching": {"disabled": True}})
            row["hyperdriveCreate"] = {"status": status, "ms": round(ms), "errors": None if status < 300 else answer.get("errors")}
            config = (answer.get("result") or {}).get("id") if isinstance(answer, dict) else None
        except Exception as error:
            row["error"] = repr(error)[:300]
        finally:
            if config:
                status, _, ms = http("DELETE", f"{CF}/accounts/{account}/hyperdrive/configs/{config}")
                row["hyperdriveDelete"] = {"status": status, "ms": round(ms)}
            if branch:
                row["branchDelete"] = neon.delete_branch(branch)
        rounds.append(row)
        print(row.get("hyperdriveCreate"), row.get("hyperdriveDelete"))
    write("e3-hyperdrive.json", {"claim": "the cost of one Hyperdrive configuration per world", "at": stamp(), "rounds": rounds})


if __name__ == "__main__":
    main()
