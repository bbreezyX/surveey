import { describe, expect, it } from 'vitest';
import { getPointFlags, countOfficialPoints } from '../src/shared/survey/status';
import { parseCoordinateQuery, formatCoordPair } from '../src/shared/survey/coordinates';
import { legacyPhotoUrl } from '../src/shared/survey/media';
import { latestDocumentationDate } from '../src/shared/survey/dates';
import { progressReportUrl } from '../src/shared/survey/report';
import { parseProgress, stageBadgeSvg, stageDone, stageSummary } from '../src/shared/survey/progress';
describe('survey evidence and counting', () => {
  it('ignores malformed and impossible optional dates without normalizing them', () => {
    expect(latestDocumentationDate(['32/13/2026', '31/02/9999', '29/02/2025', ''])).toBeNull();
    expect(latestDocumentationDate(['06/10/2026', '31/02/9999', '29/02/2024'])?.toISOString()).toBe('2026-10-06T00:00:00.000Z');
  });
  it('counts allocated unplaced and verification records but excludes reserves', () => {
    expect(countOfficialPoints([{ cadangan: false }, { cadangan: true }, { cadangan: false }])).toBe(2);
    expect(getPointFlags({ Status: 'Belum Ditetapkan', Duplikat: 'ya' })).toEqual({ cadangan: false, belum: true, duplikat: true });
    expect(getPointFlags({ Status: ' CADANGAN ', Duplikat: '1' }).cadangan).toBe(true);
  });
  it('accepts either coordinate order and preserves photo-stamp precision', () => {
    expect(parseCoordinateQuery('103.586442, -1.584248')).toEqual({ lat: -1.584248, lon: 103.586442 });
    expect(parseCoordinateQuery('-1.584248; 103.586442')).toEqual({ lat: -1.584248, lon: 103.586442 });
    expect(parseCoordinateQuery('200, 300')).toBeNull();
    expect(formatCoordPair(-1.584248, 103.586442)).toBe('-1.584248, 103.586442');
  });
  it('handles legacy media paths and legitimately absent photos', () => {
    expect(legacyPhotoUrl('')).toBeNull();
    expect(legacyPhotoUrl('D:/Survey/X.jpg')).toBe('/images/D__Survey_X.jpg');
    expect(legacyPhotoUrl('A #1.jpg')).toBe('/images/A%20%231.jpg');
  });
});

describe('progress report link', () => {
  it('names the point by its Nomor, spaces and all', () => {
    expect(progressReportUrl('KERINCI-SIULAK-DUSUN DALAM-001')).toBe('https://www.esdm.cloud/lapangan?nomor=KERINCI-SIULAK-DUSUN%20DALAM-001');
  });
});
describe('build progress from esdm.cloud', () => {
  it('keeps whole stages one to four by Nomor and drops the rest', () => {
    const progress = parseProgress({ stages: { 'A-001': 1, 'A-002': 4, 'A-003': 0, 'A-004': 2.5, 'A-005': '3' } });
    expect([...progress]).toEqual([['A-001', 1], ['A-002', 4]]);
    expect(parseProgress(null).size).toBe(0);
  });
  it('draws every stage apart and keeps the green check for a lit lamp', () => {
    expect([1, 2, 3, 4].map(stage => stageBadgeSvg(stage).includes('#1f8f4e'))).toEqual([false, false, false, true]);
    expect(new Set([1, 2, 3, 4].map(stageBadgeSvg)).size).toBe(4);
    // Only Tiang's badge draws the dashed ring of a Lampu still to be seen lit at night.
    expect([1, 2, 3, 4].map(stage => stageBadgeSvg(stage).includes('stroke-dasharray'))).toEqual([false, false, true, false]);
    expect([0, 1, 2, 3, 4].map(stageDone)).toEqual([false, false, false, false, true]);
  });
  it('names the last finished stage, and a lit lamp as terpasang', () => {
    expect([0, 1, 2, 3, 4].map(stageSummary)).toEqual(['Belum Dimulai', 'Galian Selesai', 'Cor Selesai', 'Tiang Selesai', 'Terpasang']);
  });
});
