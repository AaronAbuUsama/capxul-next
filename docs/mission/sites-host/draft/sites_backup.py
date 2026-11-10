#!/usr/bin/env python3
"""DRAFT. Back up the company-sites machine, one whole world at a time, into the existing private S3 bucket.

Style follows deploy/openship/backup.py and mattermost_backup.py (Xelmar-tech/hosting, origin/main): runs on the
controller, reaches the machine over SSH with a key under /var/lib/openship/keys, writes a sha256 manifest LAST, and
verifies the S3 object list. DIFFERS: artifacts are streamed to S3 and hashed on the way, never staged on the controller
(the controller disk is 30 GiB, deploy/host/template.yaml). Not run against any server.

A WORLD is one chain, one clock and all its companies. It is saved as one unit: the world is paused for the seconds the
cut takes, then every part is taken. Layout on the machine (compose.md): /srv/capxul/volumes/capxul-worlds/<world>/
{world.json, clock.json, chain/, record/, snapshots/}, and the bench's sites in /srv/capxul/volumes/capxul-sites/.
"""
import datetime
import fcntl
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys

WORLDS = '/srv/capxul/volumes/capxul-worlds'
SITES = '/srv/capxul/volumes/capxul-sites'
DB = 'capxul-mariadb'                 # container names are set in compose.md
WORLD = re.compile(r'w[0-9]+')        # a world id has no hyphen, so <company>-<world> splits at the LAST hyphen
SITE = re.compile(r'[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)+')
DBNAME = re.compile(r'_?[a-z0-9_]{4,64}')


def ssh(command, stdout=None):
    # Same options as worker() in backup.py. The address comes from the environment file, like WORKER_HOST in deploy/backup/README.md.
    return subprocess.Popen(['ssh', '-i', '/var/lib/openship/keys/sites', '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=/var/lib/openship/.ssh/known_hosts',
        'root@' + os.environ['SITES_HOST'], command], stdout=stdout)


def remote(command):
    process = ssh(command, subprocess.PIPE)
    out = process.communicate()[0]
    if process.returncode:
        raise RuntimeError('Remote command failed')
    return out.decode()


class Hashing:
    def __init__(self, stream):
        self.stream, self.digest, self.size = stream, hashlib.sha256(), 0

    def read(self, n=-1):
        data = self.stream.read(n)
        self.digest.update(data)
        self.size += len(data)
        return data


def stream_up(s3, bucket, key, command, receipt):
    process = ssh(command, subprocess.PIPE)
    reader = Hashing(process.stdout)
    s3.upload_fileobj(reader, bucket, key, ExtraArgs={'ServerSideEncryption': 'AES256'})
    if process.wait():
        raise RuntimeError('Capture failed: ' + key)
    receipt[key] = {'sha256': reader.digest.hexdigest(), 'bytes': reader.size}


def world_sites(world):
    spec = json.loads(remote('cat ' + shlex.quote(WORLDS + '/' + world + '/world.json')))
    sites = sorted(spec['sites'])
    for site in sites:
        # Hostname is <company>-<world>.<subdomain>; the registry and the name must agree.
        if not SITE.fullmatch(site) or site.split('.')[0].rsplit('-', 1)[-1] != world:
            raise RuntimeError('Site does not belong to world ' + world + ': ' + site)
    return sites


def database(site):
    config = json.loads(remote('cat ' + shlex.quote(SITES + '/' + site + '/site_config.json')))
    if not DBNAME.fullmatch(config['db_name']):
        raise RuntimeError('Unexpected database name')
    return config['db_name']   # the password in the same file is never read into the receipt


def control(world, verb):
    # ASSUMPTION (open-questions.md): the per-world service offers pause/resume of the world clock and chain.
    remote('docker exec capxul-service-' + world + ' capxul world ' + verb)


def backup_world(s3, bucket, prefix, world, receipt):
    sites = world_sites(world)
    dbs = {site: database(site) for site in sites}
    base = prefix + 'world-' + world + '/'
    control(world, 'pause')
    try:
        for site, db in dbs.items():
            dump = ('docker exec ' + DB + ' sh -c ' + shlex.quote('exec mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" '
                    '--single-transaction --quick --routines --triggers --events ' + db) + ' | gzip -1')
            stream_up(s3, bucket, base + 'db-' + site + '.sql.gz', dump, receipt)
        files = ' '.join(shlex.quote(s) for s in sites)
        excludes = ' '.join('--exclude=' + shlex.quote(s + '/private/backups') for s in sites)
        stream_up(s3, bucket, base + 'sites.tar.gz', "nice -n 10 tar -I 'gzip -1' " + excludes + ' -C ' + SITES + ' -cf - ' + files, receipt)
        for part in ('chain', 'record', 'snapshots'):
            stream_up(s3, bucket, base + part + '.tar.gz', "tar -I 'gzip -1' -C " + WORLDS + '/' + world + ' -cf - ' + part, receipt)
        stream_up(s3, bucket, base + 'world.tar.gz', "tar -I 'gzip -1' -C " + WORLDS + '/' + world + ' -cf - world.json clock.json', receipt)
    finally:
        control(world, 'resume')   # a world is never left paused by a failed backup
    return {'sites': dbs}


def backup():
    import boto3
    os.umask(0o077)
    bucket = os.environ['BACKUP_BUCKET']
    with open('/run/lock/capxul-sites-backup.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        worlds = sorted(w for w in remote('ls ' + WORLDS).split() if WORLD.fullmatch(w))
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H-%M-%SZ')
        prefix = 'daily/sites/' + stamp + '/'   # under daily/: covered by the controller's S3 policy and the 30-day expiry
        s3 = boto3.client('s3', region_name='eu-west-1')
        receipt, detail = {}, {}
        stream_up(s3, bucket, prefix + 'bench-common.tar.gz', "tar --dereference -I 'gzip -1' -C / -cf - "
                  "srv/capxul/volumes/capxul-sites/common_site_config.json srv/capxul/volumes/capxul-sites/apps.txt "
                  'etc/capxul/env/sites srv/capxul/sites-host', receipt)
        for world in worlds:
            detail[world] = backup_world(s3, bucket, prefix, world, receipt)
        images = remote("docker ps --format '{{.Names}} {{.Image}}'")
        body = json.dumps({'checkpoint': 'per-world', 'worlds': detail, 'images': images,
                           'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}).encode()
        s3.put_object(Bucket=bucket, Key=prefix + 'receipt.json', Body=body, ServerSideEncryption='AES256')
        receipt[prefix + 'receipt.json'] = {'sha256': hashlib.sha256(body).hexdigest(), 'bytes': len(body)}
        manifest = ''.join(v['sha256'] + '  ' + k.removeprefix(prefix) + '\n' for k, v in sorted(receipt.items())).encode()
        s3.put_object(Bucket=bucket, Key=prefix + 'manifest.sha256', Body=manifest, ServerSideEncryption='AES256')   # last
        keys = {x['Key'] for x in s3.list_objects_v2(Bucket=bucket, Prefix=prefix).get('Contents', [])}
        if keys != set(receipt) | {prefix + 'manifest.sha256'}:
            raise RuntimeError('Incomplete S3 backup')
        print('Sites backup complete: s3://' + bucket + '/' + prefix)


if __name__ == '__main__':
    if sys.argv[1:] == ['--check']:
        assert WORLD.fullmatch('w7') and not WORLD.fullmatch('w7; rm')
        assert not SITE.fullmatch('acme`.worlds.capxul.com') and DBNAME.fullmatch('_1bd3e0294da19198')
        h = Hashing(__import__('io').BytesIO(b'abc'))
        h.read()
        assert h.digest.hexdigest().startswith('ba7816bf') and h.size == 3
        print('Sites backup safety check passed')
    else:
        backup()
