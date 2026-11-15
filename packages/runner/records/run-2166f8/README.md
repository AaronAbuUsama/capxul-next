# run-2166f8

The same run as `../run-de8bea` (`WORLD_BENCH=staging WORLD_HUB=fleet ./run.sh scenarios`), again. Two journeys passed; `pay Brightside and branch the books` failed at step 4 on the site door's
HTTP 530 at 12:44 UTC: the staging tunnel was down (Cloudflare's error 1033 two minutes later), and platform.yml
deployed `staging` again from 12:45. The template world's destroy then failed at `unsite`: its Cloudflare and Neon
parts were removed, but its site and the bench template `payment-drafted` stayed on the bench and no world record was
kept for the sweeper. Both were removed by hand through the site door afterwards. `failed`.
