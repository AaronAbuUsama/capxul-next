# The cloud: what exists, and how company sites would run on it

Written 10 November 2026 by the coordinator from a read of `Xelmar-tech/hosting` at `origin/main` (14 October 2026).
Nothing was run against AWS or any server. Facts carry their file in that repository.

## What exists today

All web traffic for capxul.com goes to one small front-door machine in AWS Ireland. It checks the hostname and
passes each request, encrypted, to the larger machine that runs that service in containers. OpenShip, on the front
door, keeps track of which container serves which hostname. GitHub starts a deploy by sending the front door a
remote command. Every night the databases and files are copied to a private, encrypted store at Amazon.

| Machine | Size | Runs | Monthly |
|---|---|---|---|
| Controller (front door) | EC2 `t3a.small`, 2 GiB | OpenShip, the public proxy (Traefik), the nightly backup | $21 |
| Capxul worker | EC2 `t3a.xlarge`, 4 vCPU, 16 GiB, 200 GiB disk | Convex, MCP, Ponder, the AA gateway, PostgreSQL, staging web, marketing, previews | $140 |
| Tools worker | Lightsail, 4 CPU, 16 GiB | Twenty CRM, Mattermost, Vaultwarden, Infisical, the LLM gateway and others | $84 |
| Paynest worker | Lightsail, 8 GiB | Paynest | $44 |

Sources: `deploy/host/template.yaml`, `deploy/openship/README.md`, `deploy/tools/split-2026-10-02.md`.

- **OpenShip replaced Coolify on 2 October 2026** (`deploy/openship/retirement-2026-10-02.md`). Several READMEs still
  describe Coolify.
- **A request's path:** Namecheap's `*` record points at the controller; the controller's proxy holds one route and
  one certificate per exact hostname; it forwards to a proxy on the worker (`deploy/openship/ingress.py`).
- **Adding a service today:** a Compose file with pinned images, environment files placed on the worker, the stack
  started over SSH, the containers registered in OpenShip, and the hostname added to an allowlist
  (`deploy/tools/publish_services.py`, `deploy/openship/tools_ingress.py`).
- **Backups:** daily, PostgreSQL dumps, Redis snapshots and a fixed list of folders (`deploy/openship/backup.py`).
- **Monitoring:** two CloudWatch alarms that notify nobody (`deploy/host/README.md`).
- **There is no production yet.** `app.capxul.com` is reserved and stopped.

## What does not fit company sites as it stands

A bench serves many sites, one per company, each at its own hostname, and a new site is created by a command at
any time.

1. **One route and one certificate per hostname.** Every new company would need a proxy change and a new
   certificate. There is no wildcard certificate, because that needs DNS automation and Namecheap's is not set up.
2. **The backup knows PostgreSQL only.** A bench uses MariaDB and a folder of site files.
3. **One deploy at a time, and a redeploy replaces containers,** which would interrupt every company at once.
4. **No room is recorded on the Capxul worker.** The tools worker had about 11 GiB free on 2 October.
5. **Nothing covers simulated time or an append-only record.**

## Proposal

1. **A machine of its own for sites,** following the precedent of one host per lane: 16 GiB, about $84 a month by the
   tools worker's price. It runs the bench (Frappe, the workers, the scheduler, MariaDB, Redis), the Capxul service,
   a test chain for simulated worlds, and the record.
2. **One wildcard route to that machine,** for a subdomain kept for company sites. Frappe picks the site from the
   hostname itself, so a new company needs no proxy change. The wildcard certificate needs that subdomain's DNS on
   a provider with an API (Route 53, since everything else is in AWS).
3. **MariaDB dumps and the sites folder added to the nightly backup.**
4. **Worlds first.** The first environment is simulated: time moves fast, agents play the companies, everything is
   recorded, and a person can open any company's site in a browser. A real-time environment for a real company is
   a second machine with the same images, later.
5. **Site creation stays a command.** `org create` asks the Capxul service on that machine, which runs what the
   spike's `new-site.sh` runs today.

## Needs Aaron

- Go-ahead to add a machine (about $84 a month).
- The subdomain for company sites, and that subdomain's DNS moved to Route 53.
- A way in for the deploy: the OpenShip workspace connected to this session has a restricted role.

## Not determined from the repository

Whether OpenShip can register a wildcard route; current memory use on the Capxul worker; Let's Encrypt limits if
sites were given a certificate each instead; whether the GitHub deploy role is set as the template says.
