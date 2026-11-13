// The code half of the drift check: which lines of `docker diff` are code replaced by hand.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as Arr from "effect/Array";
import { codeChanges } from "../src/code-drift.ts";

test("a changed file under the door, the apps or the environment counts", () => {
  const lines = [
    "C /opt",
    "C /opt/door",
    "C /opt/door/door.py",
    "C /home/frappe/frappe-bench/apps/capxul/capxul",
    "A /home/frappe/frappe-bench/apps/capxul/capxul/hooks_extra.py",
    "D /home/frappe/frappe-bench/env/lib/python3.12/site-packages/frappe.pth",
  ];
  assert.deepEqual(codeChanges(Arr.join(lines, "\n")), [
    "C /opt/door/door.py",
    "A /home/frappe/frappe-bench/apps/capxul/capxul/hooks_extra.py",
    "D /home/frappe/frappe-bench/env/lib/python3.12/site-packages/frappe.pth",
  ]);
});

test("Python's caches, data and logs do not count, nor do directories", () => {
  const lines = [
    "C /home/frappe/frappe-bench/apps/capxul/capxul/__pycache__",
    "A /home/frappe/frappe-bench/apps/capxul/capxul/__pycache__/clock.cpython-312.pyc",
    "A /home/frappe/frappe-bench/env/lib/python3.12/site-packages/x.pyc",
    "C /home/frappe/frappe-bench/logs/web.log",
    "C /home/frappe/frappe-bench/sites/acme-r1.worlds.abuusama.dev/site_config.json",
    "C /tmp/x",
    "",
  ];
  assert.deepEqual(codeChanges(Arr.join(lines, "\n")), []);
});
