import { distance, type PointState } from './api';
import type { MapPoint } from './backdrop';

// esdm.cloud/lapangan reads each published point's coordinates and its Duplikat flag. While the flag is on,
// the pin only advises and a crew may report the unit from wherever its stake turns out to be. Once the flag
// is off, a main-allocation unit's reports are checked against its pin again (and a photo taken within 30 m
// of another unit's pin goes to that unit). Dropping the flag while the pin is still the old, often shared
// coordinate therefore locks the crew onto the wrong spot. Sometimes the old pin is right (its partner was
// moved away), so this only warns. Below 8 m the pin has not really moved: that is a phone's GPS accuracy,
// the same margin the public map uses to call a pin shared.
const PIN_MOVED_METERS = 8;
export const FIELD_MATCH_RADIUS_METERS = 30;
// Generous bounding box around Provinsi Jambi (actual points span lat -2.63..-0.75, lon 101.29..103.98).
export const JAMBI_BOUNDS = { minLat: -2.9, maxLat: -0.6, minLon: 101.0, maxLon: 104.7 } as const;
type Placed = Pick<PointState, 'duplikat' | 'status' | 'archived' | 'lat' | 'lon'>;

export function clearsVerificationOnOldPin(before: Placed, after: Placed): boolean {
  // Belum Ditetapkan and Cadangan units keep esdm.cloud's own pin, and an archived one leaves the map.
  if (!before.duplikat || after.duplikat || after.status !== '' || after.archived) return false;
  return distance(before, after) < PIN_MOVED_METERS;
}

export const OLD_PIN_WARNING = 'Anda belum memindahkan pin. Kalau tanda ini mati, esdm.cloud mengunci laporan lapangan ke pin ini. Pindahkan pin dulu, kecuali posisinya sudah tepat.';

export function outsideJambi(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return lat < JAMBI_BOUNDS.minLat || lat > JAMBI_BOUNDS.maxLat || lon < JAMBI_BOUNDS.minLon || lon > JAMBI_BOUNDS.maxLon;
}

export const OUTSIDE_JAMBI_WARNING = 'Koordinat berada di luar wilayah Provinsi Jambi. Periksa tanda minus pada Latitude atau kemungkinan Latitude/Longitude tertukar.';

export interface NearbyConflict { id: string; nomor: string; distance_m: number; stacked: boolean }

// Official active units within 30 m of the edited coordinate: esdm.cloud/lapangan attributes a field photo
// taken within 30 m of another unit's pin to that unit, and <= 8 m is treated as a shared/stacked pin.
export function nearbyOfficialPoints(
  target: Pick<PointState, 'lat' | 'lon' | 'status' | 'archived'>,
  points: readonly MapPoint[],
  excludeId?: string,
  maxMeters = FIELD_MATCH_RADIUS_METERS,
): NearbyConflict[] {
  if (target.archived || target.status !== '' || !Number.isFinite(target.lat) || !Number.isFinite(target.lon)) return [];
  const hits: NearbyConflict[] = [];
  for (const other of points) {
    if (other.id === excludeId || other.status !== '') continue;
    // Cheap degree pre-filter (~500 m) before haversine across all points.
    if (Math.abs(other.lat - target.lat) > 0.005 || Math.abs(other.lon - target.lon) > 0.005) continue;
    const metres = distance(target, other);
    if (Number.isFinite(metres) && metres <= maxMeters) {
      hits.push({ id: other.id, nomor: other.nomor || other.id, distance_m: metres, stacked: metres <= PIN_MOVED_METERS });
    }
  }
  return hits.sort((a, b) => a.distance_m - b.distance_m);
}

// Mirrors server/survey/domain.py nomor_prefix & same_place so the editor can preview automatic Nomor
// renames before saving when an address moves a point to another desa.
const ADDRESS_RE = /^(?:Desa|Kel\.)\s+(.+?),\s*Kecamatan\s+(.+?),\s*(Kabupaten|Kota)\s+(.+)$/;

export function nomorPrefixFromAddress(alamat: string): string | null {
  const match = String(alamat || '').trim().match(ADDRESS_RE);
  if (!match) return null;
  const [, desa, kecamatan, kind, kabupaten] = match;
  const part = (name: string) => name.replace(/-/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
  return [part(`${kind === 'Kota' ? 'Kota ' : ''}${kabupaten}`), part(kecamatan), part(desa)].join('-');
}

export function samePlace(nomor: string, prefix: string): boolean {
  const plain = (name: string) => name.trim().toUpperCase().replace(/^(DESA|KEL\.?|KELURAHAN)\s+/, '').replace(/[^A-Z0-9]/g, '');
  const split = nomor.lastIndexOf('-');
  if (split < 0) return false;
  const left = nomor.slice(0, split).split('-').map(plain);
  const right = prefix.split('-').map(plain);
  return left.length === right.length && left.every((part, index) => part === right[index]);
}
