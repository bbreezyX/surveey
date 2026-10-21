"""Apply the approved private Surveey listener without testing application access.

Run as root on the existing Niskala VPS after staging this file, Caddyfile.tailnet and
configure-railway-data.py together. Only Surveey services are restarted. The
separate Tailscale policy grant must be saved through the tailnet admin console.
"""
import datetime
import grp
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

BASE = Path('/srv/surveey')
PRIVATE = BASE / 'private'
SOURCE = Path(__file__).resolve().parent
SERVICES = ['surveey-admin.service', 'surveey-public.service',
            'surveey-broker.service', 'surveey-edge.service']
ACCESS = {
    'allowed_hosts': ['surveey.localhost', '127.0.0.1', '100.64.182.105',
                      'niskala-udara.tailc60422.ts.net'],
    'origins': ['https://surveey.localhost:18443', 'https://100.64.182.105:18443',
                'https://niskala-udara.tailc60422.ts.net:18443'],
    'bind_addresses': ['127.0.0.1', '100.64.182.105', 'fd7a:115c:a1e0::4729:b66a'],
    'tcp_port': 18443,
    'certificate_type': 'self-signed',
    'connection_tested': False,
}


def atomic_write(path, content, mode, group=0):
    temporary = path.with_name(path.name + '.incoming')
    descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, mode)
    with os.fdopen(descriptor, 'w') as output:
        output.write(content)
    os.chown(temporary, 0, group)
    temporary.chmod(mode)
    os.replace(temporary, path)


def main():
    os.umask(0o077)
    if os.geteuid() != 0 or not (BASE / 'ACTIVATED.json').is_file():
        raise RuntimeError('Only the already activated Surveey VPS may be updated.')
    if (BASE / 'PUBLIC_ORIGIN_CONFIGURED.json').exists():
        raise RuntimeError('Preserve the configured production listener and origins when updating Tailnet access.')
    values = {'ALLOWED_HOSTS': ','.join(ACCESS['allowed_hosts']),
              'ADMIN_ORIGIN': ','.join(ACCESS['origins']),
              'PUBLIC_ORIGIN': ','.join(ACCESS['origins'])}
    environments = {}
    for service in ('admin', 'public', 'broker'):
        path = PRIVATE / f'{service}.env'
        lines = path.read_text().splitlines(keepends=True)
        for key, value in values.items():
            matches = [index for index, line in enumerate(lines) if line.startswith(key + '=')]
            if len(matches) != 1:
                raise RuntimeError('The existing Surveey environment must contain explicit web settings.')
            lines[matches[0]] = key + '="' + value + '"\n'
        environments[path] = ''.join(lines)

    edge_unit = Path('/etc/systemd/system/surveey-edge.service')
    unit = edge_unit.read_text()
    unit = unit.replace('Description=Surveey loopback HTTPS using Railway data',
                        'Description=Surveey private HTTPS using Railway data')
    if 'Wants=tailscaled.service' not in unit:
        unit = unit.replace('After=surveey-admin.service',
                            'Wants=tailscaled.service\nAfter=tailscaled.service surveey-admin.service')
    if 'RestartSec=' not in unit:
        unit = unit.replace('Restart=on-failure\n', 'Restart=on-failure\nRestartSec=5\n')

    now = datetime.datetime.now(datetime.timezone.utc)
    history = PRIVATE / 'configuration-history' / ('tailnet-' + now.strftime('%Y%m%dT%H%M%S%fZ'))
    history.mkdir(parents=True, mode=0o700)
    history.parent.chmod(0o700)
    targets = [*environments, edge_unit, PRIVATE / 'web-access.json',
               BASE / 'deploy/Caddyfile', BASE / 'deploy/configure-railway-data.py',
               BASE / 'app/server/deploy/vps/configure-railway-data.py',
               BASE / 'tls/tailnet.crt', BASE / 'tls/tailnet.key']
    for index, path in enumerate(targets):
        if path.exists():
            backup = history / f'{index}-{path.name}'
            shutil.copyfile(path, backup)
            backup.chmod(0o600)

    # The backend preview certificate remains unchanged, preserving proxy trust.
    tls_group = grp.getgrnam('surveey-tls').gr_gid
    certificate = BASE / 'tls/tailnet.crt'
    key = BASE / 'tls/tailnet.key'
    if not certificate.exists() and not key.exists():
        result = subprocess.run([
            'openssl', 'req', '-x509', '-newkey', 'ed25519', '-nodes',
            '-keyout', str(key), '-out', str(certificate), '-days', '90',
            '-subj', '/CN=niskala-udara.tailc60422.ts.net',
            '-addext', 'subjectAltName=DNS:surveey.localhost,DNS:niskala-udara.tailc60422.ts.net,'
            'IP:127.0.0.1,IP:100.64.182.105,IP:fd7a:115c:a1e0::4729:b66a'],
            capture_output=True)
        if result.returncode:
            raise RuntimeError('Private listener certificate creation failed.')
    elif not certificate.is_file() or not key.is_file():
        raise RuntimeError('An incomplete listener certificate must not be overwritten.')
    for path in (certificate, key):
        os.chown(path, 0, tls_group)
        path.chmod(0o640)

    for path, content in environments.items():
        atomic_write(path, content, 0o600)
    atomic_write(PRIVATE / 'web-access.json', json.dumps(ACCESS, indent=2), 0o600)
    atomic_write(edge_unit, unit, 0o644)
    app_group = grp.getgrnam('surveey').gr_gid
    atomic_write(BASE / 'deploy/Caddyfile', (SOURCE / 'Caddyfile.tailnet').read_text(), 0o640, app_group)
    configurator = (SOURCE / 'configure-railway-data.py').read_text()
    atomic_write(BASE / 'deploy/configure-railway-data.py', configurator, 0o640)
    atomic_write(BASE / 'app/server/deploy/vps/configure-railway-data.py', configurator, 0o640, app_group)
    result = subprocess.run(['systemctl', 'daemon-reload'], capture_output=True)
    if result.returncode:
        raise RuntimeError('Surveey unit registration failed.')
    restart = subprocess.run(['systemctl', 'restart', *SERVICES], capture_output=True)
    record = {
        'configured_at_utc': now.isoformat(),
        'state': 'restart_command_completed_unverified' if restart.returncode == 0 else 'restart_command_failed',
        'restart_exit_code': restart.returncode,
        'services': SERVICES,
        'web_access': ACCESS,
        'tailscale_policy': 'separate_console_change',
        'database_source': 'Railway', 'media_source': 'Railway bucket',
        'niskala_services_restarted': False, 'public_dns_changed': False,
        'railway_configuration_modified': False, 'data_deleted': False,
        'functional_tests_performed': False, 'runtime_health_verified': False,
    }
    atomic_write(BASE / 'TAILSCALE_ACCESS.json', json.dumps(record, indent=2), 0o644)
    print(json.dumps(record), flush=True)
    return restart.returncode


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        # Environment files contain credentials. Never include their contents.
        print(json.dumps({'configuration_failed': True, 'error_type': type(error).__name__}), flush=True)
        sys.exit(1)
