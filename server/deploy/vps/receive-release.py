#!/usr/bin/python3
"""Root-owned Surveey release receiver. Never imports code from an upload."""
import datetime
import fcntl
import grp
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import pwd
import re
import shutil
import subprocess
import sys
import tarfile

BASE = Path('/srv/surveey')
RELEASES = BASE / 'releases'
UNITS = ('surveey-admin.service', 'surveey-public.service', 'surveey-broker.service',
         'surveey-edge.service')
MAX_ARCHIVE = 256 * 1024 * 1024
MAX_EXPANDED = 512 * 1024 * 1024


def run(arguments, **kwargs):
    return subprocess.run(arguments, check=True, **kwargs)


def atomic_link(path, target):
    temporary = path.with_name(path.name + '.next')
    if temporary.exists() or temporary.is_symlink():
        raise ValueError('A previous switch needs operator attention: ' + str(temporary))
    temporary.symlink_to(target)
    os.replace(temporary, path)


def permitted(name):
    parts = PurePosixPath(name).parts
    if not parts or name.startswith('/') or '..' in parts or '\\' in name:
        return False
    if any(part.startswith('.') and part != '.vite' for part in parts):
        return False
    if parts[0] == 'wheels':
        return len(parts) == 2 and parts[1].endswith('.whl')
    if parts[0] == 'release.json':
        return len(parts) == 1
    if name == 'app/server/requirements.lock':
        return True
    if name.startswith(('app/server/config/', 'app/server/survey/',
                        'app/server/delivery/', 'app/server/templates/', 'app/dist/admin/')):
        return True
    if name.startswith('public-app/server/delivery/'):
        return True
    if name.startswith('public-app/server/config/'):
        return len(parts) == 4 and parts[-1] in (
            '__init__.py', 'base.py', 'public_settings.py', 'public_wsgi.py')
    if name.startswith('static/assets/'):
        return True
    if name.startswith('static/data/'):
        return name in ('static/data/regions.json', 'static/data/regions.json.br')
    return len(parts) == 2 and parts[0] == 'static' and parts[1] in (
        'index.html', 'index.html.br', 'favicon.ico', 'favicon.ico.br',
        'favicon.png', 'favicon.png.br', 'apple-touch-icon.png',
        'apple-touch-icon.png.br', 'manifest.json', 'manifest.json.br', 'sw.js', 'sw.js.br')


def unpack(archive, destination, revision):
    seen = set()
    size = 0
    with tarfile.open(archive, 'r:gz') as source:
        for member in source:
            # No links, devices, directories or extraction APIs accepting paths.
            if (not member.isfile() or not permitted(member.name) or member.name in seen
                    or len(seen) >= 20000 or member.size < 0):
                raise ValueError('Release contains a forbidden archive entry.')
            seen.add(member.name)
            size += member.size
            if size > MAX_EXPANDED:
                raise ValueError('Release exceeds expanded size limit.')
            target = destination / member.name
            target.parent.mkdir(parents=True, exist_ok=True)
            with source.extractfile(member) as incoming, target.open('xb') as output:
                shutil.copyfileobj(incoming, output)
            target.chmod(0o644)
    manifest = json.loads((destination / 'release.json').read_text())
    if manifest != {'format': 1, 'repository': 'bbreezyX/surveey', 'revision': revision}:
        raise ValueError('Release manifest does not match the upload command.')
    for name in ('app/server/config/admin_wsgi.py', 'app/server/config/media_wsgi.py',
                 'public-app/server/config/public_wsgi.py', 'app/dist/admin/.vite/manifest.json',
                 'app/server/requirements.lock', 'static/index.html', 'static/sw.js'):
        if name not in seen:
            raise ValueError('Release is incomplete: ' + name)
    if not any(name.startswith('wheels/') for name in seen):
        raise ValueError('Release has no Python wheels.')
    for name, group in (('app', 'surveey'), ('public-app', 'surveey-public')):
        directory = destination / name
        gid = grp.getgrnam(group).gr_gid
        for path in (directory, *directory.rglob('*')):
            os.chown(path, 0, gid)
            path.chmod(0o750 if path.is_dir() else 0o640)


def install_python(destination, identifier):
    account = pwd.getpwnam('surveey-deploy')
    venv = destination / 'venv'
    venv.mkdir(mode=0o755)
    os.chown(venv, account.pw_uid, account.pw_gid)
    # Copy only the lock file into a readable installer area. Private app files
    # remain unreadable to this account; wheels and root-owned code are data.
    lock = destination / 'wheels/requirements.lock'
    shutil.copyfile(destination / 'app/server/requirements.lock', lock)
    lock.chmod(0o644)
    shell = ('/usr/bin/python3 -m venv --without-pip "$1/venv" && '
             '/srv/surveey/runtime/python/bin/python -m pip --python "$1/venv" --isolated install --no-index '
             '--find-links "$1/wheels" --only-binary=:all: --no-cache-dir '
             '--disable-pip-version-check --no-compile -r "$1/wheels/requirements.lock"')
    run(['/usr/bin/systemd-run', '--quiet', '--wait', '--collect', '--pipe',
         '--unit=surveey-install-' + identifier,
         '--property=User=surveey-deploy', '--property=Group=surveey-deploy',
         '--property=Slice=surveey.slice', '--property=CPUQuota=25%',
         '--property=CPUWeight=10', '--property=IOWeight=10',
         '--property=MemoryMax=192M', '--property=MemorySwapMax=64M',
         '--property=RuntimeMaxSec=300', '--property=NoNewPrivileges=yes',
         '--property=PrivateTmp=yes', '--property=ProtectHome=yes',
         '--property=ProtectSystem=strict', '--property=ReadWritePaths=' + str(venv),
         '--property=InaccessiblePaths=/srv/niskala-udara /srv/surveey/private /srv/surveey/media /srv/surveey/postgres /srv/surveey/snapshots',
         '/bin/bash', '-c', shell, 'install-surveey', str(destination)])
    # A wheel may contain symlinks; never follow them while fixing ownership.
    for directory, directories, files in os.walk(venv, followlinks=False):
        os.chown(directory, 0, 0)
        for name in directories + files:
            os.chown(Path(directory) / name, 0, 0, follow_symlinks=False)


def prepare_layout():
    if (BASE / 'current').is_symlink():
        return (BASE / 'current').resolve(strict=True)
    if (BASE / 'current').exists():
        raise ValueError('The current release path must be a symlink.')
    baseline = RELEASES / 'before-autodeploy'
    if baseline.exists():
        raise ValueError('An interrupted initial switch needs operator attention.')
    baseline.mkdir(mode=0o755)
    (baseline / 'venv').symlink_to(BASE / 'runtime/python')
    atomic_link(BASE / 'current', baseline)
    moved = []
    try:
        for name in ('app', 'public-app', 'static'):
            original = BASE / name
            if original.is_symlink() or not original.is_dir():
                raise ValueError('Unexpected legacy application path.')
            os.rename(original, baseline / name)
            moved.append(name)
            original.symlink_to(BASE / 'current' / name)
    except Exception:
        for name in reversed(moved):
            path = BASE / name
            if path.is_symlink():
                path.unlink()
            os.rename(baseline / name, path)
        (BASE / 'current').unlink()
        raise
    return baseline


def install_unit_overrides():
    for name, application, port in (('admin', 'admin', 18490), ('public', 'public', 18492),
                                     ('broker', 'media', 18491)):
        directory = Path(f'/etc/systemd/system/surveey-{name}.service.d')
        directory.mkdir(exist_ok=True)
        tls = (' --certfile /srv/surveey/tls/preview.crt --keyfile /srv/surveey/tls/preview.key'
               if name != 'broker' else '')
        path = directory / '40-release-runtime.conf'
        content = ('[Service]\nExecStart=\nExecStart=/srv/surveey/current/venv/bin/gunicorn '
                   f'config.{application}_wsgi:application --bind 127.0.0.1:{port} '
                   '--workers 1 --threads 1 --timeout 60 --forwarded-allow-ips= '
                   '--no-control-socket --error-logfile -' + tls + '\n')
        path.write_text(content)
        path.chmod(0o644)
    run(['/usr/bin/systemctl', 'daemon-reload'])


def activate(destination):
    # Layout conversion is deferred until a real push, after candidate install.
    # Include Surveey's own edge: its Requires= dependencies stop it when the
    # backends stop, so it must be started again along with them. Niskala's shared
    # Caddy, the tunnel, database, and media are outside this operation.
    run(['/usr/bin/systemctl', 'stop', *UNITS])
    previous = None
    try:
        previous = prepare_layout()
        install_unit_overrides()
        atomic_link(BASE / 'previous', previous)
        atomic_link(BASE / 'current', destination)
        run(['/usr/bin/systemctl', 'start', *UNITS])
    except Exception:
        if previous is not None:
            atomic_link(BASE / 'current', previous)
        run(['/usr/bin/systemctl', 'start', *UNITS])
        raise
    return previous


def main():
    if os.geteuid() != 0 or len(sys.argv) != 5 or sys.argv[1] != 'receive':
        raise SystemExit('Only a root receive operation is supported.')
    revision, run_id, digest = sys.argv[2:]
    if not (re.fullmatch(r'[a-f0-9]{40}', revision)
            and re.fullmatch(r'[0-9]{1,20}-[0-9]{1,5}', run_id)
            and re.fullmatch(r'[a-f0-9]{64}', digest)):
        raise SystemExit('Invalid release identity.')
    os.umask(0o022)
    # Refuse alternate data modes and never configure, migrate or restore data.
    if not (BASE / 'HYBRID_CONFIGURED.json').is_file():
        raise SystemExit('This receiver requires the existing Railway-data deployment.')
    RELEASES.mkdir(mode=0o755, exist_ok=True)
    with (BASE / 'private/autodeploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if shutil.disk_usage(BASE).free < 2 * 1024**3:
            raise SystemExit('Less than 2 GiB free. Existing releases/data will not be deleted.')
        identifier = revision[:12] + '-' + run_id
        destination = RELEASES / identifier
        destination.mkdir(mode=0o755)
        archive = destination / 'upload.tar.gz'
        calculated = hashlib.sha256()
        total = 0
        with archive.open('xb') as output:
            archive.chmod(0o600)
            while block := sys.stdin.buffer.read(1024 * 1024):
                total += len(block)
                if total > MAX_ARCHIVE:
                    raise ValueError('Compressed release exceeds limit.')
                calculated.update(block)
                output.write(block)
        if calculated.hexdigest() != digest:
            raise ValueError('Incomplete or corrupted upload; active release unchanged.')
        unpack(archive, destination, revision)
        install_python(destination, identifier)
        previous = activate(destination)
        record = {'revision': revision, 'run': run_id, 'release': str(destination),
                  'previous': str(previous), 'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  'tests_or_health_checks': 'Not performed', 'database_migration': False}
        (destination / 'activated.json').write_text(json.dumps(record, indent=2) + '\n')
        print(json.dumps(record), flush=True)


if __name__ == '__main__':
    main()
