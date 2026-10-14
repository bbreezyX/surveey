import { expect, it } from 'vitest';
import { distanceMeters, nearestPoints, suggestable, isHere, formatDistance } from '../src/public/state/nearby';
const at = (nomor: string, latNum: number, lonNum: number) => ({ nomor, latNum, lonNum });
it('measures ground distance close to what a phone GPS reports', () => {
  // 0.001° of latitude is about 111 m everywhere.
  expect(distanceMeters(-1.6, 103.6, -1.601, 103.6)).toBeCloseTo(111.2, 0);
  expect(distanceMeters(-1.6, 103.6, -1.6, 103.6)).toBe(0);
});
it('ranks the nearest units first and keeps only the requested number', () => {
  const points = [at('far', -1.61, 103.6), at('near', -1.6001, 103.6), at('mid', -1.602, 103.6), at('none', Number.NaN, Number.NaN)];
  const ranked = nearestPoints(points, { lat: -1.6, lon: 103.6, accuracy: 10 }, 2);
  expect(ranked.map(item => item.point.nomor)).toEqual(['near', 'mid']);
  expect(ranked[0].meters).toBeCloseTo(11.1, 0);
});
it('treats a unit as here within 30 m or the GPS accuracy, whichever is wider', () => {
  expect(isHere(25, 8)).toBe(true);
  expect(isHere(45, 8)).toBe(false);
  expect(isHere(45, 60)).toBe(true);
});
it('formats distances the way Indonesian readers write them', () => {
  expect(formatDistance(8.4)).toBe('8 m');
  expect(formatDistance(999.6)).toBe('1,0 km');
  expect(formatDistance(2345)).toBe('2,3 km');
});
it('never suggests unsited units and lets reserves follow their layer', () => {
  const points = [{ nomor: 'sk', belum: false, cadangan: false }, { nomor: 'belum', belum: true, cadangan: false }, { nomor: 'cadangan', belum: false, cadangan: true }];
  expect(suggestable(points, { sk: true, cadangan: false }).map(point => point.nomor)).toEqual(['sk']);
  expect(suggestable(points, { sk: false, cadangan: true }).map(point => point.nomor)).toEqual(['cadangan']);
});
