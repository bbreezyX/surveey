import copy
import datetime
import math
import re
import uuid

class Problem(Exception):
    def __init__(self, message, status=400, details=None):
        self.message, self.status, self.details = message, status, details

TEXT_FIELDS = {'nomor': 250, 'nama': 250, 'jalur': 250, 'alamat': 3000, 'keterangan': 3000,
    'lokasi_rekapan': 3000, 'catatan': 6000}
FIELDS = set(TEXT_FIELDS) | {'status', 'duplikat', 'lon', 'lat', 'date', 'photo_id', 'observation_id', 'archived'}

def identifier(value):
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        raise Problem('Identitas tidak valid.')

def text(value, name, maximum, required=False):
    if not isinstance(value, str) or len(value) > maximum:
        raise Problem(f'{name} harus berupa teks, maksimum {maximum} karakter.')
    value = value.strip()
    if required and not value:
        raise Problem(f'{name} wajib diisi.')
    return value

def date(value, allow_unknown=False):
    if value == '' and allow_unknown:
        return ''
    if not isinstance(value, str):
        raise Problem('Tanggal dokumentasi tidak valid.')
    try:
        parsed = datetime.date.fromisoformat(value)
        if parsed.isoformat() != value:
            raise ValueError()
    except ValueError:
        raise Problem('Tanggal dokumentasi harus berupa tanggal kalender YYYY-MM-DD.')
    return value

def coordinate(value, limit):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or abs(value) > limit:
        raise Problem('Koordinat di luar batas atau tidak valid.')
    return value

COORD_QUERY = re.compile(r'^\(?\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*\)?$')
RT_WORD = re.compile(r'^r[tw]\d+$')
RT_NORMALIZE = re.compile(r'\b(r[tw])[\s.]*0*(\d+)')

def parse_coordinate_query(value):
    """Parse a pasted "lat, lon" (or swapped "lon, lat") search query with
    decimal-precision tolerance matching src/shared/survey/coordinates.ts."""
    match = COORD_QUERY.fullmatch(str(value or '').strip())
    if not match:
        return None
    a, b = float(match.group(1)), float(match.group(2))
    if not (math.isfinite(a) and math.isfinite(b)):
        return None
    if 20 < abs(a) <= 180 and abs(b) <= 20:
        lat, lon, lat_raw, lon_raw = b, a, match.group(2), match.group(1)
    elif abs(a) <= 90 and abs(b) <= 180:
        lat, lon, lat_raw, lon_raw = a, b, match.group(1), match.group(2)
    else:
        return None
    tol = lambda raw: max(0.00015, (10 ** -(len(raw.split('.')[1]) if '.' in raw else 0)) * 0.51)
    return lat, lon, tol(lat_raw), tol(lon_raw)

def search_words(value):
    cleaned = RT_NORMALIZE.sub(r'\1\2', str(value or '').lower())
    return [word for word in re.split(r'[^a-z0-9]+', cleaned) if word]

def matches_search_query(nomor, state, query, parsed_coord=None):
    """Match an admin search query against coordinates or all editable text fields
    (including Lokasi Rekapan and Catatan), supporting multi-word prefix search."""
    if parsed_coord:
        lat, lon = state.get('lat'), state.get('lon')
        if isinstance(lat, (int, float)) and isinstance(lon, (int, float)) and math.isfinite(lat) and math.isfinite(lon):
            q_lat, q_lon, lat_tol, lon_tol = parsed_coord
            if abs(lat - q_lat) <= lat_tol and abs(lon - q_lon) <= lon_tol:
                return True
    lower = query.lower()
    haystack = ' '.join(str(v or '') for v in (
        nomor, state.get('lokasi_rekapan'), state.get('alamat'), state.get('nama'),
        state.get('keterangan'), state.get('jalur'), state.get('catatan'), state.get('status'),
    )).lower()
    words = search_words(lower)
    if not any(RT_WORD.match(word) for word in words) and lower in haystack:
        return True
    if not words:
        return False
    candidates = search_words(haystack)
    for word in words:
        # Single-character tokens (e.g. "Tim A") and RT/RW tokens must match a whole word
        # so "Tim A" never matches "Tim B" in "Desa Alam".
        if len(word) == 1 or RT_WORD.match(word):
            if not any(candidate == word for candidate in candidates):
                return False
        else:
            if not any(candidate.startswith(word) for candidate in candidates):
                return False
    return True

# Nomor reads KABUPATEN-KECAMATAN-DESA-NNN and follows the address, so the
# lists group a point where its address says it is. Only the official form
# written by the address picker ("Desa X, Kecamatan Y, Kabupaten Z" or
# "Kel. X, Kecamatan Y, Kota Z") is read; anything else keeps its Nomor.
ADDRESS = re.compile(r'(?:Desa|Kel\.)\s+(.+?),\s*Kecamatan\s+(.+?),\s*(Kabupaten|Kota)\s+(.+)')

def nomor_prefix(alamat):
    match = ADDRESS.fullmatch(str(alamat or '').strip())
    if not match:
        return None
    desa, kecamatan, kind, kabupaten = match.groups()
    # A hyphen inside a name ("Muko-muko") would split the Nomor's segments.
    part = lambda name: re.sub(r'\s+', ' ', name.replace('-', ' ')).strip().upper()
    return '-'.join(part(name) for name in (('Kota ' if kind == 'Kota' else '') + kabupaten, kecamatan, desa))

def same_place(nomor, prefix):
    # Spelling and case differences ("Desa Suka Damai" vs "SUKA DAMAI") are not a move.
    plain = lambda name: re.sub(r'[^A-Z0-9]', '', re.sub(r'^(DESA|KEL\.?|KELURAHAN)\s+', '', name.strip().upper()))
    return [plain(name) for name in nomor.rsplit('-', 1)[0].split('-')] == [plain(name) for name in prefix.split('-')]

def nomor_numbers(nomors):
    """Numbers in use per desa, keyed by the upper-case KABUPATEN-KECAMATAN-DESA
    prefix, the same case-insensitive match assign_nomor uses."""
    desa = {}
    for nomor in nomors:
        prefix, _, number = nomor.rpartition('-')
        if prefix and number.isdigit():
            desa.setdefault(prefix.upper(), []).append(int(number))
    return desa

def nomor_gaps(nomors):
    # A desa needs tidying when its numbers are not exactly 001..N: a point
    # that moved away leaves a hole, and the one that arrived takes max+1.
    # Callers pass active points only: an archived point still holds its
    # number, yet the public map skips it, so it is a hole there too.
    # The numbers in use come along so the list can show what is out of order.
    return {prefix: sorted(numbers) for prefix, numbers in sorted(nomor_numbers(nomors).items())
        if sorted(numbers) != list(range(1, len(numbers) + 1))}

def validate_state(value, original=None):
    if not isinstance(value, dict) or set(value) != FIELDS:
        raise Problem('Kolom titik tidak lengkap atau tidak dikenal.')
    result = {key: text(value[key], key, maximum, key == 'nomor') for key, maximum in TEXT_FIELDS.items()}
    if not re.fullmatch(r'[^-]+-[^-]+-[^-]+-\d+', result['nomor']):
        raise Problem('Nomor harus berupa KABUPATEN-KECAMATAN-DESA-001.')
    if original and result['nomor'] != original['nomor']:
        raise Problem('Nomor titik yang sudah dibuat tidak dapat diubah.')
    if value['status'] not in ('', 'Cadangan', 'Belum Ditetapkan'):
        raise Problem('Status alokasi tidak dikenal.')
    result['status'] = value['status']
    for key in ('duplikat', 'archived'):
        if type(value[key]) is not bool:
            raise Problem(f'{key} harus berupa nilai ya/tidak.')
        result[key] = value[key]
    result.update(lon=coordinate(value['lon'], 180), lat=coordinate(value['lat'], 90), date=date(value['date'], True))
    for key in ('photo_id', 'observation_id'):
        result[key] = identifier(value[key]) if value[key] else None
    return result

def public_feature(point, state):
    # Explicit whitelist: never copy arbitrary original properties or draft payloads.
    stamp = datetime.date.fromisoformat(state['date']).strftime('%d/%m/%Y') if state['date'] else ''
    photo = '/media/' + uuid.UUID(state['photo_id']).hex if state['photo_id'] else ''
    return {'type': 'Feature', 'properties': {'fid': str(point.id), 'Nomor': state['nomor'],
        'Nama Anggota': state['nama'], 'Jalur': state['jalur'], 'Alamat': state['alamat'],
        'Keterangan': state['keterangan'], 'Lokasi Rekapan': state['lokasi_rekapan'], 'Catatan': state['catatan'],
        'Status': state['status'], 'Duplikat': state['duplikat'], 'Tanggal Dokumentasi': stamp,
        'Foto Survey Awal': photo, 'Longitude': state['lon'], 'Latitude': state['lat']},
        'geometry': {'type': 'Point', 'coordinates': [state['lon'], state['lat']]}}

def counts(states):
    active = [state for state in states if not state['archived']]
    return {'total': len(active), 'official': sum(s['status'] != 'Cadangan' for s in active),
        'cadangan': sum(s['status'] == 'Cadangan' for s in active),
        'belum': sum(s['status'] == 'Belum Ditetapkan' for s in active), 'duplikat': sum(s['duplikat'] for s in active)}

def movement(before, after):
    a, b = math.radians(before['lat']), math.radians(after['lat'])
    dlat, dlon = b-a, math.radians(after['lon']-before['lon'])
    h = math.sin(dlat/2)**2 + math.cos(a)*math.cos(b)*math.sin(dlon/2)**2
    return round(6371008.8 * 2 * math.asin(min(1, math.sqrt(h))), 2)

def clone(value):
    return copy.deepcopy(value)
