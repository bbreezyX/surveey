import type { PointFlags, SurveyProperties } from './types';
export function getPointFlags(properties: SurveyProperties): PointFlags {
  const status = String(properties.Status ?? '').trim().toLowerCase();
  const duplicate = String(properties.Duplikat ?? '').trim().toLowerCase();
  return { cadangan: status === 'cadangan', belum: status === 'belum ditetapkan', duplikat: ['true', 'ya', '1'].includes(duplicate) };
}
export function countOfficialPoints(points: readonly { cadangan: boolean }[]): number {
  return points.filter(point => !point.cadangan).length;
}
export const STATUS_LABEL = {
  duplikat: { tag: 'Perlu verifikasi', legend: 'Koordinat perlu verifikasi', short: 'Perlu verifikasi', count: 'perlu verifikasi', search: 'perlu verifikasi duplikat' },
  belum: { tag: 'Lokasi belum ditetapkan', legend: 'Lokasi belum ditetapkan', short: 'Belum ditetapkan', count: 'lokasi belum ditetapkan', search: 'lokasi belum ditetapkan' },
  cadangan: { tag: 'Cadangan', legend: 'Cadangan', short: 'Cadangan', count: 'cadangan', search: 'cadangan' },
} as const;
