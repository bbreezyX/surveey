import { expect, it } from 'vitest';
import { emptyState, type PointState } from '../admin/src/api';
import type { MapPoint } from '../admin/src/backdrop';
import {
  clearsVerificationOnOldPin,
  nearbyOfficialPoints,
  nomorPrefixFromAddress,
  outsideJambi,
  samePlace,
} from '../admin/src/verification';
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

it('detects coordinates outside Provinsi Jambi while ignoring empty inputs', () => {
  expect(outsideJambi(-1.6, 103.6)).toBe(false);
  expect(outsideJambi(1.6, 103.6)).toBe(true);
  expect(outsideJambi(0, 0)).toBe(true);
  expect(outsideJambi(Number.NaN, 103.6)).toBe(false);
});

it('finds nearby official points within 30 m and distinguishes stacked pins', () => {
  const map: MapPoint[] = [
    { id: 'self', nomor: 'BATANG HARI-BATIN XXIV-OLAK BESAR-004', lat: -1.89677, lon: 102.98033, status: '', duplikat: true },
    { id: 'stacked', nomor: 'BATANG HARI-BATIN XXIV-OLAK BESAR-005', lat: -1.89677, lon: 102.98036, status: '', duplikat: false },
    { id: 'near', nomor: 'BATANG HARI-BATIN XXIV-OLAK BESAR-006', lat: -1.89677, lon: 102.9805, status: '', duplikat: false },
    { id: 'reserve', nomor: 'BATANG HARI-BATIN XXIV-OLAK BESAR-007', lat: -1.89677, lon: 102.98033, status: 'Cadangan', duplikat: false },
    { id: 'far', nomor: 'BATANG HARI-BATIN XXIV-OLAK BESAR-008', lat: -1.8975, lon: 102.98033, status: '', duplikat: false },
  ];
  const hits = nearbyOfficialPoints(flagged, map, 'self');
  expect(hits.map(h => [h.id, h.stacked])).toEqual([['stacked', true], ['near', false]]);
  expect(nearbyOfficialPoints({ ...flagged, status: 'Belum Ditetapkan' }, map, 'self')).toEqual([]);
  expect(nearbyOfficialPoints({ ...flagged, archived: true }, map, 'self')).toEqual([]);
});

it('mirrors backend Nomor prefix derivation and place matching', () => {
  expect(nomorPrefixFromAddress('Desa Pelempang, Kecamatan Mestong, Kabupaten Muaro Jambi')).toBe('MUARO JAMBI-MESTONG-PELEMPANG');
  expect(nomorPrefixFromAddress('Kel. Kenali Besar, Kecamatan Alam Barajo, Kota Jambi')).toBe('KOTA JAMBI-ALAM BARAJO-KENALI BESAR');
  expect(nomorPrefixFromAddress('Desa X, Kecamatan Muko-muko Bathin VII, Kabupaten Bungo')).toBe('BUNGO-MUKO MUKO BATHIN VII-X');
  expect(nomorPrefixFromAddress('RT 21 Rawasari, Kota Jambi')).toBeNull();
  expect(samePlace('Muaro Jambi-Mestong-Desa Suka Damai-001', 'MUARO JAMBI-MESTONG-SUKA DAMAI')).toBe(true);
  expect(samePlace('MUARO JAMBI-MESTONG-TEMPINO-001', 'MUARO JAMBI-MESTONG-PELEMPANG')).toBe(false);
});
