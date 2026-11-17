import { expect, it } from 'vitest';
import { emptyState, type PointState } from '../admin/src/api';
import { clearsVerificationOnOldPin } from '../admin/src/verification';
const flagged: PointState = { ...emptyState(), nomor: 'BATANG HARI-BATIN XXIV-OLAK BESAR-004', duplikat: true, lat: -1.89677, lon: 102.98033 };

it('warns when the Perlu Verifikasi flag is dropped while the pin stays put', () => {
  expect(clearsVerificationOnOldPin(flagged, { ...flagged, duplikat: false })).toBe(true);
  // About 4 m: inside a phone's GPS accuracy, so still the old pin.
  expect(clearsVerificationOnOldPin(flagged, { ...flagged, duplikat: false, lon: 102.980366 })).toBe(true);
});

it('stays quiet once the pin is corrected, the flag stays, or the unit has no fixed pin', () => {
  expect(clearsVerificationOnOldPin(flagged, { ...flagged, duplikat: false, lon: 102.9808 })).toBe(false);
  const noted: PointState = { ...flagged, catatan: 'Dicek' };
  expect(clearsVerificationOnOldPin(flagged, noted)).toBe(false);
  expect(clearsVerificationOnOldPin({ ...flagged, duplikat: false }, { ...flagged, duplikat: false })).toBe(false);
  expect(clearsVerificationOnOldPin(flagged, { ...flagged, duplikat: false, status: 'Belum Ditetapkan' })).toBe(false);
  expect(clearsVerificationOnOldPin(flagged, { ...flagged, duplikat: false, status: 'Cadangan' })).toBe(false);
  expect(clearsVerificationOnOldPin(flagged, { ...flagged, duplikat: false, archived: true })).toBe(false);
});
