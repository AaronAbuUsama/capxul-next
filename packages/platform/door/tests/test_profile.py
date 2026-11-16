"""The bench's machine as the door reports it (pool.profile, on GET /health and GET /templates): what the deploy put in
its environment from packages/platform's src/machines.ts, None where nothing was given."""

import os
import unittest
from unittest import mock

import door_env  # noqa: F401 -- sets the door's environment before its modules load
import pool


class ProfileTest(unittest.TestCase):
    def test_the_profile_is_the_deploys(self):
        env = {"BENCH_HOST_TYPE": "t3.large", "BENCH_SITES_AT_ONCE": "2", "DOOR_COMPANY_POOL_SIZE": "8"}
        with mock.patch.dict(os.environ, env):
            self.assertEqual(pool.profile(), {"host_type": "t3.large", "sites_at_once": 2,
                                              "blank_pool": pool.BLANK_POOL_SIZE, "company_pool": 8})
            self.assertEqual(pool.list_templates()["profile"]["sites_at_once"], 2)

    def test_unset_is_none(self):
        unset = {k: v for k, v in os.environ.items() if k not in ("BENCH_HOST_TYPE", "BENCH_SITES_AT_ONCE")}
        with mock.patch.dict(os.environ, unset, clear=True):
            self.assertEqual((pool.profile()["host_type"], pool.profile()["sites_at_once"]), (None, None))


if __name__ == "__main__":
    unittest.main()
