import type { Counts, PointRow, PointState } from './api';
import type { ListPoint } from './list-points';

export const BATCH_ARCHIVE_LIMIT = 100;

export interface BatchArchiveItem {
  id: string;
  revision: number;
  nomor: string;
  lokasi_rekapan: string;
  cadangan: boolean;
  belum: boolean;
  duplikat: boolean;
  drafts: number;
}

export interface BatchArchiveResult {
  archived: number;
  mode: 'publish' | 'draft';
  publication_id?: string;
  draft_ids?: string[];
}

export function toBatchArchiveItem(point: ListPoint): BatchArchiveItem {
  return {
    id: point.id,
    revision: point.revision,
    nomor: point.nomor,
    lokasi_rekapan: point.display.primary,
    cadangan: point.cadangan,
    belum: point.belum,
    duplikat: point.duplikat,
    drafts: point.drafts,
  };
}

export function batchItemState(item: BatchArchiveItem): PointState {
  return {
    archived: false,
    status: item.cadangan ? 'Cadangan' : item.belum ? 'Belum Ditetapkan' : '',
    duplikat: item.duplikat,
  } as PointState;
}

export function toggleBatchPoint(
  selected: ReadonlyMap<string, BatchArchiveItem>,
  point: ListPoint,
): { next: Map<string, BatchArchiveItem>; limited: boolean } {
  const next = new Map(selected);
  if (point.archived) return { next, limited: false };
  if (next.has(point.id)) {
    next.delete(point.id);
    return { next, limited: false };
  }
  if (next.size >= BATCH_ARCHIVE_LIMIT) {
    return { next, limited: true };
  }
  next.set(point.id, toBatchArchiveItem(point));
  return { next, limited: false };
}

export function toggleBatchGroup(
  selected: ReadonlyMap<string, BatchArchiveItem>,
  points: readonly ListPoint[],
): { next: Map<string, BatchArchiveItem>; limited: boolean } {
  const selectable = points.filter(point => !point.archived);
  const next = new Map(selected);
  if (!selectable.length) return { next, limited: false };
  const allSelected = selectable.every(point => next.has(point.id));
  if (allSelected) {
    for (const point of selectable) next.delete(point.id);
    return { next, limited: false };
  }
  let limited = false;
  for (const point of selectable) {
    if (next.has(point.id)) continue;
    if (next.size >= BATCH_ARCHIVE_LIMIT) {
      limited = true;
      break;
    }
    next.set(point.id, toBatchArchiveItem(point));
  }
  return { next, limited };
}

// Refresh revisions/flags for selected points visible in the latest page load,
// and drop points that have already been archived elsewhere.
export function syncBatchSelection(
  selected: ReadonlyMap<string, BatchArchiveItem>,
  rows: readonly PointRow[],
): Map<string, BatchArchiveItem> {
  if (!selected.size || !rows.length) return new Map(selected);
  const byId = new Map(rows.map(row => [row.id, row]));
  const next = new Map<string, BatchArchiveItem>();
  for (const [id, item] of selected) {
    const fresh = byId.get(id);
    if (!fresh) {
      next.set(id, item);
      continue;
    }
    if (fresh.state.archived) continue;
    next.set(id, {
      ...item,
      revision: fresh.revision,
      nomor: fresh.state.nomor,
      lokasi_rekapan: fresh.state.lokasi_rekapan || item.lokasi_rekapan,
      cadangan: fresh.state.status === 'Cadangan',
      belum: fresh.state.status === 'Belum Ditetapkan',
      duplikat: !!fresh.state.duplikat,
      drafts: fresh.drafts,
    });
  }
  return next;
}

export function batchArchiveImpact(items: readonly BatchArchiveItem[], counts?: Counts) {
  let official = 0;
  let cadangan = 0;
  let belum = 0;
  let duplikat = 0;
  let withDrafts = 0;
  for (const item of items) {
    if (item.cadangan) cadangan++;
    else official++;
    if (item.belum) belum++;
    if (item.duplikat) duplikat++;
    if (item.drafts > 0) withDrafts++;
  }
  return {
    total: items.length,
    official,
    cadangan,
    belum,
    duplikat,
    withDrafts,
    officialAfter: counts ? Math.max(0, counts.official - official) : null,
    cadanganAfter: counts ? Math.max(0, counts.cadangan - cadangan) : null,
  };
}
