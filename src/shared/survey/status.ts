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
  duplikat: { tag: 'Perlu konfirmasi', legend: 'Perlu Konfirmasi Setempat', short: 'Perlu Konfirmasi', count: 'perlu konfirmasi', search: 'perlu konfirmasi setempat verifikasi duplikat' },
  belum: { tag: 'Lokasi belum ditetapkan', legend: 'Lokasi Belum Ditetapkan', short: 'Belum Ditetapkan', count: 'lokasi belum ditetapkan', search: 'lokasi belum ditetapkan' },
  cadangan: { tag: 'Cadangan', legend: 'Cadangan', short: 'Cadangan', count: 'cadangan', search: 'cadangan' },
} as const;
