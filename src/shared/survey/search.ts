import { coordinateTolerance, parseCoordinateQuery } from './coordinates';
const rtWord = /^r[tw]\d+$/;
export function searchWords(value: string): string[] {
  return value.toLowerCase().replace(/\b(r[tw])[\s.]*0*(\d+)/g, '$1$2').split(/[^a-z0-9]+/).filter(Boolean);
}
export function matchesQuery(point: { searchText: string; latNum: number; lonNum: number }, value: string): boolean {
  const query = value.trim().toLowerCase();
  if (!query) return true;
  const coordinate = parseCoordinateQuery(query);
  if (coordinate && Math.abs(point.latNum - coordinate.lat) <= coordinateTolerance(coordinate.lat) && Math.abs(point.lonNum - coordinate.lon) <= coordinateTolerance(coordinate.lon)) return true;
  const words = searchWords(query);
  if (!words.some(word => rtWord.test(word)) && point.searchText.includes(query)) return true;
  const candidates = searchWords(point.searchText);
  return words.length > 0 && words.every(word => candidates.some(candidate => rtWord.test(word) ? candidate === word : candidate.startsWith(word)));
}
