"""Lists (and with --delete, removes) this stack's image repositories in Cloudflare's managed registry.
Only repositories whose name starts with capxulspikecontainers- are ever touched. No credential is printed."""
import json, sys, urllib.request, base64
acc = json.load(urllib.request.urlopen(urllib.request.Request("https://api.cloudflare.com/client/v4/accounts?per_page=5", headers={"Authorization": "Bearer proxy-injected"}), timeout=30))["result"][0]["id"]
PREFIX = "capxulspikecontainers-"
def api(method, url, body=None, headers=None):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={"Content-Type": "application/json", "Authorization": "Bearer proxy-injected", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, e.read(), dict(e.headers)
st, body, _ = api("POST", f"https://api.cloudflare.com/client/v4/accounts/{acc}/containers/registries/registry.cloudflare.com/credentials",
    {"expiration_minutes": 5, "permissions": ["pull", "push"]})
cred = json.loads(body)["result"]
auth = {"Authorization": "Basic " + base64.b64encode(f"{cred.get('username','v1')}:{cred['password']}".encode()).decode()}
def reg(method, path, headers=None):
    req = urllib.request.Request(f"https://registry.cloudflare.com{path}", method=method, headers={**auth, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, e.read(), dict(e.headers)
st, body, _ = reg("GET", "/v2/_catalog?tags=true")
cat = json.loads(body)
repos = cat.get("repositories", [])
mine = [r for r in repos if (r["name"] if isinstance(r, dict) else r).split("/")[-1].startswith(PREFIX)]
print(f"registry: {len(repos)} repositories, {len(mine)} of this stack")
for r in mine:
    name = r["name"] if isinstance(r, dict) else r
    tags = r.get("tags") if isinstance(r, dict) else None
    print("  ", name.split("/")[-1], tags)
    if "--delete" in sys.argv:
        if tags is None:
            st, body, _ = reg("GET", f"/v2/{name}/tags/list"); tags = json.loads(body).get("tags") or []
        for tag in tags:
            st, _, h = reg("HEAD", f"/v2/{name}/manifests/{tag}", {"Accept": "application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json"})
            digest = h.get("Docker-Content-Digest") or h.get("docker-content-digest")
            st2, b2, _ = reg("DELETE", f"/v2/{name}/manifests/{tag}")
            print("     delete tag", tag, "->", st2, (b2[:120] if st2 >= 300 else ""))
if "--delete" in sys.argv and mine:
    st, body, _ = reg("PUT", "/v2/gc/layers")
    print("garbage collect ->", st, body[:200])
