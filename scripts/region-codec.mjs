// Boundary payload codec for /data/regions.json.
//
// The kabupaten and province polygons were ~344 KB gzipped as GeoJSON and sat
// on the critical path of the first render (the list cannot group points until
// they arrive). Two lossless steps bring that to ~140 KB:
//
// 1. Decimal coordinates repeat their leading digits in every pair, which gzip
//    cannot remove. The boundaries are already snapped to a 0.000001-degree
//    grid (docs/boundary-data.md), so each ring is stored as integer
//    micro-degree deltas instead: the first pair absolute, the rest relative to
//    the previous one, flattened [x0, y0, dx1, dy1, ...]. integer / 1e6 rounds
//    to the same double that parsing the original decimal string produces. The
//    Z value is dropped; every source vertex has Z = 0.
// 2. The province outline (dissolved) is the union of the same polygons, so its
//    edges are exactly the kabupaten edges that no neighbour shares, in the same
//    direction. Such a ring is stored as runs of kabupaten vertices,
//    { runs: [[feature, ring, start, count], ...] }, which the client copies
//    without any searching (an earlier client-side edge walk cost ~90 ms of main
//    thread on a throttled phone). The matching happens here, and a ring is only
//    shortened when the runs reproduce it exactly, starting vertex included so
//    the dashed Area Cakupan outline begins where it always did. Otherwise it
//    ships in full, so a future boundary import can never be silently distorted.
export const REGION_ENCODING = 'delta-1e-6';

function encodeRing(ring) {
  const out = []; let px = 0, py = 0;
  for (const [x, y, z = 0] of ring) {
    const X = Math.round(x * 1e6), Y = Math.round(y * 1e6);
    // Refuse anything off the grid or with a real Z, so the codec can never lose data silently.
    if (X / 1e6 !== x || Y / 1e6 !== y || z !== 0) throw new Error(`Boundary vertex ${x},${y},${z} is not on the 1e-6 degree grid`);
    out.push(X - px, Y - py); px = X; py = Y;
  }
  return out;
}
const rings = geometry => geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();

// Must stay identical to the runs branch in src/public/data/load.ts; tests/load.test.ts checks the pair.
export function assembleRuns(runs, features) {
  const ring = [];
  for (const [feature, index, start, count] of runs) { const source = rings(features[feature].geometry)[index]; for (let k = 0; k < count; k++) ring.push(source[(start + k) % (source.length - 1)]); }
  ring.push([...ring[0]]);
  return ring;
}

const key = position => `${position[0]},${position[1]}`;
function outlineRuns(ring, features, edgeAt) {
  const runs = [];
  for (let j = 0; j < ring.length - 1; j++) {
    const at = edgeAt.get(`${key(ring[j])}>${key(ring[j + 1])}`); if (!at) return null;
    const last = runs.at(-1), length = last && rings(features[last[0]].geometry)[last[1]].length - 1;
    if (last && last[0] === at[0] && last[1] === at[1] && (last[2] + last[3]) % length === at[2]) last[3]++; else runs.push([...at, 1]);
  }
  const rebuilt = assembleRuns(runs, features);
  return rebuilt.length === ring.length && rebuilt.every((position, i) => position[0] === ring[i][0] && position[1] === ring[i][1]) ? { runs } : null;
}

export function encodeRegionCollection(collection, outlineOf) {
  // Each directed kabupaten edge -> [feature, ring, index]; null when it is not unique.
  const edgeAt = new Map();
  outlineOf?.features.forEach((feature, f) => rings(feature.geometry).forEach((source, r) => { for (let i = 0; i < source.length - 1; i++) { const edge = `${key(source[i])}>${key(source[i + 1])}`; edgeAt.set(edge, edgeAt.has(edge) ? null : [f, r, i]); } }));
  const encode = value => typeof value[0][0] === 'number' ? (outlineOf && outlineRuns(value, outlineOf.features, edgeAt)) || encodeRing(value) : value.map(encode);
  return { ...collection, features: collection.features.map(feature => ({ ...feature, geometry: { ...feature.geometry, coordinates: encode(feature.geometry.coordinates) } })) };
}
