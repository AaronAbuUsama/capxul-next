"""For functions the CLI runs with `bench execute`: print the answer after a marker, so it cannot be mistaken for the progress text other code prints
(search indexing writes progress bars with carriage returns, on the same line, before and after)."""
import functools
import json

MARK = "CAPXUL_RESULT:"


def emit(fn):
    @functools.wraps(fn)
    def wrapper(*a, **k):
        print("\n" + MARK + json.dumps(fn(*a, **k), default=str) + "\n")

    return wrapper
