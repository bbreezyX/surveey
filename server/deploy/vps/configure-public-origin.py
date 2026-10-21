"""Install the approved Surveey public origin and connector without testing it.

DNS and the remote tunnel route are saved separately in the Cloudflare console.
Required staged files: Caddyfile.production, cloudflared-linux-amd64,
cloudflare-tunnel.token and production-dns-before.json. Secrets are never printed.
"""
import datetime
import grp
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

BASE = Path('/srv/surveey')
PRIVATE = BASE / 'private'
SOURCE = Path(__file__).resolve().parent
HOST = 'survey.esdm.cloud'
TUNNEL_ID = '6e53a53e-ff83-45c6-a2a4-dd30fa5c33e5'
MARKER = BASE / 'PUBLIC_ORIGIN_CONFIGURED.json'


def write(path, content, mode=0o600, group=0):
    temporary = path.with_name(path.name + '.incoming')
    descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, mode)
    with os.fdopen(descriptor, 'w') as output:
        output.write(content)
    os.chown(temporary, 0, group)
    temporary.chmod(mode)
    os.replace(temporary, path)


def main():
    os.umask(0o077)
    if os.geteuid() != 0 or not (BASE / 'TAILSCALE_ACCESS.json').exists():
        raise RuntimeError('Only the prepared Surveey VPS can receive this origin configuration.')
    if MARKER.exists():
        raise RuntimeError('Public origin preparation is already recorded; do not replace it blindly.')
    token = (SOURCE / 'cloudflare-tunnel.token').read_text().strip()
    if not re.fullmatch(r'eyJ[A-Za-z0-9_.-]{50,}', token):
        raise RuntimeError('The actual tunnel token must be supplied in the private staging file.')
    access_file = PRIVATE / 'web-access.json'
    access = json.loads(access_file.read_text())
    access['allowed_hosts'] = list(dict.fromkeys([*access['allowed_hosts'], HOST]))
    access['origins'] = list(dict.fromkeys([*access['origins'], 'https://' + HOST]))
    access['public_origin'] = 'https://' + HOST
    access['public_origin_listener'] = '127.0.0.1:18444'
    values = {'ALLOWED_HOSTS': ','.join(access['allowed_hosts']),
              'ADMIN_ORIGIN': ','.join(access['origins']),
              'PUBLIC_ORIGIN': ','.join(access['origins'])}
    environments = {}
    for service in ('admin', 'public', 'broker'):
        path = PRIVATE / f'{service}.env'
        lines = path.read_text().splitlines(keepends=True)
        for key, value in values.items():
            matches = [i for i, line in enumerate(lines) if line.startswith(key + '=')]
            if len(matches) != 1:
                raise RuntimeError('Existing web environment settings are required.')
            lines[matches[0]] = key + '="' + value + '"\n'
        environments[path] = ''.join(lines)
    edge_path = BASE / 'deploy/Caddyfile'
    edge = edge_path.read_text()
    import_line = 'import /srv/surveey/deploy/Caddyfile.production'
    if import_line not in edge:
        edge += '\n' + import_line + '\n'
    now = datetime.datetime.now(datetime.timezone.utc)
    history = PRIVATE / 'configuration-history' / ('public-origin-' + now.strftime('%Y%m%dT%H%M%S%fZ'))
    history.mkdir(parents=True, mode=0o700)
    for index, path in enumerate([access_file, edge_path, *environments]):
        backup = history / f'{index}-{path.name}'
        shutil.copyfile(path, backup)
        backup.chmod(0o600)
    write(PRIVATE / 'production-dns-before.json', (SOURCE / 'production-dns-before.json').read_text())

    certificate, key = BASE / 'tls/production-origin.crt', BASE / 'tls/production-origin.key'
    if certificate.exists() or key.exists():
        raise RuntimeError('An existing production origin certificate must not be overwritten.')
    result = subprocess.run(['openssl', 'req', '-x509', '-newkey', 'ed25519', '-nodes',
        '-keyout', str(key), '-out', str(certificate), '-days', '365',
        '-subj', '/CN=' + HOST, '-addext', 'subjectAltName=DNS:' + HOST], capture_output=True)
    if result.returncode:
        raise RuntimeError('Production origin certificate creation failed.')
    tls_group = grp.getgrnam('surveey-tls').gr_gid
    os.chown(key, 0, tls_group)
    key.chmod(0o640)
    certificate.chmod(0o644)

    app_group = grp.getgrnam('surveey').gr_gid
    write(BASE / 'deploy/Caddyfile.production', (SOURCE / 'Caddyfile.production').read_text(), 0o640, app_group)
    write(edge_path, edge, 0o640, app_group)
    write(access_file, json.dumps(access, indent=2))
    for path, content in environments.items():
        write(path, content)
    write(PRIVATE / 'cloudflare-tunnel.token', token + '\n')
    binary = BASE / 'runtime/cloudflared'
    if binary.exists():
        raise RuntimeError('An existing Surveey connector binary must not be overwritten.')
    shutil.copyfile(SOURCE / 'cloudflared-linux-amd64', binary)
    os.chown(binary, 0, 0)
    binary.chmod(0o755)
    unit_path = Path('/etc/systemd/system/surveey-tunnel.service')
    if unit_path.exists():
        raise RuntimeError('An existing Surveey tunnel service must not be overwritten.')
    write(unit_path, '''[Unit]
Description=Surveey Cloudflare production connector
Wants=network-online.target surveey-edge.service
After=network-online.target surveey-edge.service
[Service]
Type=simple
DynamicUser=true
User=surveey-tunnel
Slice=surveey.slice
LoadCredential=tunnel-token:/srv/surveey/private/cloudflare-tunnel.token
ExecStart=/srv/surveey/runtime/cloudflared tunnel --no-autoupdate --metrics 127.0.0.1:0 run --token-file %d/tunnel-token
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
MemoryMax=128M
CPUWeight=25
OOMScoreAdjust=500
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectHome=true
ProtectSystem=strict
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
InaccessiblePaths=/srv/surveey/private /srv/surveey/app /srv/surveey/public-app /srv/surveey/media /srv/surveey/postgres /srv/surveey/snapshots
UMask=0077
[Install]
WantedBy=multi-user.target
''', 0o644)
    result = subprocess.run(['systemctl', 'daemon-reload'], capture_output=True)
    if result.returncode:
        raise RuntimeError('Surveey unit registration failed.')
    restart = subprocess.run(['systemctl', 'restart', 'surveey-admin.service', 'surveey-public.service',
        'surveey-broker.service', 'surveey-edge.service'], capture_output=True)
    if restart.returncode:
        raise RuntimeError('Surveey restart command failed; DNS has not been changed by this script.')
    enable = subprocess.run(['systemctl', 'enable', '--now', 'surveey-tunnel.service'], capture_output=True)
    record = {
        'configured_at_utc': now.isoformat(),
        'state': 'connector_start_command_completed_unverified' if enable.returncode == 0 else 'connector_start_command_failed',
        'surveey_restart_exit_code': restart.returncode,
        'connector_enable_start_exit_code': enable.returncode,
        'public_hostname': HOST, 'tunnel_name': 'surveey-niskala-vps', 'tunnel_id': TUNNEL_ID,
        'origin_service': 'https://127.0.0.1:18444',
        'origin_server_name': HOST, 'origin_ca_pool': str(certificate),
        'origin_tls_verification_disabled': False,
        'database_source': 'Railway', 'media_source': 'Railway bucket',
        'niskala_services_modified_or_restarted': False,
        'firewall_or_tailscale_policy_modified': False,
        'railway_configuration_modified': False, 'data_deleted': False,
        'dns_changed_by_this_script': False,
        'functional_tests_performed': False, 'runtime_health_verified': False,
        'configuration_history': str(history),
    }
    write(MARKER, json.dumps(record, indent=2), 0o644)
    print(json.dumps(record), flush=True)
    return enable.returncode


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({'configuration_failed': True, 'error_type': type(error).__name__}), flush=True)
        sys.exit(1)
