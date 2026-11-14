"""What every measuring script shares: the hub's API, Neon's API, a stopwatch and the record writer.

No key or connection string is ever printed or written: Neon's and Cloudflare's keys are added by the session's
network proxy, the hub's token is read from .env.hub, and a branch's connection string lives only in memory.
"""

import json
import os
import pathlib
import time
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent.parent
RECORDS = HERE / "records"
NEON = "https://console.neon.tech/api/v2"
PROJECT = "twilight-sunset-49306398"  # the worlds' Neon project (stage "platform" of CapxulWorld)
MAIN = "br-polished-fire-zanlyaz6"  # its empty default branch, which every world's branch forks


def now_ms():
    return time.time() * 1000


def http(method, url, body=None, headers=None, timeout=300):
    data = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
    request = urllib.request.Request(url, data=data, method=method, headers={"Accept": "application/json", "Content-Type": "application/json", "User-Agent": "world-speed-spike/1", **(headers or {})})
    began = now_ms()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            text = response.read().decode()
            status = response.status
    except urllib.error.HTTPError as error:
        text = error.read().decode()
        status = error.code
    ms = now_ms() - began
    try:
        parsed = json.loads(text) if text else None
    except ValueError:
        parsed = text
    return status, parsed, ms


class Hub:
    def __init__(self, url):
        self.base = url.rstrip("/") + "/" + (HERE / ".env.hub").read_text().strip()

    def call(self, method, kind, world, action, body=None, timeout=300):
        return http(method, f"{self.base}/{kind}/{world}/{action}", body, timeout=timeout)

    def start(self, kind, world, **options):
        return self.call("POST", kind, world, "start", options)

    def stop(self, kind, world):
        return self.call("POST", kind, world, "stop", {})

    def forget(self, kind, world):
        return self.call("POST", kind, world, "forget", {})

    def status(self, kind, world):
        return self.call("GET", kind, world, "status")

    def probe(self, kind, world, path):
        return self.call("GET", kind, world, "port" + path)

    def rpc(self, world, method, params=None, timeout=300):
        status, answer, ms = self.call("POST", "chain", world, "port/", {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []}, timeout=timeout)
        return answer, ms

    def quiet_url(self, world):
        return f"{self.base}/chain/{world}/quiet"


class Neon:
    def __init__(self, project=PROJECT):
        self.project = project

    def api(self, method, path, body=None):
        return http(method, f"{NEON}/projects/{self.project}{path}", body)

    def wait_operations(self, operations, timeout_s=180):
        """Waits until every operation Neon started has finished; gives back how long that took."""
        began = now_ms()
        pending = [op["id"] for op in operations or []]
        while pending and now_ms() - began < timeout_s * 1000:
            still = []
            for op in pending:
                _, answer, _ = self.api("GET", f"/operations/{op}")
                state = answer["operation"]["status"]
                if state not in ("finished", "skipped", "cancelled", "failed", "error"):
                    still.append(op)
            pending = still
            if pending:
                time.sleep(0.25)
        return now_ms() - began

    def create_branch(self, name, parent=MAIN, compute=True, expires_at=None):
        body = {"branch": {"name": name, "parent_id": parent, **({"expires_at": expires_at} if expires_at else {})}}
        if compute:
            body["endpoints"] = [{"type": "read_write"}]
        status, answer, ms = self.api("POST", "/branches", body)
        if status >= 300:
            raise RuntimeError(f"branch create {status}: {answer}")
        waited = self.wait_operations(answer.get("operations"))
        return answer["branch"]["id"], {"apiMs": ms, "operationsMs": waited}

    def connection_uri(self, branch):
        _, answer, _ = self.api("GET", f"/connection_uri?branch_id={branch}&database_name=neondb&role_name=neondb_owner")
        return answer["uri"]

    def delete_branch(self, branch):
        status, answer, ms = self.api("DELETE", f"/branches/{branch}")
        waited = self.wait_operations((answer or {}).get("operations")) if status < 300 else 0
        return {"status": status, "apiMs": ms, "operationsMs": waited}

    def restore(self, branch, source, preserve_under_name=None, source_lsn=None):
        body = {"source_branch_id": source}
        if preserve_under_name:
            body["preserve_under_name"] = preserve_under_name
        if source_lsn:
            body["source_lsn"] = source_lsn
        status, answer, ms = self.api("POST", f"/branches/{branch}/restore", body)
        waited = self.wait_operations((answer or {}).get("operations")) if status < 300 else 0
        return {"status": status, "apiMs": ms, "operationsMs": waited, "answer": answer if status >= 300 else None}

    def branches(self):
        _, answer, _ = self.api("GET", "/branches")
        return answer["branches"]

    def sql(self, branch, query, params=None):
        """One statement over Neon's HTTPS SQL endpoint, as packages/world does; the connection string stays here."""
        uri = self.connection_uri(branch)
        host = uri.split("@", 1)[1].split("/", 1)[0]
        return http("POST", f"https://{host}/sql", {"query": query, "params": params or []}, headers={"Neon-Connection-String": uri})


def write(name, record):
    RECORDS.mkdir(exist_ok=True)
    path = RECORDS / name
    path.write_text(json.dumps(record, indent=2) + "\n")
    print(f"wrote {path.relative_to(HERE)}")
    return path


def stamp():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
