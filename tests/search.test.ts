import { expect, it } from 'vitest';
import { matchesQuery } from '../src/shared/survey/search';
it('matches exact RT numbers and word prefixes without including RT 30', () => {
  const point = { searchText: 'rt 03 kasang jaya', latNum: -1.5, lonNum: 103.5 };
  expect(matchesQuery(point, 'kasang rt 3')).toBe(true);
  expect(matchesQuery({ ...point, searchText: 'rt 30 kasang jaya' }, 'rt 3')).toBe(false);
  expect(matchesQuery(point, 'kasa')).toBe(true);
});
it('finds coordinate pairs in either order with the existing tolerance', () => {
  const point = { searchText: '', latNum: -1.584248, lonNum: 103.586442 };
  expect(matchesQuery(point, '103.586442 -1.584248')).toBe(true);
  expect(matchesQuery(point, '-1.5842, 103.5864')).toBe(true);
  expect(matchesQuery(point, '-1.6, 103.8')).toBe(false);
});
