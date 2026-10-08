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
