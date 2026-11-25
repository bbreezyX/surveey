import { describe, expect, it } from 'vitest';
import { emptyState, type PointRow } from '../admin/src/api';
import { toListPoint } from '../admin/src/list-points';
import {
  BATCH_ARCHIVE_LIMIT,
  batchArchiveImpact,
  syncBatchSelection,
  toggleBatchGroup,
  toggleBatchPoint,
  type BatchArchiveItem,
} from '../admin/src/batch-archive';

function makeRow(index: number, overrides: Partial<PointRow['state']> = {}, extra: Partial<PointRow> = {}): PointRow {
  const code = String(index).padStart(3, '0');
  const nomor = `MERANGIN-TIANG PUMPUNG-SEKANCING-${code}`;
  return {
    id: `pt-${index}`,
    revision: 1,
    drafts: 0,
    ...extra,
    state: {
      ...emptyState(),
      nomor,
      lokasi_rekapan: `Desa Sekancing (${code})`,
      lat: -2.255,
      lon: 102.187,
      ...overrides,
    },
  };
}

describe('batch archive selection helpers', () => {
  it('toggles active points, ignores archived points, and enforces the 100-point limit', () => {
    const active = toListPoint(makeRow(1));
    const archived = toListPoint(makeRow(2, { archived: true }));

    let selected = new Map<string, BatchArchiveItem>();
    let res = toggleBatchPoint(selected, archived);
    expect(res.next.size).toBe(0);
    expect(res.limited).toBe(false);

    res = toggleBatchPoint(selected, active);
    expect(res.next.has(active.id)).toBe(true);
    selected = res.next;

    res = toggleBatchPoint(selected, active);
    expect(res.next.size).toBe(0);

    // Fill up to limit, then try adding one more.
    const full = new Map<string, BatchArchiveItem>();
    for (let i = 1; i <= BATCH_ARCHIVE_LIMIT; i++) {
      const point = toListPoint(makeRow(i));
      full.set(point.id, {
        id: point.id,
        revision: 1,
        nomor: point.nomor,
        lokasi_rekapan: point.display.primary,
        cadangan: false,
        belum: false,
        duplikat: false,
        drafts: 0,
      });
    }
    const extra = toListPoint(makeRow(BATCH_ARCHIVE_LIMIT + 1));
    const capped = toggleBatchPoint(full, extra);
    expect(capped.next.size).toBe(BATCH_ARCHIVE_LIMIT);
    expect(capped.limited).toBe(true);
    expect(capped.next.has(extra.id)).toBe(false);
  });

  it('toggles a desa or page group skipping archived units and clears when all are selected', () => {
    const points = [
      toListPoint(makeRow(1)),
      toListPoint(makeRow(2, { status: 'Cadangan' })),
      toListPoint(makeRow(3, { archived: true })),
    ];

    const first = toggleBatchGroup(new Map(), points);
    expect([...first.next.keys()]).toEqual(['pt-1', 'pt-2']);
    expect(first.limited).toBe(false);

    const second = toggleBatchGroup(first.next, points);
    expect(second.next.size).toBe(0);
  });

  it('refreshes revisions and drops newly archived points during list reloads', () => {
    const p1 = toListPoint(makeRow(1));
    const p2 = toListPoint(makeRow(2));
    const initial = toggleBatchGroup(new Map(), [p1, p2]).next;

    const synced = syncBatchSelection(initial, [
      makeRow(1, { duplikat: true }, { revision: 3, drafts: 2 }),
      makeRow(2, { archived: true }, { revision: 2 }),
    ]);

    expect([...synced.keys()]).toEqual(['pt-1']);
    expect(synced.get('pt-1')?.revision).toBe(3);
    expect(synced.get('pt-1')?.duplikat).toBe(true);
    expect(synced.get('pt-1')?.drafts).toBe(2);
  });

  it('computes official and cadangan count impact accurately', () => {
    const points = [
      toListPoint(makeRow(1)),
      toListPoint(makeRow(2, { status: 'Belum Ditetapkan' }, { drafts: 1 })),
      toListPoint(makeRow(3, { status: 'Cadangan' })),
    ];
    const items = [...toggleBatchGroup(new Map(), points).next.values()];
    const impact = batchArchiveImpact(items, { total: 526, official: 500, cadangan: 26, belum: 1, duplikat: 13 });

    expect(impact).toEqual({
      total: 3,
      official: 2,
      cadangan: 1,
      belum: 1,
      duplikat: 0,
      withDrafts: 1,
      officialAfter: 498,
      cadanganAfter: 25,
    });
  });
});
