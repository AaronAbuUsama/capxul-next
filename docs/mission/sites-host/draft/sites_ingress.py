#!/usr/bin/env python3
"""DRAFT. Publish the one catch-all route for company sites through the existing controller ingress.

Style and layout follow deploy/openship/mattermost_ingress.py (Xelmar-tech/hosting, origin/main): it renders a
dedicated file into /etc/capxul/ingress/dynamic, never touches another route file, and ships its own --check.
Differences are marked DIFFERS. Not run against any server.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

DESTINATION = Path('/etc/capxul/ingress/dynamic/sites.yaml')
RESOLVER = 'letsencrypt-dns'   # DIFFERS: a second resolver using the DNS challenge; 'letsencrypt' (TLS challenge) stays for exact names.
ORIGIN_NAME = 'sites-origin.capxul.internal'   # name inside the origin certificate; never looked up in DNS
ORIGIN_CA = '/traefik/certs/sites-origin-ca.pem'   # /etc/capxul/ingress is mounted at /traefik in the proxy container
SUBDOMAIN = re.compile(r'[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)+')
ADDRESS = re.compile(r'(\d{1,3}\.){3}\d{1,3}')


def configuration(subdomain, address):
    if not SUBDOMAIN.fullmatch(subdomain) or not ADDRESS.fullmatch(address):
        raise ValueError('Invalid subdomain or address')
    host = re.escape(subdomain)
    # One label under the subdomain, plus the subdomain itself: <company>-<world>.<subdomain>.
    rule = 'HostRegexp(`^([a-z0-9-]+\\.)?' + host + '$`)'
    name = 'sites-' + subdomain.replace('.', '-')
    return {'http': {
        'routers': {
            name: {'entryPoints': ['https'], 'rule': rule, 'priority': 4000,   # below the exact-host routers (5000)
                   'service': name, 'middlewares': ['sites-compress'],
                   'tls': {'certResolver': RESOLVER,
                           'domains': [{'main': subdomain, 'sans': ['*.' + subdomain]}]}},
            # DIFFERS: no '-acme' router. The certificate comes from a DNS challenge, so the worker never sees ACME.
            name + '-http': {'entryPoints': ['http'], 'rule': rule, 'priority': 4000,
                             'service': 'noop@internal', 'middlewares': ['sites-https-redirect']},
        },
        'services': {name: {'loadBalancer': {'passHostHeader': True, 'serversTransport': name,
                                            'servers': [{'url': 'https://' + address + ':443'}]}}},
        # DIFFERS: strict verification against a pinned private CA, because the sites machine does not hold the public wildcard.
        'serversTransports': {name: {'serverName': ORIGIN_NAME, 'rootCAs': [ORIGIN_CA],
                                     'insecureSkipVerify': False}},
        # Own middleware names: names are global across the file provider, ingress.py already defines 'https-redirect'.
        'middlewares': {'sites-compress': {'compress': {}},
                        'sites-https-redirect': {'redirectScheme': {'scheme': 'https', 'permanent': True}}},
    }}


def check():
    http = configuration('worlds.capxul.com', '203.0.113.7')['http']
    name = 'sites-worlds-capxul-com'
    rx = http['routers'][name]['rule']
    pattern = re.compile(rx[len('HostRegexp(`'):-2])
    assert pattern.fullmatch('acme-w7.worlds.capxul.com') and pattern.fullmatch('worlds.capxul.com')
    assert not pattern.fullmatch('acme.w7.worlds.capxul.com'), 'two labels are not covered by one wildcard'
    assert not pattern.fullmatch('acme-w7.worldsXcapxul.com') and not pattern.fullmatch('app.capxul.com')
    assert http['serversTransports'][name]['insecureSkipVerify'] is False
    assert http['routers'][name]['tls']['domains'][0]['sans'] == ['*.worlds.capxul.com']
    assert 'preview' not in json.dumps(http)
    for bad in ('bad`host', 'worlds', 'Worlds.capxul.com'):
        try:
            configuration(bad, '203.0.113.7')
        except ValueError:
            continue
        raise AssertionError('Unsafe subdomain accepted: ' + bad)


def apply(subdomain, address):
    if os.geteuid() != 0 or not DESTINATION.parent.is_dir():
        raise RuntimeError('Run on the existing ingress controller as root')
    content = (json.dumps(configuration(subdomain, address), indent=2) + '\n').encode()
    if DESTINATION.exists() and DESTINATION.read_bytes() == content:
        print('Sites ingress is already current')
        return
    backup = None
    if DESTINATION.exists():
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        backup = Path('/var/backups/capxul-openship') / ('sites-ingress-' + stamp + '.yaml')
        backup.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with backup.open('xb') as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(DESTINATION.read_bytes())
    fd, temporary = tempfile.mkstemp(prefix='.sites-', dir=DESTINATION.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), 0o644)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, DESTINATION)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print(json.dumps({'subdomain': subdomain, 'path': str(DESTINATION),
                      'sha256': hashlib.sha256(content).hexdigest(), 'backup': str(backup) if backup else None}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--subdomain', default='worlds.capxul.com')   # a parameter: not decided
    parser.add_argument('--address')   # the sites machine's static IP, from the stack output WorkerPublicIp
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    check()
    if args.apply:
        apply(args.subdomain, args.address or '')
    else:
        print('Sites ingress check passed')
