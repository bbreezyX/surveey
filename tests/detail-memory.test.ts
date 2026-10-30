import { expect, it } from 'vitest';
import { readOpenDetail, DETAIL_MAX_AGE_MS } from '../src/public/state/detail-memory';
const saved = JSON.stringify({ at: 1_000, nomor: 'A-001' });
it('brings back the detail a reader left open within the last half hour', () => {
  expect(readOpenDetail(saved, 1_000 + DETAIL_MAX_AGE_MS - 1)).toBe('A-001');
});
it('starts fresh once the detail was left more than half an hour ago', () => {
  expect(readOpenDetail(saved, 1_000 + DETAIL_MAX_AGE_MS + 1)).toBeNull();
});
it('ignores missing, malformed or tampered entries', () => {
  expect(readOpenDetail(null, 2_000)).toBeNull();
  expect(readOpenDetail('{oops', 2_000)).toBeNull();
  expect(readOpenDetail(JSON.stringify({ at: 5_000, nomor: 'A-001' }), 2_000)).toBeNull();
  expect(readOpenDetail(JSON.stringify({ at: 1_000, nomor: 7 }), 2_000)).toBeNull();
  expect(readOpenDetail(JSON.stringify({ at: 1_000, nomor: '' }), 2_000)).toBeNull();
});
