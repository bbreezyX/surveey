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
// The service worker (scripts/service-worker.js) marks a response it answered
// from its own copy with the time it stored it.
const STORED_AT = 'x-puts-stored-at';
// FNV-1a over the text: enough to notice that a reload brought the same file, not a security check.
function fingerprint(text: string) { let hash = 0x811c9dc5; for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193); return `${text.length}-${(hash >>> 0).toString(36)}`; }
// Prefer the immutable publication UUID over ETag because compressing proxies may weaken ETag on GET (W/"...")
// while leaving it strong on HEAD. Normalize any W/ prefix on ETag for static servers without X-Publication-ID.
function readVersionTag(headers: Headers): string | null {
  const pub = headers.get('x-publication-id');
  if (pub) return `pub:${pub}`;
  const etag = headers.get('etag');
  if (etag) return `etag:${etag.replace(/^W\//i, '')}`;
  const modified = headers.get('last-modified');
  return modified ? `mod:${modified}` : null;
}
async function loadJson(url: string, signal: AbortSignal, onProgress: () => void, init?: RequestInit): Promise<{ value: unknown; storedAt: number | null; signature: string; versionTag: string | null }> {
  const response = await fetch(url, init ? { ...init, signal } : { signal });
  onProgress();
  if (!response.ok) throw new Error(`Data ${url} gagal dimuat (${response.status}).`);
  const stored = Number(response.headers.get(STORED_AT)), storedAt = stored > 0 ? stored : null;
  const versionTag = readVersionTag(response.headers);
  // Every chunk counts as progress, so a slow link that keeps delivering is never cut off.
  const body = response.body && typeof TransformStream !== 'undefined' ? new Response(response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) { onProgress(); controller.enqueue(chunk); } }))) : response;
  const text = await body.text();
  return { value: JSON.parse(text), storedAt, signature: fingerprint(text), versionTag };
}
// A stall, not a total, ends the attempt. The old fixed 20 s total cut off a
// healthy 2G/EDGE download (~170 KB at ~8 KB/s), and the retry started from
// zero; now only 20 s without a single byte from either request gives up.
const STALL_MS = 20_000, VERSION_CHECK_MS = 8_000;
function withDeadline<T>(signal: AbortSignal, timeoutMs: number, run: (attempt: AbortController, progress: () => void) => Promise<T>): Promise<T> {
  const attempt = new AbortController();
  const abort = () => attempt.abort(signal.reason);
  if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const progress = () => { clearTimeout(deadline); deadline = setTimeout(() => attempt.abort(new Error('Koneksi terlalu lambat atau terputus. Silakan coba lagi.')), timeoutMs); };
  progress();
  return run(attempt, progress).finally(() => { clearTimeout(deadline); signal.removeEventListener('abort', abort); attempt.abort(); });
}
export async function loadSurveyDataset(signal: AbortSignal): Promise<SurveyDataset> {
  return withDeadline(signal, STALL_MS, async (attempt, progress) => {
    // Both URLs are preloaded by index.html and must stay byte-identical to those hrefs.
    const [pointFile, regionFile] = await Promise.all(['/data/points.geojson', '/data/regions.json'].map(url => loadJson(url, attempt.signal, progress)));
    const rawPoints = pointFile.value, rawRegions = regionFile.value;
    if (!isRecord(rawRegions) || rawRegions.encoding !== 'delta-1e-6') throw new Error('Format data batas wilayah tidak dikenal.');
    const points = parseSurveyCollection(rawPoints), boundaries = parseRegions(decodeRegionCollection(rawRegions.kabupaten));
    const dissolved = { type: 'FeatureCollection' as const, features: parseRegions(decodeRegionCollection(rawRegions.dissolved, boundaries)) };
    assignRegions(points, boundaries);
    // Only the points' age matters to a reader: boundaries change once a year, not between visits.
    return { points, boundaries, dissolved, storedAt: pointFile.storedAt, signature: `${pointFile.signature}/${regionFile.signature}`, versionTag: pointFile.versionTag };
  });
}
export async function loadSurveyPoints(current: SurveyDataset, signal: AbortSignal): Promise<SurveyDataset> {
  return withDeadline(signal, STALL_MS, async (attempt, progress) => {
    // Boundaries change once a year; background refreshes only re-fetch points and reuse the decoded regions in memory.
    const pointFile = await loadJson('/data/points.geojson', attempt.signal, progress, { cache: 'no-cache' });
    const points = parseSurveyCollection(pointFile.value);
    assignRegions(points, current.boundaries);
    const regionSignature = current.signature?.split('/')[1] ?? '';
    return { points, boundaries: current.boundaries, dissolved: current.dissolved, storedAt: pointFile.storedAt, signature: `${pointFile.signature}/${regionSignature}`, versionTag: pointFile.versionTag };
  });
}
export type VersionCheckResult = 'changed' | 'unchanged' | 'unsupported' | 'error';
export async function checkPointsVersion(currentTag: string | null | undefined, signal: AbortSignal): Promise<VersionCheckResult> {
  return withDeadline(signal, VERSION_CHECK_MS, async attempt => {
    try {
      const response = await fetch('/data/points.geojson', { method: 'HEAD', cache: 'no-store', signal: attempt.signal });
      if (!response.ok) return 'error';
      const remoteTag = readVersionTag(response.headers);
      if (!remoteTag || !currentTag) return 'unsupported';
      return remoteTag === currentTag ? 'unchanged' : 'changed';
    } catch {
      return 'error';
    }
  });
}
