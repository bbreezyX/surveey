import { api, ApiError, type Detail, type PointState } from './api';

// One point's editing session. The C layout splits it across two places:
// the centre sheet (data, coordinates, review, save) and the right wing
// (photos, location map, history), so the state lives here rather than in
// either component. A new instance per loaded detail resets everything,
// as remounting the old single Editor component did.
export class PointEditor {
  readonly detail: Detail;
  edit = $state<PointState>() as PointState;
  mode = $state<'correction' | 'visit'>('correction');
  surveyDate = $state(''); source = $state(''); notes = $state('');
  reason = $state('');
  // Restoring a revision or revoking a photo needs its own reason; it used to
  // share the edit form's field on a separate tab.
  historyReason = $state('');
  busy = $state(false); error = $state(''); conflict = $state(false); uploaded = $state('');
  changed = $derived(Object.keys(this.edit).filter(key => this.edit[key as keyof PointState] !== this.detail.state[key as keyof PointState]));

  constructor(detail: Detail, private hooks: { onSaved: (message: string) => void }) {
    this.detail = detail;
    this.edit = structuredClone($state.snapshot(detail.state)) as PointState;
  }

  async upload(event: Event) {
    const input = event.currentTarget as HTMLInputElement, file = input.files?.[0];
    if (!file) return;
    this.busy = true; this.error = '';
    try {
      const data = new FormData(); data.set('point_id', this.detail.id); data.set('file', file);
      const photo = await api<{ id: string; width: number; height: number }>('photos', 'POST', data);
      this.edit.photo_id = photo.id; this.uploaded = `${photo.width} × ${photo.height} piksel · siap disimpan dalam draf`;
    } catch (e) { this.error = e instanceof Error ? e.message : 'Unggah gagal.'; }
    finally { this.busy = false; input.value = ''; }
  }

  async save(event: SubmitEvent) {
    event.preventDefault(); this.busy = true; this.error = ''; this.conflict = false;
    try {
      await api('drafts', 'POST', { point_id: this.detail.id, base_revision: this.detail.revision,
        proposed: { state: $state.snapshot(this.edit), new_observation: this.mode === 'visit' ? { date: this.surveyDate, source: this.source, notes: this.notes } : null }, reason: this.reason });
      this.hooks.onSaved('Draf tersimpan. Peta publik berubah setelah penerbitan.');
    } catch (e) { this.error = e instanceof Error ? e.message : 'Simpan gagal.'; this.conflict = e instanceof ApiError && e.status === 409; }
    finally { this.busy = false; }
  }

  async restore(number: number) {
    this.busy = true; this.error = '';
    try { await api(`points/${this.detail.id}/restorations`, 'POST', { revision: number, base_revision: this.detail.revision, reason: this.historyReason }); this.hooks.onSaved('Draf pemulihan tersimpan untuk ditinjau.'); }
    catch (e) { this.error = e instanceof Error ? e.message : 'Pemulihan gagal.'; }
    finally { this.busy = false; }
  }

  async revoke(id: string) {
    this.busy = true; this.error = '';
    try { await api(`photos/${id}/revocations`, 'POST', { reason: this.historyReason }); this.hooks.onSaved('Akses publik foto dicabut. Bukti asli tetap tersimpan privat.'); }
    catch (e) { this.error = e instanceof Error ? e.message : 'Pencabutan gagal.'; }
    finally { this.busy = false; }
  }
}

export type BadgeKind = 'sk' | 'cadangan' | 'belum' | 'duplikat' | 'arsip';
export function badgeOf(state: PointState): { kind: BadgeKind; label: string } {
  if (state.archived) return { kind: 'arsip', label: 'Arsip' };
  if (state.status === 'Cadangan') return { kind: 'cadangan', label: 'Cadangan' };
  if (state.status === 'Belum Ditetapkan') return { kind: 'belum', label: 'Belum ditetapkan' };
  if (state.duplikat) return { kind: 'duplikat', label: 'Perlu verifikasi' };
  return { kind: 'sk', label: 'Alokasi utama' };
}
