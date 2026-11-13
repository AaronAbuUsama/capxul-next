# smoke

One throwaway scenario that proves the runner itself, end to end, against the empty handlers: it calls
`record.export` and passes when the call dies as "not implemented". It is not an acceptance scenario, it is never
run with `../../scenarios`, and it stops passing the day `record.export` is implemented. Delete it then.

Run it with `./run.sh smoke` from `spikes/pipeline`.
