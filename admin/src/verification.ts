import { distance, type PointState } from './api';

// esdm.cloud/lapangan reads each published point's coordinates and its Duplikat flag. While the flag is on,
// the pin only advises and a crew may report the unit from wherever its stake turns out to be. Once the flag
// is off, a main-allocation unit's reports are checked against its pin again (and a photo taken within 30 m
// of another unit's pin goes to that unit). Dropping the flag while the pin is still the old, often shared
// coordinate therefore locks the crew onto the wrong spot. Sometimes the old pin is right (its partner was
// moved away), so this only warns. Below 8 m the pin has not really moved: that is a phone's GPS accuracy,
// the same margin the public map uses to call a pin shared.
const PIN_MOVED_METERS = 8;
type Placed = Pick<PointState, 'duplikat' | 'status' | 'archived' | 'lat' | 'lon'>;

export function clearsVerificationOnOldPin(before: Placed, after: Placed): boolean {
  // Belum Ditetapkan and Cadangan units keep esdm.cloud's own pin, and an archived one leaves the map.
  if (!before.duplikat || after.duplikat || after.status !== '' || after.archived) return false;
  return distance(before, after) < PIN_MOVED_METERS;
}

export const OLD_PIN_WARNING = 'Anda belum memindahkan pin. Kalau tanda ini mati, esdm.cloud mengunci laporan lapangan ke pin ini. Pindahkan pin dulu, kecuali posisinya sudah tepat.';
