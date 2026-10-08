import { describe, expect, it } from 'vitest';
import { getPointFlags, countOfficialPoints } from '../src/shared/survey/status';
import { parseCoordinateQuery, formatCoordPair } from '../src/shared/survey/coordinates';
import { legacyPhotoUrl } from '../src/shared/survey/media';
import { latestDocumentationDate } from '../src/shared/survey/dates';
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
