import type { CoordinatePair } from './types';
export function parseCoordinateQuery(value: string): CoordinatePair | null {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const a = Number(match[1]), b = Number(match[2]);
  if (Math.abs(a) > 20 && Math.abs(a) <= 180 && Math.abs(b) <= 20) return { lat: b, lon: a };
  return Math.abs(a) <= 90 && Math.abs(b) <= 180 ? { lat: a, lon: b } : null;
}
export function formatCoordNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') : '';
}
export function formatCoordPair(lat: number, lon: number): string { return `${formatCoordNumber(lat)}, ${formatCoordNumber(lon)}`; }
// Keep the original query tolerance: precise pastes still find older rounded rows.
export function coordinateTolerance(value: number): number {
  const decimals = String(Math.abs(value)).split('.')[1]?.length ?? 0;
  return Math.max(0.00015, Math.pow(10, -decimals) * 0.51);
}
// A place search drops a pin and zooms onto the point first, so crews see where the pole stands before
// choosing to navigate; Google Maps' own Rute button sits on that card. The dir/ form went straight to a
// route overview zoomed out to fit the whole trip, where the point itself was hard to make out.
export function googleMapsUrl(point: { latNum: number; lonNum: number }): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${point.latNum.toFixed(6)},${point.lonNum.toFixed(6)}`)}`;
}
