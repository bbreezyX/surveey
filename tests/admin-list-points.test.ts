import { expect, it } from 'vitest';
import { emptyState, type PointRow } from '../admin/src/api';
import { listSections } from '../admin/src/list-points';

it('groups a kecamatan even when database sort order interleaves similar names', () => {
  const rows: PointRow[] = [
    'KERINCI-SIULAK-DESA A-001',
    'KERINCI-SIULAK MUKAI-DESA B-001',
    'KERINCI-SIULAK-DESA C-001',
  ].map(nomor => ({ id: nomor, revision: 1, drafts: 0, state: { ...emptyState(), nomor } }));

  const sections = listSections(rows);
  expect(sections.map(section => section.title)).toEqual(['Kec. Siulak', 'Kec. Siulak Mukai']);
  expect(sections[0].items.map(point => point.nomor)).toEqual([rows[0].state.nomor, rows[2].state.nomor]);
});
