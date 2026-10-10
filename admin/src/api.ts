export interface PointState {
  nomor: string; nama: string; jalur: string; alamat: string; keterangan: string; lokasi_rekapan: string;
  catatan: string; status: '' | 'Cadangan' | 'Belum Ditetapkan'; duplikat: boolean; archived: boolean;
  lon: number; lat: number; date: string; photo_id: string | null; observation_id: string | null;
}
export interface Account { id: number; username: string; name: string; role: 'editor' | 'publisher' | 'owner'; enabled: boolean; last_login: string | null }
export interface Counts { total: number; official: number; cadangan: number; belum: number; duplikat: number }
// drafts: how many drafts for this point are still waiting for review.
export interface PointRow { id: string; revision: number; state: PointState; drafts: number }
export interface Detail extends PointRow {
  observations: { id: string; date: string; lon: number; lat: number; notes: string; source: string; photos: string[] }[];
  revisions: { number: number; state: PointState; reason: string; at: string }[];
}
export interface Draft {
  id: string; point_id: string; nomor: string; base_revision: number; current_revision: number;
  before: PointState; after: PointState; new_observation: { date: string; notes: string; source: string } | null;
  reason: string; author: string; movement_m: number; counts_before: Counts; counts_after: Counts; created_at: string;
}
let csrf = '';
export class ApiError extends Error {
  constructor(message: string, public status: number, public details: unknown) { super(message); }
}
export function setCsrf(value: string) { csrf = value; }
export async function api<T>(path: string, method = 'GET', payload?: unknown): Promise<T> {
  const form = payload instanceof FormData;
  const response = await fetch(`/admin/api/${path}`, { method, credentials: 'same-origin', cache: 'no-store',
    headers: method === 'GET' ? {} : { 'X-CSRFToken': csrf, ...(!form ? { 'Content-Type': 'application/json' } : {}) },
    body: payload === undefined ? undefined : form ? payload : JSON.stringify(payload),
  });
  if (response.status === 401) { window.location.assign('/admin/'); throw new ApiError('Sesi berakhir. Halaman masuk ditampilkan kembali.', 401, null); }
  const result = await response.json().catch(() => ({ error: 'Server tidak dapat menyelesaikan permintaan.' }));
  if (!response.ok) throw new ApiError(result.error || 'Permintaan gagal.', response.status, result.details);
  return result as T;
}
export function photoUrl(id: string | null) { return id ? `/admin/api/photos/${id}/display` : ''; }
export function emptyState(): PointState { return { nomor: '', nama: '', jalur: '', alamat: '', keterangan: '',
  lokasi_rekapan: '', catatan: '', status: '', duplikat: false, archived: false, lon: Number.NaN, lat: Number.NaN,
  date: '', photo_id: null, observation_id: null }; }
export function distance(a: PointState, b: PointState) {
  const rad = Math.PI / 180, x = a.lat*rad, y = b.lat*rad;
  const h = Math.sin((y-x)/2)**2 + Math.cos(x)*Math.cos(y)*Math.sin((b.lon-a.lon)*rad/2)**2;
  return Math.round(6371008.8*2*Math.asin(Math.min(1, Math.sqrt(h))));
}
// Thousands of metres read faster as kilometres: "2,35 km", not "2.347 m".
export function formatDistance(metres: number) {
  return metres < 1000 ? `${metres.toLocaleString('id-ID')} m` : `${(metres/1000).toLocaleString('id-ID', { maximumFractionDigits: 2 })} km`;
}
