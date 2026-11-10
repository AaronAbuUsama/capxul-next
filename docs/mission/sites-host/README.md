# The company-sites machine

Draft plan, 10 November 2026. Nothing has been created or run. Figures are marked as read (with the path) or as estimates.

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

1. **Coordinator.** Build and test the image and the hosted layout on a laptop (`compose.md`).
2. **Aaron.** Approve the spend, the subdomain and the name form.
3. **Aaron.** `aws login`.
4. **Coordinator.** Create the stack from `template.yaml`. It makes the machine, its fixed address and the DNS zone.
5. **Aaron.** Add the four name servers from the stack output at Namecheap as NS records for the subdomain.
6. **Coordinator.** Check the delegation resolves.
7. **Coordinator.** On the controller: Route 53 permission, DNS-challenge resolver (Let's Encrypt staging first), restart the front door at a quiet hour (`ingress.md`).
8. **Coordinator.** Create the origin certificate on the machine, copy its public part to the controller, install the route file.
9. **Coordinator.** Place secrets, start the bench, create a test world and one company, open it in a browser.
10. **Coordinator.** Add the machine to the nightly backup and run the restore check once.
11. **Coordinator.** Record the result in `docs/mission/progress.md`.

Open questions and the recommended answers are in `open-questions.md`.
