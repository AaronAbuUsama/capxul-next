"""A stand-in for pymysql in the blank-sites proof (prove.py): every statement is accepted and answers no rows, and a
`create database` (the start of a copy of a site's database inside MariaDB) takes COPY_MS times SCALE, the 3.3 s a copy
of a site took on a real bench (records/site-pool/02-template.json, refills 3.3 s and 3.0 s). No MariaDB is reached."""

import os
import time
import types

err = types.SimpleNamespace(OperationalError=type("OperationalError", (Exception,), {}))
_PAUSE = float(os.environ.get("COPY_MS", "3300")) * float(os.environ.get("SCALE", "0.1")) / 1000


class _Cursor:
    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, statement):
        if statement.startswith("create database"):
            time.sleep(_PAUSE)
        return 0

    def fetchall(self):
        return ()


class _Connection:
    def cursor(self):
        return _Cursor()

    def close(self):
        pass


def connect(**_kwargs):
    return _Connection()
