# Test-only fake of Core's /prepare on :8787. Appends each verified body to $FAKE_OUT. Stopped by test-frappe.sh.
import hashlib, hmac, json, os, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
SECRET = os.environ["SECRET"].encode(); OUT = os.environ["FAKE_OUT"]
class H(BaseHTTPRequestHandler):
    def do_POST(self):
        raw = self.rfile.read(int(self.headers["Content-Length"]))
        ok = hmac.compare_digest(hmac.new(SECRET, raw, hashlib.sha256).hexdigest(), self.headers.get("X-Capxul-Signature", ""))
        if self.path != "/prepare" or not ok: self.send_response(401); self.end_headers(); return
        open(OUT, "a").write(json.dumps(json.loads(raw)) + "\n")
        n = sum(1 for _ in open(OUT)); body = json.dumps({"approval_id": f"apr_fake{n}", "approval_url": f"http://localhost:{os.environ.get('FAKE_PORT', '8787')}/approve/apr_fake{n}"}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
HTTPServer(("0.0.0.0", int(os.environ.get("FAKE_PORT", "8787"))), H).serve_forever()
