# run-f2e169

`WORLD_BENCH=staging WORLD_HUB=fleet ./run.sh scenarios` on 14 November 2026, with packages/world saving sites through
the asynchronous backup (falling back to the old door's answer, since `staging` was not redeployed) while another
builder's run made sites on `staging`: the starting worlds were made and saved (`save payment-drafted` 31.6 s, its
backup answered by the old door within it), then every reset failed on `HTTP 502: upstream request failed`: a door
call held past this container's network relay's 32 s while the old door's removal waited for `BENCH_LOCK`. The
take-down's `unsite` failed the same way; the world's sites and point were removed through the door by hand
afterwards. `failed`; the summary written and every journey's record with why.
