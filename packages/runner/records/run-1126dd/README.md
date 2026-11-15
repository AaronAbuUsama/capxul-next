# run-1126dd

`./run.sh scenarios --shared` as in `../run-6c07e4`, after that run's deploy of `staging`: the same two passed; `pay Brightside and branch the books` failed at step 3 again,
`SchemaError: Missing key`: the redeployed door answers a backup with `202 saving`, which this branch's client did not
yet follow (master's `9c522b59`, since cherry-picked here). Nothing left. `failed`.
