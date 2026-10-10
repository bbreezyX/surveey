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
  // True when the form came back from unsaved input kept in this browser.
  restored = $state(false);
  // The form as loaded (own draft or published state), to tell unsaved input apart.
  private basis = '';
  changed = $derived(Object.keys(this.edit).filter(key => this.edit[key as keyof PointState] !== this.detail.state[key as keyof PointState]));

  constructor(detail: Detail, private hooks: { onSaved: (message: string) => void }) {
    this.detail = detail;
    // A saved draft reopens in the form, so saving again revises it.
    const own = detail.own_draft;
    this.edit = structuredClone($state.snapshot(own ? own.proposed.state : detail.state)) as PointState;
    if (own) {
      this.reason = own.reason;
      const visit = own.proposed.new_observation;
      if (visit) { this.mode = 'visit'; this.surveyDate = visit.date; this.source = visit.source; this.notes = visit.notes; }
    }
    this.basis = JSON.stringify(this.input());
    // Unsaved input survives switching points or reloading the page, but only
    // against the same revision and draft it was typed over.
    try {
      const kept = JSON.parse(localStorage.getItem(this.key) ?? 'null');
      if (kept && kept.revision === detail.revision && kept.draft === (own?.id ?? null)) {
        Object.assign(this, kept.input); this.restored = true;
      }
    } catch { /* storage unavailable: start from the loaded form */ }
  }

  private get key() { return `survey-admin-unsaved:${this.detail.id}`; }
  private input() {
    return { edit: $state.snapshot(this.edit), mode: this.mode, surveyDate: this.surveyDate, source: this.source, notes: this.notes, reason: this.reason };
  }
  // Called from an effect, so it re-runs on every edit.
  remember() {
    const input = this.input();
    try {
      if (JSON.stringify(input) === this.basis) localStorage.removeItem(this.key);
      else localStorage.setItem(this.key, JSON.stringify({ revision: this.detail.revision, draft: this.detail.own_draft?.id ?? null, input }));
    } catch { /* storage unavailable: nothing is kept */ }
  }
  forget() { try { localStorage.removeItem(this.key); } catch { /* nothing kept */ } }

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
      this.forget();
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
