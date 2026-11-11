## What
Build the lean service (m2-lean-service) with a registry and a supervisor that starts, stops, parks and wakes worlds on the machine, each with its own chain from the seeded state and its own database file. Run twenty core worlds at once and measure memory, start time and steps per second.
## Why
Everything else in the platform stands on a world being cheap. The figure of 0.15 GiB for a world's Capxul part is an estimate until it is measured.
## Done when
- Twenty core worlds run at once on the machine and the measured figures replace the estimates in the book
