"""Bring data/points.geojson in line with the points published from the admin.

Since the admin went live, edits are made there and published from its
database; this repository's GeoJSON is the legacy copy (local preview, the
original import source). This script copies the admin's current state back
into it, touching only fields whose value actually differs, so the diff
shows exactly what changed in the admin.

Usage:
  1. Export the admin state (production shell, read-only):
       railway ssh ... -- python manage.py shell < export.py > export.txt
     where export.py prints, after the prefix EXPORT, a JSON list of
     {"import_nomor": revision 1's nomor, "import_photo": revision 1's
     photo_id, "state": the point's current state} for every point.
  2. python scripts/sync_points_from_admin.py <export.json>

Judgment calls:
- Points are matched on the Nomor they were imported with (revision 1),
  because Nomor now follows the address and may have been renamed since.
- The repository keeps its sparse style: an empty text, an empty Status and
  Duplikat false are written by removing the key, and null, "" and a missing
  key count as equal. Foto Survey Awal is never rewritten for a photo that
  is still the imported one.
- A photo replaced in the admin is downloaded from the public map's /media
  copy (the 720 px display derivative; the original stays private in the
  admin) into images/admin_<photo id>.jpg, and Foto Survey Awal becomes
  admin/<photo id>.jpg, which sanitizes to that file name. Replaced photo
  files stay in images/ as evidence.
"""
import datetime
import json
import sys
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
POINTS = ROOT / 'data' / 'points.geojson'
MEDIA = 'https://survey.esdm.cloud/media/'
TEXT = {'Nomor': 'nomor', 'Nama Anggota': 'nama', 'Jalur': 'jalur', 'Alamat': 'alamat', 'Keterangan': 'keterangan',
    'Lokasi Rekapan': 'lokasi_rekapan', 'Catatan': 'catatan', 'Status': 'status'}

def empty(value):
    return value is None or value == '' or value is False

def put(props, key, value, changes):
    if (empty(props.get(key)) and empty(value)) or props.get(key) == value:
        return
    changes.append(f'{key}: {props.get(key)!r} -> {value!r}')
    if empty(value):
        props.pop(key, None)
    else:
        props[key] = value

rows = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
raw = POINTS.read_bytes()
data = json.loads(raw)
by_nomor = {f['properties']['Nomor']: f for f in data['features']}
assert len(by_nomor) == len(data['features']) == len(rows), (len(by_nomor), len(rows))
changed = 0
for row in sorted(rows, key=lambda r: r['import_nomor']):
    feature, state = by_nomor[row['import_nomor']], row['state']
    props, changes = feature['properties'], []
    for key, field in TEXT.items():
        put(props, key, state[field].strip() if isinstance(state[field], str) else state[field], changes)
    put(props, 'Duplikat', bool(state['duplikat']), changes)
    stamp = datetime.date.fromisoformat(state['date']).strftime('%d/%m/%Y') if state['date'] else ''
    put(props, 'Tanggal Dokumentasi', stamp, changes)
    put(props, 'Longitude', state['lon'], changes)
    put(props, 'Latitude', state['lat'], changes)
    if feature['geometry']['coordinates'] != [state['lon'], state['lat']]:
        feature['geometry']['coordinates'] = [state['lon'], state['lat']]
    if state['photo_id'] != row['import_photo']:
        photo = uuid.UUID(state['photo_id']).hex if state['photo_id'] else ''
        if photo:
            target = ROOT / 'images' / f'admin_{photo}.jpg'
            if not target.exists():
                with urllib.request.urlopen(MEDIA + photo) as response:
                    assert response.headers.get_content_type() == 'image/jpeg', response.headers.get_content_type()
                    target.write_bytes(response.read())
        put(props, 'Foto Survey Awal', f'admin/{photo}.jpg' if photo else '', changes)
    if changes:
        changed += 1
        print(f"{row['import_nomor']}: " + '; '.join(changes))

out = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
POINTS.write_bytes(out + (b'\n' if raw.endswith(b'\n') else b''))
print(f'{changed} of {len(rows)} points updated.')
