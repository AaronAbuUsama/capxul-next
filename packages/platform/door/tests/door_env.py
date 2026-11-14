"""The door's modules imported for unit tests, with no bench, MariaDB or Redis: the environment the door reads at
import is set, the bench is a temporary folder (FRAPPE_BENCH), and pymysql is a stand-in that refuses to connect, so
a test that reached MariaDB by mistake fails loudly. Import this before any door module."""

import os
import sys
import tempfile
import types

BENCH = tempfile.mkdtemp(prefix="door-test-")
os.makedirs(f"{BENCH}/sites", exist_ok=True)
os.environ.update({"DOOR_KEY": "k" * 64, "DB_ROOT_PASSWORD": "root-password-for-tests", "PLATFORM_DOMAIN": "pool.test",
                   "FRAPPE_BENCH": BENCH, "DOOR_POOL_SIZE": "2"})


def _no_mariadb(*_args, **_kwargs):
    raise AssertionError("a unit test reached MariaDB")


sys.modules.setdefault("pymysql", types.SimpleNamespace(connect=_no_mariadb, err=types.SimpleNamespace(
    OperationalError=type("OperationalError", (Exception,), {}))))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
