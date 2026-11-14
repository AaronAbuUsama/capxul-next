"""A stand-in for rq.job in the capacity proof: never reached, since no queue holds a job."""


class Job:
    def __init__(self, *_args, **_kwargs):
        pass
