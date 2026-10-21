"""Configure inactive VPS apps to use Railway DB roles and the Railway media bucket.

Receives only selected application credentials as JSON on stdin. No DB connection,
bucket operation, migration, app start, source restart, or validation is performed.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from urllib.parse import unquote, urlsplit

BASE = Path('/srv/surveey')
PRIVATE = BASE / 'private'
ENDPOINT = PRIVATE / 'railway-db-endpoint.json'


def private_write(path, content):
    temporary = path.with_name(path.name + '.incoming')
    descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, 'w') as output:
        output.write(content)
    os.replace(temporary, path)


def environment_file(values):
    result = []
    for key, value in values.items():
        if not isinstance(value, str) or any(char in value for char in ('\n', '\r', '\x00')):
            raise ValueError('Environment values must be single-line strings.')
        result.append(key + '="' + value.replace('\\', '\\\\').replace('"', '\\"') + '"\n')
    return ''.join(result)


def database_url(source, endpoint):
    if endpoint is None:
        return source
    parsed = urlsplit(source)
    credentials = parsed.netloc.rsplit('@', 1)[0]
    return parsed._replace(netloc=credentials + '@' + endpoint['host'] + ':' + str(endpoint['port'])).geturl()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--db-host')
    parser.add_argument('--db-port', type=int)
    options = parser.parse_args()
    if os.geteuid() != 0 or not (BASE / 'CONFIGURED.json').is_file():
        raise RuntimeError('The previously prepared, isolated Surveey VPS is required.')
    source = json.load(sys.stdin)
    admin = source['admin']
    public = source['public']
    admin_db, public_db = urlsplit(admin['DATABASE_URL']), urlsplit(public['DATABASE_URL'])
    if any(value.scheme not in ('postgres', 'postgresql') or not value.hostname or
            not value.username or not value.password for value in (admin_db, public_db)):
        raise ValueError('Separate application database connection strings are required.')
    if (admin_db.hostname != public_db.hostname or admin_db.path != public_db.path or
            unquote(admin_db.username) == unquote(public_db.username) or
            any(unquote(value.username) in ('postgres', 'railway', source['operator_username'])
                for value in (admin_db, public_db))):
        raise ValueError('Use existing separate application roles, never the database operator.')
    if len(admin['DJANGO_SECRET_KEY']) < 50 or not admin['S3_ENDPOINT'].startswith('https://'):
        raise ValueError('Existing production session signing and HTTPS storage are required.')
    endpoint = json.loads(ENDPOINT.read_text()) if ENDPOINT.exists() else None
    if options.db_host or options.db_port:
        if (not options.db_host or not re.fullmatch(r'[a-z0-9.-]+\.proxy\.rlwy\.net', options.db_host)
                or not options.db_port or not 1 <= options.db_port <= 65535):
            raise ValueError('Use only the actual Railway TCP proxy endpoint returned by Railway.')
        endpoint = {'host': options.db_host, 'port': options.db_port,
            'source_service': 'ca38ef07-1f75-4191-a905-af3a9af4a423', 'connection_tested': False}
    target = json.loads((PRIVATE / 'target-secrets.json').read_text())
    access_file = PRIVATE / 'web-access.json'
    access = json.loads(access_file.read_text()) if access_file.exists() else {
        'allowed_hosts': ['surveey.localhost', '127.0.0.1'],
        'origins': ['https://surveey.localhost:18443']}
    common = {'SURVEY_DEPLOYMENT': 'vps', 'SURVEY_DATA_SOURCE': 'railway',
        'ALLOWED_HOSTS': ','.join(access['allowed_hosts']),
        'ADMIN_ORIGIN': ','.join(access['origins']), 'PUBLIC_ORIGIN': ','.join(access['origins']),
        'DB_SSLMODE': 'require', 'MEDIA_BROKER_TOKEN': target['broker_token'],
        'MEDIA_BROKER_URL': 'http://127.0.0.1:18491', 'PYTHONDONTWRITEBYTECODE': '1'}
    storage = {key: admin[key] for key in ('S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY')}
    storage.update({key: admin.get(key, default) for key, default in
        (('S3_REGION', 'auto'), ('S3_ADDRESSING_STYLE', 'virtual'))})
    environments = {}
    for name, source_url, django_key, module in [
        ('admin', admin['DATABASE_URL'], admin['DJANGO_SECRET_KEY'], 'admin'),
        ('public', public['DATABASE_URL'], target['public_django_key'], 'public'),
        ('broker', public['DATABASE_URL'], target['broker_django_key'], 'media')]:
        values = {**common, 'DATABASE_URL': database_url(source_url, endpoint),
            'DJANGO_SECRET_KEY': django_key, 'DJANGO_SETTINGS_MODULE': f'config.{module}_settings'}
        if name != 'public':
            values.update(storage)
        environments[name] = environment_file(values)

    now = datetime.datetime.now(datetime.timezone.utc)
    history = PRIVATE / 'configuration-history' / now.strftime('%Y%m%dT%H%M%S%fZ')
    history.mkdir(parents=True, mode=0o700)
    history.parent.chmod(0o700)
    for name in ('admin', 'public', 'broker'):
        path = PRIVATE / f'{name}.env'
        if path.exists():
            shutil.copyfile(path, history / path.name)
            (history / path.name).chmod(0o600)
        private_write(path, environments[name])

    units = {}
    for name, user, application, port, memory in [
        ('admin', 'surveey', 'config.admin_wsgi:application', 18490, 320),
        ('public', 'surveey-public', 'config.public_wsgi:application', 18492, 160),
        ('broker', 'surveey', 'config.media_wsgi:application', 18491, 128)]:
        root = BASE / ('public-app' if name == 'public' else 'app')
        threads = 4 if name == 'admin' else 2
        tls = '' if name == 'broker' else f' --certfile {BASE}/tls/preview.crt --keyfile {BASE}/tls/preview.key'
        inaccessible = f'{BASE}/media {BASE}/postgres {BASE}/snapshots'
        if name == 'public':
            inaccessible += f' {BASE}/private {BASE}/app'
        units[f'surveey-{name}.service'] = f'''[Unit]
Description=Surveey {name} using Railway data
Wants=network-online.target
After=network-online.target
ConditionPathExists={ENDPOINT}
[Service]
User={user}
Group={user}
Slice=surveey.slice
WorkingDirectory={root}/server
EnvironmentFile={PRIVATE}/{name}.env
ExecStart={BASE}/runtime/python/bin/gunicorn {application} --bind 127.0.0.1:{port} --worker-class gthread --workers 1 --threads {threads} --timeout 60 --forwarded-allow-ips= --no-control-socket --error-logfile -{tls}
Restart=on-failure
RestartSec=5
MemoryMax={memory}M
OOMScoreAdjust=500
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/tmp
InaccessiblePaths={inaccessible}
UMask=0077
[Install]
WantedBy=multi-user.target
'''
    units['surveey-edge.service'] = f'''[Unit]
Description=Surveey private HTTPS using Railway data
Requires=surveey-admin.service surveey-public.service surveey-broker.service
Wants=tailscaled.service
After=tailscaled.service surveey-admin.service surveey-public.service surveey-broker.service
ConditionPathExists={ENDPOINT}
[Service]
User=surveey
Group=surveey
Slice=surveey.slice
Environment=XDG_DATA_HOME=/tmp/surveey-caddy
Environment=XDG_CONFIG_HOME=/tmp/surveey-caddy-config
ExecStart=/usr/bin/caddy run --config {BASE}/deploy/Caddyfile --adapter caddyfile
Restart=on-failure
RestartSec=5
MemoryMax=64M
OOMScoreAdjust=500
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/tmp
[Install]
WantedBy=multi-user.target
'''
    units['surveey.slice'] = '''[Unit]
Description=Surveey VPS application resource budget
[Slice]
CPUWeight=25
CPUQuota=75%
IOWeight=25
MemoryHigh=512M
MemoryMax=704M
MemorySwapMax=128M
'''
    for name, content in units.items():
        path = Path('/etc/systemd/system') / name
        if path.exists():
            shutil.copyfile(path, history / name)
        path.write_text(content)
    if endpoint is not None:
        private_write(ENDPOINT, json.dumps(endpoint, indent=2))
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
    record = {'configured_at_utc': now.isoformat(), 'deployment': 'VPS applications with Railway data',
        'database_source': 'Railway', 'media_source': 'Railway bucket',
        'database_endpoint_configured': endpoint is not None,
        'state': 'configured_inactive' if endpoint else 'pending_database_endpoint',
        'services_started': False, 'services_enabled': False, 'local_postgres_required': False,
        'source_schema_or_data_modified': False, 'tests_or_validation': 'Not performed'}
    (BASE / 'HYBRID_CONFIGURED.json').write_text(json.dumps(record, indent=2))
    print(json.dumps(record), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Parsing errors may contain connection strings. Keep credentials out of output.
        print(json.dumps({'configuration_failed': True, 'error_type': type(error).__name__}), flush=True)
        sys.exit(1)
