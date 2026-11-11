# Open questions

Each needs the owner, or access that this draft did not have. A recommendation follows each.

## Needs Aaron

| # | Question | Recommendation |
|---|---|---|
| 1 | Approve about $84 a month for the machine, plus small items (Route 53 zone, backup storage; estimates in README). | Approve. |
| 2 | The subdomain. `worlds.capxul.com` was suggested. | Accept it. It is a parameter everywhere, so a later change costs one stack update and a re-issued certificate. |
| 3 | Hostname form: `<company>-<world>.<base>` or `<company>.<world>.<base>`. | `<company>-<world>.<base>` (`ingress.md`). |
| 4 | May `capxul.com` get NS records for the subdomain at Namecheap? (Namecheap stays authoritative for everything else.) | Yes, for this one name only. Mail and every other record are untouched. |
| 5 | `aws login` and the account/region for the stack (the precedent uses account 707408839584, `eu-west-1`). | Same account and region. |
| 6 | An email address for Let's Encrypt expiry notices. The existing resolver has none. | Add one to both resolvers. |
| 7 | Access for the deploy: the OpenShip workspace connected to the coordinator has a restricted role (`cloud.md`). | Not needed for this machine if it is not adopted into OpenShip (question 11). Needed only if it is. |

## Needs access to answer

| # | Question | How | Recommendation |
|---|---|---|---|
| 8 | Does Namecheap accept NS records on a subdomain? | Advanced DNS page | If not, use option 1b in `ingress.md`. |
| 9 | Can the controller's container read instance credentials (hop limit 1 today)? | Test from the container | Raise the limit to 2 in the controller stack. |
| 10 | Is `99.81.80.126` an Elastic IP, and the controller's Traefik version? | `aws ec2 describe-addresses`; `traefik version` | If not an Elastic IP, fix that first. |
| 11 | Adopt the machine into OpenShip or manage it by script? | Try on the first stack | Script only. The bench is one Compose stack, and the backup talks to it by SSH. |
| 12 | Current memory use on the controller (it is 2 GiB and gets one more resolver, a route and a backup job). | `free`, `docker stats` | Measure before the restart. |
| 13 | Who may push the image to the registry, and which registry (GHCR is used for the other images, `images.lock.env`)? | Check the existing workflow | GHCR, by digest, built in CI. |

## Needs the build (before the machine exists)

| # | Question | Recommendation |
|---|---|---|
| 14 | Does the per-world service offer pause and resume for the clock and chain? The backup relies on it. | Add `capxul world pause` and `resume` to the service. If absent, take the cut with the world's containers stopped for seconds. |
| 15 | The record's format, size growth and its own integrity check. | JSON lines in sealed segments with a hash chain; replace the line parser in `sites_restore_check.py` with its verifier. |
| 16 | The `capxul` app repository, its branch for the image, and CRM's branch. | Fix them in `apps.json`; record in the book. |
| 17 | Does the chain keep copyable state while paused? | Test locally. |
| 18 | Assets after an image change; forwarded protocol through two proxies. | The local tests in `compose.md`. |
| 19 | One bench for all worlds, or one per world. | One bench; give worlds that need a different image their own machine (memory table, `compose.md`). |
| 20 | Snapshots: turn on the Lightsail daily snapshot? | Off until the first real data exists, then on. |
| 21 | Monitoring: the cloud's two alarms notify nobody (`deploy/host/README.md`). | Add a notified alarm on this machine's status and disk, before real data. |
| 22 | Does `bench new-site` for a new world's company fit the time the "create a company" command allows? | Measure locally; the spike's `new-site.sh` prints elapsed seconds per step. |
