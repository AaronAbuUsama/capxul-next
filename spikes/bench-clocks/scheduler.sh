#!/usr/bin/env bash
# scheduler.sh: check 6b, the scheduler (one process that walks every site of the bench and queues what is due).
# The evidence is capxul's own daily job (capxul.clock.daily), which leaves a note naming the world day it ran for.
# A scheduler that read the host's time would not queue alpha's daily job (not due until tomorrow by the host) and
# would queue beta's the moment its jobs are rewound (beta's "yesterday" is five months ago by the host).
set -euo pipefail
. "$(dirname "$0")/lib.sh"
A1="${ALPHA_SITES[0]}"; A2="${ALPHA_SITES[1]}"; B1="${BETA_SITES[0]}"
notes() { for s in "$@"; do echo "sched  $(probe "$s" scheduled)"; done; }
wait_note() {   # wait_note <site> <text>: up to 3 minutes for a daily-job note containing <text>
  for _ in $(seq 1 60); do probe "$1" scheduled | grep -q "$2" && return 0; sleep 3; done
  echo "sched  NO note containing '$2' on $1 after 3 minutes"; return 0
}

say "6b. the scheduler (one process for all sites; tick $(dc exec -T web bash -c 'grep -o "\"scheduler_tick_interval\": [0-9]*" sites/common_site_config.json'))"
echo "alpha: the daily job was not due by the host's clock (job made today, host $(date -u '+%Y-%m-%d %H:%M') UTC); it is due by alpha's"
wait_note "$A1" "2027-04-30"; wait_note "$A2" "2027-04-30"
notes "$A1" "$A2"

echo "beta: rewind its jobs to beta's now with the app's own function, then watch three ticks before beta's midnight"
echo "beta rewound: $(capxul "$B1" clock.rewind_jobs '{}')"
sleep 50
notes "$B1"
echo "beta: move its clock (the app's write) to 23:59:15 site time on 15 June, and wait for its midnight"
# A running clock adds its offset to the host's wall time, so the site reads the UTC instant asked for as its own local
# time (23:59:15, where Europe/London in June would say 00:59:15): finding 3 in the README.
echo "beta written from $B1: $(set_running "$B1" beta "2026-06-15 23:59:15")"
echo "beta now: $(probe "$B1" show)"
wait_note "$B1" "2026-06-16"
notes "$B1"
echo "alpha after beta's move: $(probe "$A1" show)"
