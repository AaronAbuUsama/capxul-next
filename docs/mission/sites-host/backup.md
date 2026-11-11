# Backup and restore for the company-sites machine

Draft, 10 November 2026. Nothing was run. Facts from `Xelmar-tech/hosting` at `origin/main` carry their path;
everything else is an estimate or an assumption and is marked.

## What the existing backup does (read)

- `deploy/openship/backup.py` runs on the controller, reaches each worker by SSH with a key in `/var/lib/openship/keys`,
  captures PostgreSQL dumps, Redis snapshots and folders, writes `manifest.sha256` last, and checks the S3 object list.
  Its worker map is fixed in code (`worker()`); writers keep running, so it is not a coordinated checkpoint.
- The bucket `abuusama-hosting-backups-707408839584-eu-west-1` has SSE-S3, versioning, daily objects expiring after 30 days
  and noncurrent versions after 7 (`deploy/backup/README.md`). The controller's S3 permission covers `daily/*` only
  (`deploy/host/template.yaml`).
- `mattermost_backup.py` is the precedent for a separate script with its own timer and an isolated restore check.
  `restore-check.py` is the precedent for the check.
- It knows PostgreSQL, Redis and files. It does not know MariaDB.

## What this adds

`draft/sites_backup.py` (a separate script, as Mattermost did, so the existing backup is untouched) and
`draft/sites_restore_check.py`. Per run, under `daily/sites/<UTC stamp>/`:

| Artifact | Contents |
|---|---|
| `bench-common.tar.gz` | `common_site_config.json`, `apps.txt`, `/etc/capxul/env/sites` (identity; encrypted S3 as in `worker-identity.tar.gz`), `/srv/capxul/sites-host` |
| `world-<id>/db-<site>.sql.gz` | one `mariadb-dump --single-transaction` per site, so one company can be restored alone |
| `world-<id>/sites.tar.gz` | those sites' folders (files, `site_config.json`), without `private/backups` |
| `world-<id>/chain.tar.gz` | the world's chain state |
| `world-<id>/record.tar.gz` | the world's append-only record |
| `world-<id>/snapshots.tar.gz` | the world's named snapshots |
| `world-<id>/world.tar.gz` | `world.json` (companies, sites, image) and `clock.json` |
| `receipt.json`, `manifest.sha256` | images running, sites and databases; hashes, uploaded last |

**A world is saved and restored as a whole.** The script pauses the world (clock and chain), takes every part of that
world, then resumes it, in a `finally` so a failure never leaves a world paused. Pausing costs sim time only, nothing real.
Worlds are saved one after another; a world not being saved keeps running. This gives a coordinated cut per world, which
the existing backup does not.

Assumptions to confirm (also in `open-questions.md`): the per-world service offers `capxul world pause|resume`;
the record is JSON lines in segment files; the chain keeps its state in a directory that can be copied while paused.

## Decisions

- **Streamed, not staged.** `backup.py` copies every artifact to `/var/tmp` on the controller first. The controller's disk
  is 30 GiB (`deploy/host/template.yaml`), so this draft hashes and uploads from the SSH stream. Multipart upload is used by
  boto3; the controller role has `s3:PutObject` only, which allows the parts but not `AbortMultipartUpload`, so failed
  uploads may leave incomplete parts. Add `s3:AbortMultipartUpload` on `daily/*` (a change to the controller template).
- **Retention.** Prefix `daily/sites/` inherits 30 days and 7 days for noncurrent versions. That is deliberate for the
  first version. The record is append-only and each daily run copies all of it; if its size (unknown; estimate a few GiB
  for ten sites) makes that costly, move sealed segments to a prefix outside the expiry rule and add a policy for it.
- **Whole-machine image.** Optional daily Lightsail snapshot (`AutoSnapshot` in `template.yaml`) is the crash-consistent
  host image, the counterpart of the EBS snapshot in `deploy/openship/README.md`.
- **Wiring.** Add `SITES_HOST=<static IP>` to `/etc/capxul-hosting-backup.env` (mode 0600), a key `sites` under
  `/var/lib/openship/keys`, and the machine's host key to `/var/lib/openship/.ssh/known_hosts` (check the key first,
  `deploy/backup/README.md`). A timer unit `capxul-sites-backup.timer` at `04:15 UTC`, after the 03:15 timer, with the same
  service shape as `deploy/backup/capxul-hosting-backup.service`.
- **Not backed up on purpose:** the image (it is in the registry by digest) and `sites/assets` (rebuilt from the image).

## Restore

1. Restore the image named in `receipt.json`, bring up MariaDB empty.
2. Restore `bench-common` and the world's `sites.tar.gz`. Create each database user from `site_config.json`, load each dump.
3. Restore `chain`, `record`, `world` (clock), then resume the world.
4. One company alone: its dump plus its site folder. Its world stays running; take care that the record is not rewound.

## Restore check (`draft/sites_restore_check.py <dir> <world> <mariadb image> [<bench image>]`)

Verifies the manifest hashes for the world, creates an `--internal` network with a fresh MariaDB, creates the site users,
loads every dump, asserts more than 100 tables and at least one Company per site, parses every record line, checks chain
state and the clock are present, and optionally runs `bench --site <site> list-apps` with the pinned bench image.
It writes `recovery-receipt-<world>.json`, never prints credentials, removes its containers and network. Run it weekly
from a timer and after any change to the backup (estimate of a sensible cadence).
It also makes the rehearsal for an image rollout (`compose.md`): run the new image's `bench migrate` against a restored copy.
