"""Long calls in the background, so no call waits past the 100 s Cloudflare's edge allows a request through the tunnel
(it answers 524 then, and the caller never learns how the call ended).

A call that may wait that long (a claim, a save, a reset, making a template, a sweep, setting the clock, removing a
site or a world: each waits on locks other worlds hold while the bench is busy) is run as a job when its caller asks
for one with `Prefer: respond-async` (RFC 7240). The door then waits up to WAIT_S for it: done by then, it answers as
the call always has (200 and its result, or its refusal and status); still running, it answers 202 with the job's id.
`GET /world/jobs/<job>`, with the same world's token, waits up to WAIT_S again and answers the same way. A caller that
does not ask is answered when the work is done, as before, so an old client keeps working with a new door, and a new
client with an old door gets its answer at once, as it always did.

Jobs live in the door's memory: a door that restarts forgets them, and a poll then reads `job-not-found`. A finished
job is kept KEEP_S for its caller to read, then forgotten.
"""

import os
import secrets
import threading
import time

from sites import DB_ROOT, Refused

WAIT_S = float(os.environ.get("DOOR_JOB_WAIT_S", "20"))
KEEP_S = int(os.environ.get("DOOR_JOB_KEEP_S", "3600"))
_jobs, _guard = {}, threading.Lock()


def wanted(headers):
    """Whether the caller asked for a job instead of an answer held open until the work is done."""
    return "respond-async" in (headers.get("Prefer") or "").lower()


def start(world, what, work):
    """Starts `work` (no arguments; returns the call's result or raises Refused) for `world` and answers the job."""
    job = {"job": secrets.token_hex(8), "world": world, "what": what, "state": "running", "started_at": time.time(),
           "done": threading.Event()}
    with _guard:
        _forget_old()
        _jobs[job["job"]] = job
    threading.Thread(target=_run, args=(job, work), daemon=True).start()
    return job


def _run(job, work):
    t0 = time.monotonic()
    try:
        outcome = {"state": "done", "status": 200, "answer": work()}
    except Refused as r:
        outcome = {"state": "failed", "status": r.status, "answer": {"refused": r.code, "detail": r.detail}}
    except Exception as e:  # noqa: BLE001 -- an unforeseen failure answers 500 with its kind, never a secret
        detail = repr(e)[-300:].replace(DB_ROOT, "<root>")
        outcome = {"state": "failed", "status": 500, "answer": {"refused": "door-failed", "detail": detail}}
    ms = round((time.monotonic() - t0) * 1000)
    with _guard:
        job.update(outcome, ms=ms, ended_at=time.time())
    job["done"].set()
    print(f"door: job {job['job']} ({job['what']}) {outcome['state']} in {ms} ms", flush=True)


def of(world, job_id):
    """The world's job, or a refusal: another world's job is refused as if it were not there to see."""
    with _guard:
        job = _jobs.get(job_id)
    if job is None or job["world"] != world:
        raise Refused(404, "job-not-found", f"no job {job_id} of world {world} (a door that restarted forgets them)")
    return job


def answer(job, wait_s=None):
    """(status, payload) after waiting up to `wait_s` (WAIT_S): the call's own answer once it is done, else 202."""
    job["done"].wait(WAIT_S if wait_s is None else wait_s)
    with _guard:
        if job["state"] == "running":
            return 202, {"job": job["job"], "state": "running", "what": job["what"],
                         "running_ms": round((time.time() - job["started_at"]) * 1000)}
        return job["status"], job["answer"]


def _forget_old():
    now = time.time()
    for job_id in [j for j, job in _jobs.items() if job.get("ended_at") and now - job["ended_at"] > KEEP_S]:
        del _jobs[job_id]
