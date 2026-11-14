"""A stand-in for rq in the capacity proof (../prove.py): no queue holds a job, so a reset removes none."""


class Queue:
    @staticmethod
    def all(connection=None):
        return []
