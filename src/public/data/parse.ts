import type { SurveyPoint, SurveyProperties, RegionFeature } from '../../shared/survey/types';
import { getPointFlags, STATUS_LABEL } from '../../shared/survey/status';
import { buildDisplayParts, cleanKeterangan, toPengusulName } from '../../shared/survey/display';
import { formatCoordPair } from '../../shared/survey/coordinates';
export function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function coordinate(value: unknown, limit: number): value is number { return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit; }
export function parseSurveyCollection(value: unknown): SurveyPoint[] {
  if (!isRecord(value) || value.type !== 'FeatureCollection' || !Array.isArray(value.features)) throw new Error('Format GeoJSON titik tidak valid.');
  const seen = new Set<string>();
  return value.features.map((feature: unknown, index: number) => {
    if (!isRecord(feature) || feature.type !== 'Feature' || !isRecord(feature.properties) || !isRecord(feature.geometry)) throw new Error(`GeoJSON titik ${index + 1} tidak valid.`);
    const props: SurveyProperties = feature.properties;
    const nomor = typeof props.Nomor === 'string' ? props.Nomor.trim() : '';
    if (!/^[^-]+-[^-]+-[^-]+-\d+$/.test(nomor) || seen.has(nomor)) throw new Error(`Nomor titik kosong atau berulang: ${nomor || index + 1}.`);
    seen.add(nomor);
    const coords = feature.geometry.coordinates;
    if (feature.geometry.type !== 'Point' || !Array.isArray(coords) || !coordinate(coords[0], 180) || !coordinate(coords[1], 90)) throw new Error(`Koordinat ${nomor} tidak valid.`);
    const lon = coords[0], lat = coords[1];
    for (const [key, expected] of [['Longitude', lon], ['Latitude', lat]] as const) {
      const actual = props[key];
      if (actual !== null && actual !== undefined && actual !== '' && (typeof actual !== 'number' || !Number.isFinite(actual) || Math.abs(actual - expected) > 1e-9)) throw new Error(`Koordinat geometri dan ${key} berbeda pada ${nomor}.`);
    }
    const text = (key: string) => String(props[key] ?? '').trim();
    const flags = getPointFlags(props);
    const display = buildDisplayParts(nomor, props.Keterangan, props['Lokasi Rekapan']);
    const nama = toPengusulName(props['Nama Anggota']) || 'Tanpa Nama';
    const koordinat = formatCoordPair(lat, lon);
    const searchText = [nomor, display.primary, display.secondary, display.desa.replace(/\s+/g, ''), nama, text('Jalur'), text('Tanggal Dokumentasi'), text('Alamat'), text('Keterangan'), koordinat, ...Object.entries(flags).filter(([, enabled]) => enabled).map(([flag]) => STATUS_LABEL[flag as keyof typeof STATUS_LABEL].search)].join(' ').toLowerCase();
    return { id: nomor, nomor, nama, jalur: text('Jalur'), alamat: text('Alamat'), keterangan: cleanKeterangan(props.Keterangan), tanggal: text('Tanggal Dokumentasi'), photo: text('Foto Survey Awal'), catatan: text('Catatan'), latNum: lat, lonNum: lon, kabupaten: '', display, koordinat, koordinatSingkat: flags.belum ? '' : koordinat, searchText, ...flags };
  });
}
function position(value: unknown): value is number[] { return Array.isArray(value) && value.length >= 2 && value.every(n => typeof n === 'number' && Number.isFinite(n)); }
function ring(value: unknown): value is number[][] { return Array.isArray(value) && value.length >= 4 && value.every(position); }
function polygon(value: unknown): value is number[][][] { return Array.isArray(value) && value.length > 0 && value.every(ring); }
function isRegionFeature(value: unknown): value is RegionFeature {
  if (!isRecord(value) || value.type !== 'Feature' || !isRecord(value.properties) || !isRecord(value.geometry)) return false;
  const geometry = value.geometry;
  return geometry.type === 'Polygon' ? polygon(geometry.coordinates) : geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0 && geometry.coordinates.every(polygon);
}
export function parseRegions(value: unknown): RegionFeature[] {
  if (!isRecord(value) || value.type !== 'FeatureCollection' || !Array.isArray(value.features) || !value.features.every(isRegionFeature)) throw new Error('Format GeoJSON batas wilayah tidak valid.');
  return value.features;
}
