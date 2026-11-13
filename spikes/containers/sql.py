"""Runs one SQL statement on a world's database over Neon's HTTPS SQL endpoint. Usage: sql.py <stage> "<sql>"
The connection string is read from the stage's local alchemy state and is never printed."""
import json, sys, glob, urllib.request, urllib.parse, time
stage, query = sys.argv[1], sys.argv[2]
uri = None
for f in glob.glob(f".alchemy/state/CapxulSpikeContainers/{stage}/*.json"):
    # the resource's own attributes; a world's state also carries the borrowed project's string under props, which is not it
    uri = uri or (json.load(open(f)).get("attr") or {}).get("connectionUri")
if not uri: sys.exit(f"no connection string in state for stage {stage}")
host = urllib.parse.urlparse(uri).hostname
req = urllib.request.Request(f"https://{host}/sql", data=json.dumps({"query": query, "params": []}).encode(),
    headers={"Neon-Connection-String": uri, "Content-Type": "application/json"})
t = time.time()
try:
    with urllib.request.urlopen(req, timeout=60) as r: body = json.load(r)
    print(f"{(time.time()-t)*1000:.0f} ms", body.get("command"), body.get("rows"))
except urllib.error.HTTPError as e:
    print(f"{(time.time()-t)*1000:.0f} ms HTTP", e.code, e.read().decode()[:300])
