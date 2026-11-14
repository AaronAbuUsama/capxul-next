"""A stand-in for pymysql in the door's proof on a stand-in bench (prove.py): every statement is accepted and answers
no rows, so a copy of a site's database is a `create database` and nothing else. No MariaDB is reached."""

import types

err = types.SimpleNamespace(OperationalError=type("OperationalError", (Exception,), {}))


class _Cursor:
    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, _statement):
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
