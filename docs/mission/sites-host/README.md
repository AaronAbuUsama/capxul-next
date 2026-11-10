# The company-sites machine

Plan of 10 November 2026. The machine and zone now exist (see `STATE.md`); the bench, product and backups do not.

## What it is

One new machine, 16 GiB, in AWS Ireland. Same kind as the tools worker: Lightsail, 4 CPU, 16 GiB, 320 GB.
It runs **simulated worlds**. A world is one test chain, one clock and many companies. Several worlds run side by side.
A real-time environment comes later, on a second machine from the same images.

## What runs on it

- One Frappe bench: web, workers, scheduler, socket server, with MariaDB and Redis. It serves every company's site.
- For each world: its own test chain and its own Capxul service. The service also keeps the world's clock and its record.
- A small proxy that holds the machine's private certificate.
- The record: an append-only log of everything that happens.

## How a request reaches a site

A site is `<company>-<world>.<subdomain>`, for example `acme-w7.worlds.capxul.com`. The subdomain is a parameter;
`worlds.capxul.com` is only the suggestion.

1. The name resolves to the front door (the controller).
2. The front door holds one wildcard certificate and one catch-all route.
3. It forwards to the sites machine over encrypted, verified HTTPS.
4. Frappe picks the site from the name.

## How a new company or world appears

A command asks the Capxul service. It creates a site folder and database. The name already matches the wildcard,
so nothing changes at the front door: no route, no certificate, no DNS. A new world is the same.

## Backup and restore

Every night the controller copies, per world, each site's MariaDB dump, the sites folder, the chain, the record and
the snapshots to the private S3 bucket. A world is paused for seconds so the copy is consistent. Each world is restored
whole; one company can be restored alone. Copies expire after 30 days (read: `deploy/backup/README.md`).
A weekly check restores a copy on an isolated network and proves it opens.

## Cost

- Machine: $84 a month (read: `deploy/tools/split-2026-10-02.md`).
- Route 53 zone about $0.50, backup storage a few dollars, optional daily snapshots up to about $16. All estimates.
- Total about $85 to $100 a month.

## Steps, in order

Status on 10 November 2026: steps 1-5 below are done or replaced as shown; see `STATE.md` for what exists.

1. **Coordinator.** Build and test the image and the hosted layout on a laptop (`compose.md`). *Not done.*
2. **Aaron.** Approved the spend on 10 November 2026. Subdomain `worlds.capxul.com`. *Done.*
3. **Aaron.** `aws login`. *Done (root session, short-lived).*
4. **Coordinator.** Create the DNS zone (`dns-zone.yaml`, stack `capxul-worlds-dns`) and the machine (`template.yaml`, stack
   `capxul-worlds-host`, `CreateHostedZone=false`, a firewall open only to the operator's address). *Done.*
5. **Coordinator.** Records `worlds.capxul.com` and `*.worlds.capxul.com` point straight at the machine's own static
   address (not the controller). *Done.* Four NS records at Namecheap delegate the subdomain. *Added by the coordinator; see `STATE.md` for whether the delegation had resolved.*
6. **Coordinator.** Machine prepared: Docker Engine and compose plugin, `/srv/capxul` tree, unattended upgrades, ufw. No product. *Done.*
7. **Coordinator.** Wildcard certificate from Let's Encrypt by DNS challenge, issued from the coordinator's Mac, kept under
   `~/.capxul/worlds-host/tls/`, copied to `/srv/capxul/tls/`. *See `STATE.md`.*
8. **Coordinator.** The machine terminates HTTPS itself with that certificate. The controller is not touched. Moving the
   machine behind the controller (the original plan in `ingress.md`) stays possible later. *Not done.*
9. **Coordinator.** Place secrets, start the bench, create a test world and one company, open it in a browser. *Not done.*
10. **Coordinator.** Add the machine to the nightly backup and run the restore check once. *Not done.*
11. **Coordinator.** Record the result in `docs/mission/progress.md`. *Not done.*

Open questions and the recommended answers are in `open-questions.md`.
