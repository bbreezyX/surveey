import type { SurveyPoint } from '../../src/shared/survey/types';
import { buildDisplayParts, toDisplayCase } from '../../src/shared/survey/display';
import { formatCoordPair } from '../../src/shared/survey/coordinates';
import { desaGroups, groupHead, landmarkFor } from '../../src/public/state/list-model';
import type { PointRow } from './api';

// The point list uses the public map's own grouping (kecamatan > desa/place >
// numbered unit tiles), so admin rows are turned into the public SurveyPoint
// shape and passed through the same list model. `id` is the admin record id
// (what the editor loads); `nomor` stays the visible identifier.
export interface ListPoint extends SurveyPoint { archived: boolean; revision: number; drafts: number }

export function toListPoint(row: PointRow): ListPoint {
  const s = row.state;
  const lat = Number(s.lat), lon = Number(s.lon);
  const koordinat = Number.isFinite(lat) && Number.isFinite(lon) ? formatCoordPair(lat, lon) : '';
  const belum = s.status === 'Belum Ditetapkan';
  return {
    id: row.id, nomor: s.nomor, nama: s.nama, jalur: s.jalur, alamat: s.alamat, keterangan: s.keterangan,
    tanggal: s.date, photo: '', catatan: s.catatan, latNum: lat, lonNum: lon,
    kabupaten: toDisplayCase(s.nomor.split('-')[0]),
    display: buildDisplayParts(s.nomor, s.keterangan, s.lokasi_rekapan),
    koordinat, koordinatSingkat: belum ? '' : koordinat, searchText: '',
    cadangan: s.status === 'Cadangan', belum, duplikat: !!s.duplikat,
    archived: !!s.archived, revision: row.revision, drafts: row.drafts,
  };
}

// Sections per kabupaten + kecamatan, in list order (the API sorts by Nomor).
export function listSections(rows: PointRow[]) {
  const sections: { key: string; title: string; kabupaten: string; items: ListPoint[] }[] = [];
  for (const row of rows) {
    const point = toListPoint(row);
    const key = `${point.kabupaten}|${point.display.kecamatan}`;
    let section = sections[sections.length - 1];
    if (!section || section.key !== key) {
      section = { key, title: point.display.kecamatan ? `Kec. ${point.display.kecamatan}` : point.kabupaten, kabupaten: point.kabupaten, items: [] };
      sections.push(section);
    }
    section.items.push(point);
  }
  return sections.map(section => ({
    ...section,
    groups: desaGroups(section.items).map(group => {
      const head = groupHead(group, section.title);
      const landmarks = group.items.map(point => landmarkFor(point, `${head.title} ${head.line} ${section.title}`));
      const shared = landmarks.every(mark => mark && mark === landmarks[0]) ? landmarks[0] : '';
      return { key: group.label + group.items[0].display.desa, head, shared, landmarks, items: group.items as ListPoint[] };
    }),
  }));
}
