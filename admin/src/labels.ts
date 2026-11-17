import type { PointState } from './api';

export const POINT_FIELD_LABELS: Record<keyof PointState, string> = {
  nomor: 'Nomor',
  nama: 'Pengusul',
  jalur: 'Jalur',
  alamat: 'Alamat Lengkap',
  keterangan: 'Keterangan',
  lokasi_rekapan: 'Lokasi Rekapan',
  catatan: 'Catatan',
  status: 'Status Alokasi',
  duplikat: 'Perlu Verifikasi',
  archived: 'Diarsipkan',
  lat: 'Latitude',
  lon: 'Longitude',
  date: 'Tanggal',
  photo_id: 'Foto',
  observation_id: 'Pengamatan',
};

export function pointFieldLabel(key: string): string {
  return POINT_FIELD_LABELS[key as keyof PointState] ?? key;
}

export function formatPointFieldValue(key: string, value: unknown): string {
  if (value === true) return 'Ya';
  if (value === false) return 'Tidak';
  if (key === 'status' && value === '') return 'Alokasi Utama';
  if (value == null || value === '') return '—';
  if (key === 'lat' || key === 'lon') {
    const num = Number(value);
    return Number.isFinite(num) ? num.toFixed(6) : String(value);
  }
  if ((key === 'photo_id' || key === 'observation_id') && typeof value === 'string') return value.slice(0, 8);
  return String(value);
}

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'point.published': 'Titik Diterbitkan',
  'point.created': 'Titik Dibuat',
  'point.renumbered': 'Nomor Titik Dirapikan',
  'draft.created': 'Draf Dibuat',
  'draft.updated': 'Draf Diperbarui',
  'draft.discarded': 'Draf Dibatalkan',
  'draft.restore': 'Draf Pemulihan Dibuat',
  'publication.activated': 'Penerbitan Diaktifkan',
  'media.revoked': 'Akses Foto Dicabut',
  'photo.uploaded': 'Foto Diunggah',
  'login.succeeded': 'Masuk Berhasil',
  'login.failed': 'Percobaan Masuk Gagal',
  'session.logout': 'Keluar Sesi',
  'account.created': 'Akun Dibuat',
  'account.changed': 'Akun Diperbarui',
  'account.password_changed': 'Kata Sandi Diperbarui',
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
