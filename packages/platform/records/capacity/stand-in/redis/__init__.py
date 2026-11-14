"""A stand-in for redis in the capacity proof (../prove.py): a reset clears no cache key, since none is kept."""


class Redis:
    def __init__(self, **_kwargs):
        pass

    def scan_iter(self, **_kwargs):
        return iter(())

    def unlink(self, *_keys):
        return 0
