export interface Fix { lat: number; lon: number; accuracy: number }
type Located = { latNum: number; lonNum: number };
// Street-light units along one road are often only a few tens of metres apart, and a phone outdoors is
// usually good to 5-20 m, so 30 m is the floor for "you are at this unit"; a worse fix widens it.
export const HERE_METERS = 30;
// Past this the fix is a cell-tower guess, and the reader should know the distances are rough.
export const WEAK_ACCURACY = 100;
export function distanceMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180, dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function nearestPoints<T extends Located>(points: readonly T[], fix: Fix, limit = 3): { point: T; meters: number }[] {
  return points.filter(point => Number.isFinite(point.latNum) && Number.isFinite(point.lonNum))
    .map(point => ({ point, meters: distanceMeters(fix.lat, fix.lon, point.latNum, point.lonNum) }))
    .sort((a, b) => a.meters - b.meters).slice(0, limit);
}
export function isHere(meters: number, accuracy: number): boolean { return meters <= Math.max(HERE_METERS, accuracy); }
export function formatDistance(meters: number): string {
  return meters < 999.5 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}
