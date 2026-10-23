import { expect, it } from 'vitest';
import { readSavedView, VIEW_MAX_AGE_MS } from '../src/public/state/view-memory';
const saved = { at: 1_000, selected: 'A-001', region: 'Kota Jambi', filter: 'belum', query: 'bagan', panel: false, center: [11_530_000, -180_000], zoom: 17.2 };
it('brings back the view a reader left within the last half hour', () => {
  expect(readSavedView(JSON.stringify(saved), 1_000 + VIEW_MAX_AGE_MS - 1)).toEqual(saved);
});
it('starts fresh once the saved view is older than half an hour', () => {
  expect(readSavedView(JSON.stringify(saved), 1_000 + VIEW_MAX_AGE_MS + 1)).toBeNull();
});
it('ignores missing, malformed or tampered entries', () => {
  expect(readSavedView(null, 2_000)).toBeNull();
  expect(readSavedView('{oops', 2_000)).toBeNull();
  expect(readSavedView(JSON.stringify({ ...saved, filter: 'semua' }), 2_000)).toBeNull();
  expect(readSavedView(JSON.stringify({ ...saved, center: ['x', 1] }), 2_000)).toBeNull();
  expect(readSavedView(JSON.stringify({ ...saved, at: 5_000 }), 2_000)).toBeNull();
});
it('keeps a view saved before the map had a position', () => {
  const blank = { ...saved, selected: null, region: null, filter: null, query: '', center: null, zoom: null };
  expect(readSavedView(JSON.stringify(blank), 2_000)).toEqual(blank);
});
