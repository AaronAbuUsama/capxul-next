"""Question 1: turns the logs of world creates and destroys into spans, one per resource phase.

python3 -I measure/spans.py <out name> <log>...

Alchemy logs each resource's phases with a timestamp (precreate, image resolved, application created, reconcile,
"recreating ... to attach durable object binding", bundle, upload); packages/world logs its own steps. A span runs from
one phase line to the next line of the same resource. Times are seconds after the log's first line.
"""

import json
import re
import sys

sys.path.insert(0, __import__("os").path.dirname(__file__))
from lib import write  # noqa: E402

LINE = re.compile(r"^\[(\d\d):(\d\d):(\d\d)\.(\d\d\d)\] (INFO|ERROR): (.*)$")
PHASES = [
    ("precreate", re.compile(r"\[(\w+)\] Cloudflare (?:Container|Worker) precreate: starting")),
    ("image resolved (context hashed, registry checked)", re.compile(r"\[(\w+)\] Cloudflare Container image: (?:registry cache hit|using pre-pushed)")),
    ("image build", re.compile(r"\[(\w+)\] Cloudflare Container image: building")),
    ("application create call", re.compile(r"\[(\w+)\] Cloudflare Container create: creating application")),
    ("reconcile", re.compile(r"\[(\w+)\] Cloudflare (?:Container|Worker) reconcile: starting")),
    ("recreate to attach the Durable Object", re.compile(r"\[(\w+)\] Cloudflare Container reconcile: recreating")),
    ("bundle", re.compile(r"\[(\w+)\] Cloudflare Worker create: preparing bundle")),
    ("upload", re.compile(r"\[(\w+)\] Cloudflare Worker create: uploading script")),
    ("durable objects put", re.compile(r"\[(\w+)\] Cloudflare Worker put: durable object")),
    ("delete", re.compile(r"\[(\w+)\] Cloudflare (?:Container|Worker) delete: deleting")),
]
WORLD = re.compile(r"world (w-[\w-]+): (.*)")


def seconds(match):
    h, m, s, ms = (int(x) for x in match.group(1, 2, 3, 4))
    return h * 3600 + m * 60 + s + ms / 1000


def parse(path):
    events = []
    first = None
    for raw in open(path, encoding="utf-8", errors="replace"):
        found = LINE.match(raw.rstrip("\n"))
        if not found:
            continue
        t = seconds(found)
        first = t if first is None else first
        text = found.group(6)
        for phase, pattern in PHASES:
            hit = pattern.search(text)
            if hit:
                events.append({"t": round(t - first, 3), "resource": hit.group(1), "phase": phase})
                break
        else:
            if "Refreshing Cloudflare State Store" in text or "using environment variables (CLOUDFLARE" in text:
                events.append({"t": round(t - first, 3), "resource": "state store", "phase": "open (credentials)"})
            elif "Neon: using environment variables" in text:
                events.append({"t": round(t - first, 3), "resource": "Neon", "phase": "provider ready"})
            else:
                hit = WORLD.search(text)
                if hit:
                    events.append({"t": round(t - first, 3), "resource": "world", "phase": hit.group(2)[:90]})
    # Each resource's span runs to its next event; a world step's to the next world step.
    spans = []
    by_resource = {}
    for event in events:
        by_resource.setdefault(event["resource"], []).append(event)
    for resource, items in by_resource.items():
        for here, there in zip(items, items[1:] + [None]):
            spans.append({"resource": resource, "phase": here["phase"], "start": here["t"], "end": None if there is None else there["t"], "s": None if there is None else round(there["t"] - here["t"], 3)})
    return {"log": str(path), "events": events, "spans": sorted(spans, key=lambda s: (s["start"], s["resource"]))}


def main():
    name, logs = sys.argv[1], sys.argv[2:]
    write(name, {"claim": "where a world create's and destroy's time goes, read from the logs' timestamps", "runs": [parse(p) for p in logs]})


if __name__ == "__main__":
    main()
