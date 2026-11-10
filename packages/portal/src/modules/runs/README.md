# runs

The pass-through to the loop's host. The Runs app and its live data are the host's (`pnpm loop serve`, on this machine);
the portal's server passes everything under `/runs/` to it unchanged, the WebSocket included, so a person has one
address. It serves nothing of its own and imports nothing from the loop: when the host is down it says so, and how to
start it. A request must name one of the portal's own hosts, as every other request must.
