import type { RegionFeature, SurveyDataset } from '../../shared/survey/types';
import { isRecord, parseRegions, parseSurveyCollection } from './parse';
import { assignRegions } from './regions';
// Inverse of scripts/region-codec.mjs: rings arrive as flat integer micro-degree
// deltas and are restored to [lon, lat] pairs before the usual validation. A
// province ring may instead arrive as runs of kabupaten vertices to copy.
const decodeRing = (flat: number[]) => { const ring: number[][] = []; let x = 0, y = 0; for (let i = 0; i < flat.length; i += 2) { x += flat[i]; y += flat[i + 1]; ring.push([x / 1e6, y / 1e6]); } return ring; };
// Must stay identical to assembleRuns in scripts/region-codec.mjs; tests/load.test.ts checks the pair.
function assembleRuns(runs: number[][], regions: RegionFeature[]) {
  const ring: number[][] = [];
  for (const [feature, index, start, count] of runs) { const geometry = regions[feature].geometry, source = (geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat())[index]; for (let k = 0; k < count; k++) ring.push(source[(start + k) % (source.length - 1)]); }
  ring.push([...ring[0]]);
  return ring;
}
const decodeCoordinates = (value: unknown, regions?: RegionFeature[]): unknown => isRecord(value) && Array.isArray(value.runs) && regions ? assembleRuns(value.runs, regions) : Array.isArray(value) ? typeof value[0] === 'number' ? decodeRing(value) : value.map(item => decodeCoordinates(item, regions)) : value;
function decodeRegionCollection(value: unknown, regions?: RegionFeature[]): unknown {
  if (!isRecord(value) || !Array.isArray(value.features)) return value;
  return { ...value, features: value.features.map(feature => isRecord(feature) && isRecord(feature.geometry) ? { ...feature, geometry: { ...feature.geometry, coordinates: decodeCoordinates(feature.geometry.coordinates, regions) } } : feature) };
}
async function loadJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Data ${url} gagal dimuat (${response.status}).`);
  return response.json();
}
export async function loadSurveyDataset(signal: AbortSignal): Promise<SurveyDataset> {
  const attempt = new AbortController();
  const abort = () => attempt.abort(signal.reason);
  if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  const deadline = setTimeout(() => attempt.abort(new Error('Memuat data terlalu lama. Silakan coba lagi.')), 20_000);
  try {
    // Both URLs are preloaded by index.html and must stay byte-identical to those hrefs.
    const [rawPoints, rawRegions] = await Promise.all(['/data/points.geojson', '/data/regions.json'].map(url => loadJson(url, attempt.signal)));
    if (!isRecord(rawRegions) || rawRegions.encoding !== 'delta-1e-6') throw new Error('Format data batas wilayah tidak dikenal.');
    const points = parseSurveyCollection(rawPoints), boundaries = parseRegions(decodeRegionCollection(rawRegions.kabupaten));
    const dissolved = { type: 'FeatureCollection' as const, features: parseRegions(decodeRegionCollection(rawRegions.dissolved, boundaries)) };
    assignRegions(points, boundaries);
    return { points, boundaries, dissolved };
  } finally {
    clearTimeout(deadline); signal.removeEventListener('abort', abort); attempt.abort();
  }
}
