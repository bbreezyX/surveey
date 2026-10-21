"""Prepare inactive units, then optionally restore a fresh independent database."""
import argparse
import datetime
import grp
import json
import os
from pathlib import Path
import pwd
import secrets
import shutil
import subprocess

BASE = Path('/srv/surveey')
PG = BASE / 'runtime/postgres'
BIN = PG / 'usr/lib/postgresql/18/bin'
PYTHON = BASE / 'runtime/python/bin/python'
PRIVATE = BASE / 'private'
DATA = BASE / 'postgres'
SNAPSHOT = BASE / 'snapshots/initial'


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def private_write(path, text, mode=0o600):
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, mode)
    with os.fdopen(descriptor, 'w') as output:
        output.write(text)


parser = argparse.ArgumentParser()
parser.add_argument('--configure-only', action='store_true', help='Do not start or restore PostgreSQL.')
options = parser.parse_args()
if os.geteuid() != 0 or (BASE / 'PREPARED.json').exists():
    raise SystemExit('Run as root only for a new, unprepared Surveey copy.')
if (BASE / 'HYBRID_CONFIGURED.json').exists():
    raise SystemExit('This VPS uses Railway data. Do not restore or start the local PostgreSQL copy.')
if not options.configure_only and not (SNAPSHOT / 'survey.dump').is_file():
    raise SystemExit('Database export is not available. Use --configure-only to prepare inactive units.')
if not (BASE / 'CONFIGURED.json').exists():
    run([str(PYTHON), '-m', 'pip', '--isolated', 'install', '--index-url', 'https://pypi.org/simple',
         '--disable-pip-version-check', '--no-cache-dir', '-r', str(BASE / 'app/server/requirements.lock')])

try:
    grp.getgrnam('surveey-tls')
except KeyError:
    run(['groupadd', '--system', 'surveey-tls'])
for name in ('surveey', 'surveey-public'):
    run(['usermod', '--append', '--groups', 'surveey-tls', name])
tls_group = grp.getgrnam('surveey-tls').gr_gid
certificate = BASE / 'tls/preview.crt'
key = BASE / 'tls/preview.key'
if not key.exists():
    run(['openssl', 'req', '-x509', '-newkey', 'ed25519', '-noenc', '-days', '90',
         '-subj', '/CN=surveey.localhost', '-addext', 'subjectAltName=DNS:surveey.localhost,IP:127.0.0.1',
         '-addext', 'basicConstraints=critical,CA:TRUE', '-keyout', str(key), '-out', str(certificate)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
os.chown(key, 0, tls_group)
key.chmod(0o640)
certificate.chmod(0o644)

secret_path = PRIVATE / 'target-secrets.json'
if not secret_path.exists():
    private_write(secret_path, json.dumps({name: secrets.token_urlsafe(48) for name in
        ('operator_password', 'admin_password', 'public_password', 'admin_django_key',
         'public_django_key', 'broker_django_key', 'broker_token')}, indent=2))
credentials = json.loads(secret_path.read_text())

common = {'SURVEY_DEPLOYMENT': 'vps', 'SURVEY_MEDIA_ROOT': '/srv/surveey/media',
    'ALLOWED_HOSTS': 'surveey.localhost,127.0.0.1',
    'ADMIN_ORIGIN': 'https://surveey.localhost:18443', 'PUBLIC_ORIGIN': 'https://surveey.localhost:18443',
    'DB_SSLMODE': 'require', 'MEDIA_BROKER_TOKEN': credentials['broker_token'],
    'MEDIA_BROKER_URL': 'http://127.0.0.1:18491', 'PYTHONDONTWRITEBYTECODE': '1'}
for name, user, password_key, django_key, module in [
    ('admin', 'survey_admin_app', 'admin_password', 'admin_django_key', 'admin'),
    ('public', 'survey_public_app', 'public_password', 'public_django_key', 'public'),
    ('broker', 'survey_public_app', 'public_password', 'broker_django_key', 'media')]:
    values = {**common, 'DATABASE_URL': f'postgresql://{user}:{credentials[password_key]}@127.0.0.1:15433/surveey_copy',
        'DJANGO_SECRET_KEY': credentials[django_key], 'DJANGO_SETTINGS_MODULE': f'config.{module}_settings'}
    path = PRIVATE / f'{name}.env'
    if not path.exists():
        private_write(path, ''.join(f'{k}={v}\n' for k, v in values.items()))

db_account = pwd.getpwnam('surveey-db')
environment = {**os.environ, 'LD_LIBRARY_PATH': str(PG / 'usr/lib/x86_64-linux-gnu'),
    'PGPASSWORD': credentials['operator_password'], 'PGSSLMODE': 'require'}
if not (DATA / 'PG_VERSION').exists():
    password_file = BASE / 'run/initdb-password'
    if not password_file.exists():
        private_write(password_file, credentials['operator_password'] + '\n')
    os.chown(password_file, db_account.pw_uid, db_account.pw_gid)
    run(['runuser', '-u', 'surveey-db', '--', str(BIN / 'initdb'), '-D', str(DATA),
         '-L', str(PG / 'usr/share/postgresql/18'), '--username=surveey_operator',
         '--auth-local=peer', '--auth-host=scram-sha-256', '--encoding=UTF8', '--locale=C.UTF-8',
         '--pwfile=' + str(password_file)], env=environment)
    password_file.unlink()
    run(['openssl', 'req', '-x509', '-newkey', 'ed25519', '-noenc', '-days', '365',
         '-subj', '/CN=surveey-private-db', '-keyout', str(DATA / 'server.key'),
         '-out', str(DATA / 'server.crt')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for name in ('server.key', 'server.crt'):
        os.chown(DATA / name, db_account.pw_uid, db_account.pw_gid)
        (DATA / name).chmod(0o600)
    with (DATA / 'postgresql.conf').open('a') as output:
        output.write("\nlisten_addresses='127.0.0.1'\nport=15433\nunix_socket_directories='/srv/surveey/run'\n"
            "shared_buffers='32MB'\nwork_mem='2MB'\nmaintenance_work_mem='32MB'\nmax_connections=20\n"
            "max_parallel_workers=1\nmax_worker_processes=4\nmax_wal_size='128MB'\nmin_wal_size='32MB'\n"
            "ssl=on\nssl_cert_file='server.crt'\nssl_key_file='server.key'\nlog_min_messages=warning\n")

slice_text = '''[Unit]
Description=Surveey independent staging resource budget
[Slice]
CPUWeight=25
CPUQuota=75%
IOWeight=25
MemoryHigh=640M
MemoryMax=896M
MemorySwapMax=256M
'''
Path('/etc/systemd/system/surveey.slice').write_text(slice_text)
library_path = str(PG / 'usr/lib/x86_64-linux-gnu')
postgres_unit = f'''[Unit]
Description=Surveey private PostgreSQL copy
After=network.target
[Service]
Type=forking
User=surveey-db
Group=surveey-db
Slice=surveey.slice
Environment=LD_LIBRARY_PATH={library_path}
ExecStart={BIN}/pg_ctl -D {DATA} -l {DATA}/server.log -w start
ExecStop={BIN}/pg_ctl -D {DATA} -m fast -w stop
PIDFile={DATA}/postmaster.pid
MemoryMax=224M
OOMScoreAdjust=500
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths={DATA} {BASE}/run
TimeoutStartSec=90
TimeoutStopSec=60
[Install]
WantedBy=multi-user.target
'''
Path('/etc/systemd/system/surveey-postgres.service').write_text(postgres_unit)

for name, user, application, port, memory in [
    ('admin', 'surveey', 'config.admin_wsgi:application', 18490, 320),
    ('public', 'surveey-public', 'config.public_wsgi:application', 18492, 160),
    ('broker', 'surveey', 'config.media_wsgi:application', 18491, 128)]:
    application_root = BASE / ('public-app' if name == 'public' else 'app')
    tls_arguments = '' if name == 'broker' else f' --certfile {certificate} --keyfile {key}'
    restrictions = ('\nInaccessiblePaths=/srv/surveey/media /srv/surveey/private /srv/surveey/snapshots /srv/surveey/app'
        if name == 'public' else '')
    writable = ' /srv/surveey/media' if name in ('admin', 'broker') else ''
    unit = f'''[Unit]
Description=Surveey isolated {name} copy
Requires=surveey-postgres.service
After=surveey-postgres.service
[Service]
User={user}
Group={user}
Slice=surveey.slice
WorkingDirectory={application_root}/server
EnvironmentFile={PRIVATE}/{name}.env
ExecStart={BASE}/runtime/python/bin/gunicorn {application} --bind 127.0.0.1:{port} --workers 1 --threads 1 --timeout 60 --forwarded-allow-ips= --no-control-socket --error-logfile -{tls_arguments}
Restart=on-failure
RestartSec=5
MemoryMax={memory}M
OOMScoreAdjust=500
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/tmp{writable}
UMask=0077{restrictions}
[Install]
WantedBy=multi-user.target
'''
    Path(f'/etc/systemd/system/surveey-{name}.service').write_text(unit)

edge = f'''[Unit]
Description=Surveey loopback HTTPS preview
Requires=surveey-admin.service surveey-public.service surveey-broker.service
After=surveey-admin.service surveey-public.service surveey-broker.service
[Service]
User=surveey
Group=surveey
Slice=surveey.slice
Environment=XDG_DATA_HOME=/tmp/surveey-caddy
Environment=XDG_CONFIG_HOME=/tmp/surveey-caddy-config
ExecStart=/usr/bin/caddy run --config {BASE}/deploy/Caddyfile --adapter caddyfile
Restart=on-failure
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
Path('/etc/systemd/system/surveey-edge.service').write_text(edge)
run(['systemctl', 'daemon-reload'])

if not (BASE / 'CONFIGURED.json').exists():
    private_write(BASE / 'CONFIGURED.json', json.dumps({
        'configured_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'database_restored': False, 'services_enabled': False, 'services_started': False,
        'tests_or_validation': 'Not performed', 'source': 'Separate Railway export required.'
    }, indent=2), mode=0o644)
if options.configure_only:
    print('Private runtime, empty PostgreSQL cluster and inactive Surveey units configured; no service started.', flush=True)
    raise SystemExit(0)

# Only a new isolated target is restored. No Railway connection is used here.
if (PRIVATE / 'restore-started').exists():
    raise SystemExit('A previous restore needs operator attention; existing target data will not be overwritten.')
private_write(PRIVATE / 'restore-started', datetime.datetime.now(datetime.timezone.utc).isoformat())
run(['systemctl', 'start', 'surveey-postgres.service'])
connection = ['-h', '127.0.0.1', '-p', '15433', '-U', 'surveey_operator']
try:
    run([str(BIN / 'psql'), *connection, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
        input='CREATE DATABASE surveey_copy OWNER surveey_operator TEMPLATE template0;\n', text=True, env=environment)
    run([str(BIN / 'pg_restore'), *connection, '--no-owner', '--no-acl', '--exit-on-error',
         '--dbname=surveey_copy', str(SNAPSHOT / 'survey.dump')], env=environment)
    roles = (BASE / 'app/server/deploy/roles.sql').read_text()
    roles += f"\nCREATE ROLE survey_admin_app LOGIN PASSWORD '{credentials['admin_password']}';\n"
    roles += f"CREATE ROLE survey_public_app LOGIN PASSWORD '{credentials['public_password']}';\n"
    roles += '''GRANT survey_admin_write TO survey_admin_app;
GRANT survey_public_read TO survey_public_app;
REVOKE CONNECT ON DATABASE surveey_copy FROM PUBLIC;
GRANT CONNECT ON DATABASE surveey_copy TO survey_admin_app, survey_public_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
'''
    run([str(BIN / 'psql'), *connection, '-d', 'surveey_copy', '-v', 'ON_ERROR_STOP=1'],
        input=roles, text=True, env=environment, stdout=subprocess.DEVNULL)
finally:
    run(['systemctl', 'stop', 'surveey-postgres.service'])

snapshot = json.loads((SNAPSHOT / 'snapshot.json').read_text())
record = {'prepared_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'source_snapshot_at_utc': snapshot['captured_at_utc'], 'media_objects': snapshot['object_count'],
    'media_bytes': snapshot['media_bytes'], 'database_restored': True,
    'services_enabled': False, 'services_started': False, 'tests_or_validation': 'Not performed',
    'railway_changes': 'None', 'niskala_configuration_changes': 'None'}
private_write(BASE / 'PREPARED.json', json.dumps(record, indent=2), mode=0o644)
print(json.dumps(record), flush=True)
