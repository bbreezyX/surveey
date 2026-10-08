import type { SurveyDataset } from '../../shared/survey/types';
import { parseRegions, parseSurveyCollection } from './parse';
import { assignRegions } from './regions';
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
    const [rawPoints, rawBoundaries, rawDissolved] = await Promise.all(['/data/points.geojson', '/data/kabupaten.geojson', '/data/dissolved.geojson'].map(url => loadJson(url, attempt.signal)));
    const points = parseSurveyCollection(rawPoints), boundaries = parseRegions(rawBoundaries);
    const dissolved = { type: 'FeatureCollection' as const, features: parseRegions(rawDissolved) };
    assignRegions(points, boundaries);
    return { points, boundaries, dissolved };
  } finally {
    clearTimeout(deadline); signal.removeEventListener('abort', abort); attempt.abort();
  }
}
