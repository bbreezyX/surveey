"""Build server/survey/data/wilayah-jambi.json for the admin's address picker.

Source: cahyadsn/wilayah `db/wilayah.sql` (MIT), which transcribes the
Kepmendagri No 300.2.2-2138 Tahun 2025 region codes. Only province 15
(Jambi) is kept: the map covers nothing else, and the whole province is
small enough (~1.6k villages) to ship as one file the admin loads once.

Usage: python scripts/build_wilayah_jambi.py <path-to-wilayah.sql>

Judgment calls:
- Desa vs kelurahan comes from the code, not the name: the last segment of
  a village code starts with 1 for a kelurahan and 2 for a desa. They are
  written "Kel. X" / "Desa X", the prefixes the 550 existing addresses use.
- The source writes "Batanghari"; the regency's legal name, and every
  existing address, is "Batang Hari", so that one name is overridden.
- After building, every kabupaten/kecamatan named in data/points.geojson
  addresses is looked up and the misses are printed. They are reported, not
  fixed: an existing address that does not match simply leaves the picker
  empty, and its text stays as it is.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'server' / 'survey' / 'data' / 'wilayah-jambi.json'
RENAME = {'Kabupaten Batanghari': 'Kabupaten Batang Hari'}

rows = dict(re.findall(r"\('(15(?:\.\d+)*)','([^']*)'\)", Path(sys.argv[1]).read_text(encoding='utf-8')))
tree = []
for kab_code in sorted(code for code in rows if code.count('.') == 1):
    kecamatan = []
    for kec_code in sorted(code for code in rows if code.count('.') == 2 and code.startswith(kab_code + '.')):
        villages = sorted((code for code in rows if code.count('.') == 3 and code.startswith(kec_code + '.')),
            key=lambda code: rows[code])
        desa = [('Kel. ' if code.rsplit('.', 1)[1].startswith('1') else 'Desa ') + rows[code] for code in villages]
        kecamatan.append({'nama': rows[kec_code], 'desa': desa})
    kecamatan.sort(key=lambda kec: kec['nama'])
    tree.append({'nama': RENAME.get(rows[kab_code], rows[kab_code]), 'kecamatan': kecamatan})

assert len(tree) == 11, len(tree)
assert all(kec['desa'] for kab in tree for kec in kab['kecamatan'])
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(tree, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(f"{OUT.relative_to(ROOT)}: {len(tree)} kab/kota, {sum(len(k['kecamatan']) for k in tree)} kecamatan, "
      f"{sum(len(c['desa']) for k in tree for c in k['kecamatan'])} desa/kel, {OUT.stat().st_size} bytes")

known = {(kab['nama'], kec['nama']): set(kec['desa']) for kab in tree for kec in kab['kecamatan']}
points = json.loads((ROOT / 'data' / 'points.geojson').read_text(encoding='utf-8'))['features']
misses = {}
for feature in points:
    parts = [part.strip() for part in (feature['properties'].get('Alamat') or '').split(',')]
    if len(parts) != 3 or not parts[1].startswith('Kecamatan '):
        misses[('format', ', '.join(parts))] = misses.get(('format', ', '.join(parts)), 0) + 1
        continue
    desa, kec, kab = parts[0], parts[1][len('Kecamatan '):], parts[2]
    reason = 'kecamatan' if (kab, kec) not in known else 'desa' if desa not in known[(kab, kec)] else None
    if reason:
        misses[(reason, ', '.join(parts))] = misses.get((reason, ', '.join(parts)), 0) + 1
print(f'{len(points)} existing addresses, {sum(misses.values())} unmatched:')
for (reason, text), count in sorted(misses.items()):
    print(f'  [{reason}] {text} ×{count}')
