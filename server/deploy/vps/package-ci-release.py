"""Package built code only; never copy local env, original photos or live data."""
import io
import json
import os
from pathlib import Path
import re
import tarfile

ROOT = Path(__file__).resolve().parents[3]
revision = os.environ['GITHUB_SHA']
if not re.fullmatch(r'[a-f0-9]{40}', revision):
    raise SystemExit('GITHUB_SHA must be a full commit SHA.')
output = ROOT / '.local/surveey-release.tar.gz'
output.parent.mkdir(exist_ok=True)


def add_file(archive, source, target):
    if source.is_symlink() or not source.is_file():
        raise ValueError(f'Required regular file missing: {source.relative_to(ROOT)}')
    archive.add(source, arcname=target, recursive=False)


def add_tree(archive, source, target):
    for path in sorted(source.rglob('*')):
        if '__pycache__' in path.parts or path.suffix == '.pyc':
            continue
        if path.is_symlink():
            raise ValueError('Symlinks may not be packaged.')
        if path.is_file():
            add_file(archive, path, f'{target}/{path.relative_to(source).as_posix()}')


with tarfile.open(output, 'w:gz', compresslevel=3) as archive:
    for name in ('config', 'survey', 'delivery', 'templates'):
        add_tree(archive, ROOT / 'server' / name, f'app/server/{name}')
    add_file(archive, ROOT / 'server/requirements.lock', 'app/server/requirements.lock')
    add_tree(archive, ROOT / 'dist/admin', 'app/dist/admin')
    # The public process never receives survey/account/admin modules or secrets.
    for name in ('__init__.py', 'base.py', 'public_settings.py', 'public_wsgi.py'):
        add_file(archive, ROOT / 'server/config' / name, f'public-app/server/config/{name}')
    add_tree(archive, ROOT / 'server/delivery', 'public-app/server/delivery')
    public = ROOT / 'dist/public'
    add_tree(archive, public / 'assets', 'static/assets')
    for name in ('index.html', 'favicon.ico', 'favicon.png', 'apple-touch-icon.png',
                 'manifest.json', 'sw.js'):
        add_file(archive, public / name, f'static/{name}')
        if (public / f'{name}.br').is_file():
            add_file(archive, public / f'{name}.br', f'static/{name}.br')
    for name in ('regions.json', 'regions.json.br'):
        add_file(archive, public / 'data' / name, f'static/data/{name}')
    # /data/points.geojson and /media/* always use Railway-backed live delivery.
    for wheel in sorted((ROOT / '.local/vps-wheels').glob('*.whl')):
        add_file(archive, wheel, f'wheels/{wheel.name}')
    content = json.dumps({'format': 1, 'repository': 'bbreezyX/surveey',
                          'revision': revision}).encode()
    member = tarfile.TarInfo('release.json')
    member.size = len(content)
    member.mode = 0o644
    archive.addfile(member, io.BytesIO(content))
print(f'Packaged release {revision}: {output.stat().st_size} bytes')
