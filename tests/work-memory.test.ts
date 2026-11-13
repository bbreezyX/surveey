import { expect, it } from 'vitest';
import { readLastReport, readListMode, REPORT_MAX_AGE_MS } from '../src/public/state/work-memory';
const saved = JSON.stringify({ at: 1_000, nomor: 'A-001', stage: 2 });
it('keeps the list view a reader chose, and starts everyone else on Sebaran', () => {
  expect(readListMode('progres')).toBe('progres');
  expect(readListMode('sebaran')).toBe('sebaran');
  expect(readListMode(null)).toBe('sebaran');
  expect(readListMode('peta')).toBe('sebaran');
});
it('remembers the report this phone sent for a week', () => {
  expect(readLastReport(saved, 1_000 + REPORT_MAX_AGE_MS - 1)).toEqual({ at: 1_000, nomor: 'A-001', stage: 2 });
  expect(readLastReport(saved, 1_000 + REPORT_MAX_AGE_MS + 1)).toBeNull();
});
it('ignores missing, malformed or tampered reports', () => {
  expect(readLastReport(null, 2_000)).toBeNull();
  expect(readLastReport('{oops', 2_000)).toBeNull();
  expect(readLastReport(JSON.stringify({ at: 5_000, nomor: 'A-001', stage: 2 }), 2_000)).toBeNull();
  expect(readLastReport(JSON.stringify({ at: 1_000, nomor: '', stage: 2 }), 2_000)).toBeNull();
  expect(readLastReport(JSON.stringify({ at: 1_000, nomor: 'A-001', stage: 5 }), 2_000)).toBeNull();
  expect(readLastReport(JSON.stringify({ at: 1_000, nomor: 'A-001', stage: 1.5 }), 2_000)).toBeNull();
});
