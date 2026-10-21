"""Install application-owned runtimes without changing shared OS packages or services."""
import hashlib
import json
import gzip
import os
from pathlib import Path
import platform
import pwd
import re
import shutil
import subprocess
import urllib.request

BASE = Path('/srv/surveey')
PG = BASE / 'runtime/postgres'
PACKAGES = BASE / 'runtime/packages'


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


if os.geteuid() != 0 or platform.machine() != 'x86_64':
    raise SystemExit('This preparation requires root on the selected x86_64 VPS.')
BASE.mkdir(mode=0o755, exist_ok=True)
if (BASE / 'PREPARED.json').exists():
    raise SystemExit('An existing prepared copy must not be overwritten.')
for directory in ('runtime', 'runtime/packages', 'app', 'static', 'tls', 'deploy', 'private', 'snapshots'):
    path = BASE / directory
    path.mkdir(parents=True, exist_ok=True)
    path.chmod(0o700 if directory in ('private', 'snapshots') else 0o755)
for name in ('surveey', 'surveey-public', 'surveey-db'):
    try:
        pwd.getpwnam(name)
    except KeyError:
        run(['useradd', '--system', '--no-create-home', '--user-group', '--home-dir', str(BASE),
             '--shell', '/usr/sbin/nologin', name])
for directory, owner, mode in [('media', 'surveey', 0o700), ('postgres', 'surveey-db', 0o700),
                              ('run', 'surveey-db', 0o755)]:
    path = BASE / directory
    path.mkdir(exist_ok=True)
    entry = pwd.getpwnam(owner)
    os.chown(path, entry.pw_uid, entry.pw_gid)
    path.chmod(mode)

url = 'https://apt.postgresql.org/pub/repos/apt/dists/noble-pgdg/main/binary-amd64/Packages.gz'
with urllib.request.urlopen(url, timeout=60) as response:
    index = gzip.decompress(response.read()).decode()
selected = {}
for stanza in index.split('\n\n'):
    fields = dict(line.split(': ', 1) for line in stanza.splitlines() if ': ' in line and not line.startswith(' '))
    name = fields.get('Package')
    if name in ('postgresql-18', 'postgresql-client-18', 'libpq5') and name not in selected:
        selected[name] = fields
if len(selected) != 3:
    raise SystemExit('The official repository did not provide the required PostgreSQL packages.')
PG.mkdir(parents=True, exist_ok=True)
for name, info in selected.items():
    target = PACKAGES / Path(info['Filename']).name
    if not target.exists():
        with urllib.request.urlopen('https://apt.postgresql.org/pub/repos/apt/' + info['Filename'], timeout=120) as source:
            with target.open('wb') as output:
                shutil.copyfileobj(source, output)
    # Package integrity is part of dependency installation, not an application test.
    if hashlib.sha256(target.read_bytes()).hexdigest() != info['SHA256']:
        raise SystemExit('Downloaded PostgreSQL package does not match repository metadata.')
    run(['dpkg-deb', '--extract', str(target), str(PG)])

library_path = str(PG / 'usr/lib/x86_64-linux-gnu')
environment = {**os.environ, 'LD_LIBRARY_PATH': library_path}
missing_packages = set()
library_packages = {'libicu': 'libicu74', 'libldap': 'libldap2', 'liblber': 'libldap2',
    'libxml2': 'libxml2', 'libxslt': 'libxslt1.1', 'liblz4': 'liblz4-1', 'libzstd': 'libzstd1',
    'libssl': 'libssl3t64', 'libcrypto': 'libssl3t64', 'liburing': 'liburing2',
    'libreadline': 'libreadline8t64', 'libedit': 'libedit2'}
for executable in ('postgres', 'initdb', 'pg_ctl', 'pg_restore', 'psql'):
    result = run(['ldd', str(PG / 'usr/lib/postgresql/18/bin' / executable)],
                 env=environment, capture_output=True, text=True)
    for line in result.stdout.splitlines():
        if 'not found' not in line:
            continue
        library = line.split()[0]
        package = next((package for prefix, package in library_packages.items() if library.startswith(prefix)), None)
        if not package:
            raise SystemExit('A required runtime library needs an explicit package mapping: ' + library)
        missing_packages.add(package)
for package in sorted(missing_packages):
    run(['apt-get', 'download', package], cwd=PACKAGES)
    for deb in PACKAGES.glob(package + '_*.deb'):
        run(['dpkg-deb', '--extract', str(deb), str(PG)])

venv = BASE / 'runtime/python'
if not (venv / 'bin/python').exists():
    run(['python3', '-m', 'venv', '--without-pip', str(venv)])
    installer = PACKAGES / 'get-pip.py'
    with urllib.request.urlopen('https://bootstrap.pypa.io/get-pip.py', timeout=60) as response:
        installer.write_bytes(response.read())
    run([str(venv / 'bin/python'), str(installer), '--disable-pip-version-check'])
(BASE / 'runtime/packages.json').write_text(json.dumps({name: data['Version'] for name, data in selected.items()}, indent=2))
print('Private PostgreSQL and Python runtimes prepared; shared OS packages and Niskala services were not changed.', flush=True)
