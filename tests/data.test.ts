import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSurveyCollection } from '../src/public/data/parse';
import { assignRegions } from '../src/public/data/regions';
import type { RegionFeature } from '../src/shared/survey/types';
const feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [103.5, -1.5] }, properties: { Nomor: 'KOTA JAMBI-DANAU TELUK-TANJUNG RADEN-001', Longitude: 103.5, Latitude: -1.5 } };
const collection = (features: unknown[]) => ({ type: 'FeatureCollection', features });
it('distinguishes empty successful data from malformed input', () => {
  expect(parseSurveyCollection(collection([]))).toEqual([]);
  expect(() => parseSurveyCollection({})).toThrow(/GeoJSON/);
  expect(() => parseSurveyCollection(collection([feature, feature]))).toThrow(/Nomor/);
});
it('rejects inconsistent coordinates but accepts absent optional photos', () => {
  expect(parseSurveyCollection(collection([feature]))[0].photo).toBe('');
  expect(() => parseSurveyCollection(collection([{ ...feature, geometry: { type: 'Point', coordinates: [200, -1.5] } }]))).toThrow(/koordinat/i);
  expect(() => parseSurveyCollection(collection([{ ...feature, properties: { ...feature.properties, Latitude: -1.6 } }]))).toThrow(/koordinat/i);
});
it('rejects malformed identifiers and non-finite coordinate properties', () => {
  expect(() => parseSurveyCollection(collection([{ ...feature, properties: { ...feature.properties, Nomor: 'invalid' } }]))).toThrow(/Nomor/);
  expect(() => parseSurveyCollection(collection([{ ...feature, properties: { ...feature.properties, Latitude: NaN } }]))).toThrow(/koordinat/i);
});
it('assigns polygon membership, nearest boundary fallback and identifier fallback', () => {
  const region: RegionFeature = { type: 'Feature', properties: { KABUPATEN_: 'Kab. Test' }, geometry: { type: 'Polygon', coordinates: [[[103, -2], [104, -2], [104, -1], [103, -1], [103, -2]]] } };
  const inside = parseSurveyCollection(collection([feature]))[0]; assignRegions([inside], [region]); expect(inside.kabupaten).toBe('Kab. Test');
  const outside = { ...inside, lonNum: 104.1 }; assignRegions([outside], [region]); expect(outside.kabupaten).toBe('Kab. Test');
  assignRegions([inside], []); expect(inside.kabupaten).toBe('Kota Jambi');
});
it('preserves the existing entire dataset without changing counting semantics', () => {
  const points = parseSurveyCollection(JSON.parse(readFileSync('data/points.geojson', 'utf8')));
  expect(points.length).toBe(550);
  expect(points.filter(p => !p.cadangan).length).toBe(500);
  expect(points.filter(p => p.belum).length).toBe(2);
  expect(points.filter(p => p.duplikat).length).toBe(22);
});
