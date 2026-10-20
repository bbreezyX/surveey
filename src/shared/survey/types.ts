import type { FeatureCollection, Feature, Polygon, MultiPolygon } from 'geojson';
export type SurveyProperties = Record<string, unknown>;
export interface PointFlags { cadangan: boolean; belum: boolean; duplikat: boolean }
export type StatusFilter = keyof PointFlags | null;
export interface CoordinatePair { lat: number; lon: number }
export interface DisplayParts { code: string; primary: string; secondary: string; showsKeterangan: boolean; desa: string; kecamatan: string }
export interface SurveyPoint extends PointFlags {
  id: string; nomor: string; nama: string; jalur: string; alamat: string;
  keterangan: string; tanggal: string; photo: string; catatan: string;
  latNum: number; lonNum: number; kabupaten: string; display: DisplayParts;
  koordinat: string; koordinatSingkat: string; searchText: string;
}
export type RegionFeature = Feature<Polygon | MultiPolygon, Record<string, unknown>>;
// storedAt: when the offline copy being shown was saved (ms since epoch); null when the data came from the network.
// signature: a hash of the points file as received, so a reload can tell whether anything actually changed.
export interface SurveyDataset { points: SurveyPoint[]; boundaries: RegionFeature[]; dissolved: FeatureCollection; storedAt?: number | null; signature?: string }
