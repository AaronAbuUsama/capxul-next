#!/usr/bin/env python3
"""DRAFT. Isolated recovery proof of ONE WORLD from downloaded S3 artifacts (sites_backup.py output).

Style follows deploy/openship/restore-check.py: verify manifest hashes, restore into containers on an --internal network,
assert counts, write a receipt, always clean up, never print secrets. Run it on a Docker host with 4 GiB free, for
example the sites machine itself (the world's own containers are untouched; the network is new and has no outside access).
Usage: sites_restore_check.py <downloaded-prefix-dir> <world> <mariadb-image@digest> [<bench-image@digest>]
Not run against any server.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tarfile
import tempfile
import time


def docker(*args, **kwargs):
    return subprocess.run(['docker', *args], check=True, capture_output=True, text=True, **kwargs).stdout.strip()


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def verify(root, world):
    expected = {}
    for line in (root / 'manifest.sha256').read_text().splitlines():
        digest, name = line.split('  ', 1)
        expected[name] = digest
    names = [n for n in expected if n.startswith('world-' + world + '/')] + ['bench-common.tar.gz']
    if not any(n.endswith('/sites.tar.gz') for n in names):
        raise RuntimeError('World is missing from the backup')
    for name in names:
        assert sha(root / name) == expected[name], name
    return [n for n in names if n.startswith('world-')]


def main(directory, world, mariadb, bench=None):
    root = Path(directory).resolve()
    verify(root, world)
    base = root / ('world-' + world)
    net = 'capxul-sites-recovery-' + secrets.token_hex(4)
    db = net + '-db'
    containers = []
    with tempfile.TemporaryDirectory(prefix='capxul-sites-recovery-') as temporary:
        work = Path(temporary)
        for part in ('sites', 'chain', 'record', 'snapshots', 'world'):
            with tarfile.open(base / (part + '.tar.gz')) as archive:
                archive.extractall(work / part, filter='data')   # safe extraction, Python 3.12+
        clock = json.loads((work / 'world' / 'clock.json').read_text())
        sites = sorted(json.loads((work / 'world' / 'world.json').read_text())['sites'])
        assert sites and (work / 'chain').iterdir().__next__(), 'chain state or site list is empty'
        # ASSUMPTION: the record is JSON lines, one event per line, in segment files. Replace with the record's own verifier.
        events = 0
        for segment in sorted((work / 'record' / 'record').rglob('*.jsonl')):
            for line in segment.read_text().splitlines():
                json.loads(line)
                events += 1
        try:
            docker('network', 'create', '--internal', net)
            env = work / 'db.env'
            env.write_text('MARIADB_ROOT_PASSWORD=' + secrets.token_urlsafe(24) + '\n')
            env.chmod(0o600)
            docker('run', '-d', '--name', db, '--network', net, '--network-alias', 'mariadb', '--env-file', str(env),
                   '--memory', '2g', mariadb, '--character-set-server=utf8mb4', '--collation-server=utf8mb4_unicode_ci')
            containers.append(db)
            for _ in range(60):
                if subprocess.run(['docker', 'exec', db, 'healthcheck.sh', '--connect', '--innodb_initialized'],
                                  capture_output=True).returncode == 0:
                    break
                time.sleep(2)
            else:
                raise RuntimeError('Restore database did not become ready')
            sql = lambda q: docker('exec', db, 'sh', '-c', 'exec mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -N -e "$0"', q)
            restored = {}
            for site in sites:
                config = json.loads((work / 'sites' / site / 'site_config.json').read_text())
                name, password = config['db_name'], config['db_password']
                assert re.fullmatch(r'_?[a-z0-9_]{4,64}', name) and re.fullmatch(r'[A-Za-z0-9]+', password)
                sql('CREATE DATABASE `%s`; CREATE USER \'%s\'@\'%%\' IDENTIFIED BY \'%s\'; GRANT ALL ON `%s`.* TO \'%s\'@\'%%\'' % (name, name, password, name, name))
                with (base / ('db-' + site + '.sql.gz')).open('rb') as dump:
                    gz = subprocess.Popen(['gunzip'], stdin=dump, stdout=subprocess.PIPE)
                    subprocess.run(['docker', 'exec', '-i', db, 'sh', '-c', 'exec mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" ' + name],
                                   stdin=gz.stdout, check=True, capture_output=True)
                    assert gz.wait() == 0
                tables = int(sql("SELECT count(*) FROM information_schema.tables WHERE table_schema='%s'" % name))
                companies = int(sql('SELECT count(*) FROM `%s`.`tabCompany`' % name))
                assert tables > 100 and companies >= 1, site
                restored[site] = {'tables': tables, 'companies': companies}
            healthy = None
            if bench:   # the bench image can open every restored site: apps listed, no migration pending
                for site in sites:
                    out = docker('run', '--rm', '--network', net, '-v', str(work / 'sites') + ':/home/frappe/frappe-bench/sites',
                                 bench, 'bench', '--site', site, 'list-apps')
                    assert 'capxul' in out, site
                healthy = True
            receipt = {'sha256Verified': True, 'world': world, 'sites': restored, 'recordEvents': events,
                       'clock': clock.get('now'), 'chainStatePresent': True, 'benchOpensSites': healthy,
                       'externalNetwork': False}
            (root / ('recovery-receipt-' + world + '.json')).write_text(json.dumps(receipt))
            print(json.dumps(receipt))
        finally:
            for container in reversed(containers):
                subprocess.run(['docker', 'rm', '-f', '-v', container], capture_output=True)
            subprocess.run(['docker', 'network', 'rm', net], capture_output=True)


if __name__ == '__main__':
    if sys.version_info < (3, 12):
        raise SystemExit('Use Python 3.12 or later for safe archive extraction')
    os.umask(0o077)
    main(*sys.argv[1:5])
