"""Build files the login page may load before anyone has signed in.

Everything under /assets/ is otherwise admin-only (AdminBoundary). The login
page draws the province map behind its form, so its entry chunk, the chunks it
imports, their CSS, the files they reference and the two boundary files are
readable anonymously. The set is derived from the Vite manifest's
`src/login.ts` entry, so admin screens (a separate entry) never join it.
"""
import json
from pathlib import Path
from django.conf import settings

ENTRY = 'src/login.ts'
GEOMETRY = ('provinsi.json', 'kabupaten.json')

_cache = {'mtime': None, 'value': None}


def _empty():
    return {'js': [], 'css': [], 'names': frozenset()}


def login_assets():
    """Return {'js': [...], 'css': [...], 'names': frozenset()} of filenames under assets/."""
    manifest = Path(settings.ADMIN_BUILD) / '.vite' / 'manifest.json'
    try:
        mtime = manifest.stat().st_mtime
    except OSError:
        return _empty()
    if _cache['mtime'] == mtime:
        return _cache['value']
    try:
        chunks = json.loads(manifest.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return _empty()
    js, css, files, seen = [], [], set(), set()

    def visit(key, entry):
        if key in seen or key not in chunks:
            return
        seen.add(key)
        chunk = chunks[key]
        for name in chunk.get('imports', []):
            visit(name, False)
        if entry:
            js.append(chunk['file'])
        files.add(chunk['file'])
        for name in chunk.get('css', []):
            if name not in css:
                css.append(name)
            files.add(name)
        files.update(chunk.get('assets', []))

    visit(ENTRY, True)
    names = {f[len('assets/'):] for f in files if f.startswith('assets/') and '/' not in f[len('assets/'):]}
    if names:
        names.update(GEOMETRY)
    value = {'js': [f[len('assets/'):] for f in js], 'css': [f[len('assets/'):] for f in css], 'names': frozenset(names)}
    _cache.update(mtime=mtime, value=value)
    return value
