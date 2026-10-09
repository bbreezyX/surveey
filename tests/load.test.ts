import { it, expect, vi } from 'vitest';
import { loadSurveyDataset } from '../src/public/data/load';
it('turns a stalled request into a retryable error and cancels its other requests', async () => {
  vi.useFakeTimers(); const parent = new AbortController(); let failure: unknown; let aborted = 0;
  vi.stubGlobal('fetch', vi.fn((_url: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => { options.signal.addEventListener('abort', () => { aborted++; reject(options.signal.reason); }, { once: true }); })));
  const pending = loadSurveyDataset(parent.signal).catch(error => { failure = error; });
  try { await vi.advanceTimersByTimeAsync(20_001); expect(failure).toBeInstanceOf(Error); expect(String(failure)).toMatch(/terlalu lama/); expect(aborted).toBe(2); }
  finally { parent.abort(); await pending; vi.unstubAllGlobals(); vi.useRealTimers(); }
});
it('restores the encoded boundary payload to the exact source coordinates', async () => {
  const { REGION_ENCODING, encodeRegionCollection } = await import('../scripts/region-codec.mjs');
  const { readFileSync } = await import('node:fs');
  const kabupaten = JSON.parse(readFileSync('layers/BatasKabupaten_1.js', 'utf8').replace(/^\s*var\s+json_BatasKabupaten_1\s*=\s*/, '').replace(/;\s*$/, ''));
  const dissolved = JSON.parse(readFileSync('data/dissolved.geojson', 'utf8'));
  const regions = { encoding: REGION_ENCODING, kabupaten: encodeRegionCollection(kabupaten), dissolved: encodeRegionCollection(dissolved, kabupaten) };
  // Every province ring is reduced to its start vertex, so the client walk is what is under test.
  expect(JSON.stringify(regions.dissolved).length).toBeLessThan(2000);
  const points = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [103.5, -1.5] }, properties: { Nomor: 'KOTA JAMBI-DANAU TELUK-TANJUNG RADEN-001' } }] };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('regions.json') ? JSON.parse(JSON.stringify(regions)) : points))));
  try {
    const dataset = await loadSurveyDataset(new AbortController().signal);
    // Source vertices carry Z = 0; the payload keeps exactly [lon, lat].
    const flat = (value: unknown): unknown => Array.isArray(value) && typeof value[0] === 'number' ? value.slice(0, 2) : (value as unknown[]).map(flat);
    expect(dataset.boundaries.map(feature => feature.geometry.coordinates)).toStrictEqual(kabupaten.features.map((feature: { geometry: { coordinates: unknown } }) => flat(feature.geometry.coordinates)));
    expect(dataset.dissolved.features.map(feature => (feature.geometry as { coordinates: unknown }).coordinates)).toStrictEqual(dissolved.features.map((feature: { geometry: { coordinates: unknown } }) => flat(feature.geometry.coordinates)));
    expect(dataset.boundaries.map(feature => feature.properties)).toStrictEqual(kabupaten.features.map((feature: { properties: unknown }) => feature.properties));
  } finally { vi.unstubAllGlobals(); }
});
it('refuses boundary vertices that the codec could not restore exactly', async () => {
  const { encodeRegionCollection } = await import('../scripts/region-codec.mjs');
  const collection = (coordinates: number[][]) => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coordinates] } }] });
  expect(() => encodeRegionCollection(collection([[103.1234567, -1.5], [103.2, -1.5], [103.2, -1.6], [103.1234567, -1.5]]))).toThrow(/grid/);
  expect(() => encodeRegionCollection(collection([[103.1, -1.5, 12], [103.2, -1.5, 0], [103.2, -1.6, 0], [103.1, -1.5, 12]]))).toThrow(/grid/);
});
it('ships an outline ring in full when the kabupaten edges cannot reproduce it', async () => {
  const { encodeRegionCollection } = await import('../scripts/region-codec.mjs');
  const square = [[103, -1], [103.1, -1], [103.1, -1.1], [103, -1.1], [103, -1]];
  const collection = (ring: number[][]) => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] });
  expect(encodeRegionCollection(collection(square), collection(square)).features[0].geometry.coordinates[0]).toEqual({ runs: [[0, 0, 0, 4]] });
  expect(encodeRegionCollection(collection([...square].reverse()), collection(square)).features[0].geometry.coordinates[0]).toHaveLength(10);
});
