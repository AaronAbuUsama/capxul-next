"""Long calls as jobs (jobs.py), through the real door over HTTP on this machine, without a bench: a call that asks
with `Prefer: respond-async` is answered within the door's wait, 202 while it runs, and its poll answers as the call
would have; a call that does not ask is answered when done, as before."""

import hashlib
import hmac
import http.client
import json
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch

import door_env  # noqa: F401 -- sets the door's environment before its modules load
import door
import jobs
from sites import KEY, Refused


def token(world, quota=2):
    body = f"v1.{world}.{quota}.{int(time.time()) + 600}"
    return f"{body}.{hmac.new(KEY, body.encode(), hashlib.sha256).hexdigest()}"


class JobsOverHttpTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), door.Door)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.port = cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def call(self, method, path, world="wa", body=None, prefer=True):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        headers = {"X-Capxul-Site-Token": token(world), "Content-Type": "application/json"}
        if prefer:
            headers["Prefer"] = "respond-async"
        t0 = time.monotonic()
        connection.request(method, path, body=json.dumps(body or {}).encode() if method == "POST" else None,
                           headers=headers)
        response = connection.getresponse()
        answer = json.loads(response.read() or b"{}")
        connection.close()
        return response.status, answer, time.monotonic() - t0

    def routes(self, work):
        return patch.dict(door.FAST_ROUTES, {("POST", "/world/claim"): work})

    def test_a_slow_call_that_asks_is_answered_202_then_its_poll_answers_as_the_call_would(self):
        def slow(c, body):
            time.sleep(1.0)
            return {"world": c["world"], "sites": [{"site": "northwind-wa.pool.test"}], "ms": 1000}

        with self.routes(slow), patch.object(jobs, "WAIT_S", 0.2):
            status, answer, took = self.call("POST", "/world/claim", body={"template": "t"})
            self.assertEqual(status, 202)
            self.assertEqual(answer["state"], "running")
            self.assertLess(took, 0.8)
            polls = []
            while status == 202:
                status, answer, took = self.call("GET", f"/world/jobs/{answer.get('job') or polls[-1]}")
                polls.append(answer.get("job"))
                self.assertLess(took, 0.8)
            self.assertEqual(status, 200)
            self.assertEqual(answer["sites"], [{"site": "northwind-wa.pool.test"}])

    def test_a_call_that_does_not_ask_is_held_open_until_done_as_before(self):
        def slow(c, body):
            time.sleep(0.6)
            return {"world": c["world"], "sites": [], "ms": 600}

        with self.routes(slow), patch.object(jobs, "WAIT_S", 0.1):
            status, answer, took = self.call("POST", "/world/claim", prefer=False)
        self.assertEqual(status, 200)
        self.assertEqual(answer["world"], "wa")
        self.assertGreaterEqual(took, 0.6)

    def test_a_fast_call_that_asks_is_answered_at_once_with_its_result(self):
        with self.routes(lambda c, body: {"world": c["world"], "sites": [], "ms": 1}):
            status, answer, _ = self.call("POST", "/world/claim")
        self.assertEqual((status, answer["world"]), (200, "wa"))

    def test_a_refusal_in_a_job_answers_its_own_status_and_code(self):
        def refuse(c, body):
            time.sleep(0.4)
            raise Refused(409, "point-site-missing", "northwind-wa.pool.test is not a ready site of wa any more")

        with patch.dict(door.FAST_ROUTES, {("POST", "/world/reset"): refuse}), patch.object(jobs, "WAIT_S", 0.1):
            status, answer, _ = self.call("POST", "/world/reset", body={"point": "p"})
            self.assertEqual(status, 202)
            job = answer["job"]
            while status == 202:
                status, answer, _ = self.call("GET", f"/world/jobs/{job}")
        self.assertEqual(status, 409)
        self.assertEqual(answer["refused"], "point-site-missing")

    def test_a_job_is_read_only_with_its_own_worlds_token_and_is_gone_after_a_restart(self):
        def slow(c, body):
            time.sleep(0.3)
            return {"world": c["world"], "sites": [], "ms": 300}

        with self.routes(slow), patch.object(jobs, "WAIT_S", 0.05):
            _, answer, _ = self.call("POST", "/world/claim")
            job = answer["job"]
            status, answer, _ = self.call("GET", f"/world/jobs/{job}", world="wb")
            self.assertEqual((status, answer["refused"]), (404, "job-not-found"))
            with patch.dict(jobs._jobs, clear=True):
                status, answer, _ = self.call("GET", f"/world/jobs/{job}")
            self.assertEqual((status, answer["refused"]), (404, "job-not-found"))

    def test_removing_a_world_runs_as_a_job_too(self):
        def removed(c):
            time.sleep(0.3)
            return {"world": c["world"], "removed": []}

        with patch.object(door, "remove_world", removed), patch.object(jobs, "WAIT_S", 0.05):
            status, answer, _ = self.call("DELETE", "/world")
            self.assertEqual(status, 202)
            job = answer["job"]
            while status == 202:
                status, answer, _ = self.call("GET", f"/world/jobs/{job}")
        self.assertEqual(answer, {"world": "wa", "removed": []})


class ForgettingTest(unittest.TestCase):
    def test_a_finished_job_is_forgotten_after_keep_s_and_a_running_one_never(self):
        gate = threading.Event()
        running = jobs.start("wk", "running", lambda: gate.wait(5))
        finished = jobs.start("wk", "finished", lambda: {"ok": True})
        finished["done"].wait(5)
        with patch.object(jobs, "KEEP_S", 0), patch.object(time, "time", lambda: finished["ended_at"] + 1):
            jobs.start("wk", "another", lambda: None)
        self.assertIs(jobs.of("wk", running["job"]), running)
        with self.assertRaises(Refused):
            jobs.of("wk", finished["job"])
        gate.set()


if __name__ == "__main__":
    unittest.main()
