<script lang="ts">
  import { distance, formatDistance, type PointState } from './api';
  import { badgeOf, type PointEditor } from './editor.svelte';
  import Select from './Select.svelte';
  import AddressPicker from './AddressPicker.svelte';
  let { editor, onReload }: { editor: PointEditor; onReload: () => void } = $props();
  const labels: Record<string, string> = { nomor: 'Nomor', nama: 'Pengusul', jalur: 'Jalur', alamat: 'Alamat lengkap', keterangan: 'Keterangan',
    lokasi_rekapan: 'Lokasi rekapan', catatan: 'Catatan', status: 'Status alokasi', duplikat: 'Perlu verifikasi', archived: 'Diarsipkan', lat: 'Latitude', lon: 'Longitude', photo_id: 'Foto', date: 'Tanggal' };
  let detail = $derived(editor.detail);
  let edit = $derived(editor.edit);
  let badge = $derived(badgeOf(detail.state));
</script>
<div class="edit-head">
  <div class="edit-title">
    <h2>{detail.state.lokasi_rekapan || detail.state.nomor}</h2>
    <p class="edit-id">{detail.state.nomor}</p>
    <p class="edit-meta"><span class="badge badge--{badge.kind}">{badge.label}</span><span>Revisi {detail.revision}</span></p>
  </div>
  <button class="btn-ghost" type="button" onclick={onReload} disabled={editor.busy}>Muat ulang</button>
</div>
{#if editor.error}<p class="notice-error edit-notice" role="alert">{editor.error}</p>{/if}
{#if editor.conflict}<p class="hint edit-notice">Usulan ini masih tampil di formulir dan akan terganti saat “Muat ulang” memuat revisi terbaru. Penyimpanan berikutnya mengacu pada revisi terbaru tersebut.</p>{/if}
<form class="edit-form" onsubmit={event => editor.save(event)}>
  <div class="edit-scroll">
    <fieldset disabled={editor.busy}><legend>Data alokasi</legend>
      <AddressPicker bind:value={edit.alamat}/>
      <label class="field">Alamat lengkap<textarea bind:value={edit.alamat} rows="2" maxlength="3000"></textarea></label>
      <div class="pair"><label class="field">Pengusul<input bind:value={edit.nama} maxlength="250"></label><label class="field">Jalur<input bind:value={edit.jalur} maxlength="250"></label></div>
      <label class="field">Lokasi rekapan<textarea bind:value={edit.lokasi_rekapan} rows="2" maxlength="3000"></textarea></label>
      <label class="field">Keterangan<textarea bind:value={edit.keterangan} rows="2" maxlength="3000"></textarea></label>
      <label class="field">Status alokasi<Select label="Status alokasi" bind:value={edit.status} options={[{ value: '', label: 'Alokasi utama' }, { value: 'Cadangan', label: 'Cadangan' }, { value: 'Belum Ditetapkan', label: 'Belum ditetapkan' }]}/></label>
      <label class="switch-row"><span class="ctl-switch"><input type="checkbox" bind:checked={edit.duplikat}><span class="ctl-switch__track" aria-hidden="true"><span class="ctl-switch__thumb"></span></span></span>Koordinat perlu verifikasi (Duplikat)</label>
      <label class="switch-row"><span class="ctl-switch"><input type="checkbox" bind:checked={edit.archived}><span class="ctl-switch__track" aria-hidden="true"><span class="ctl-switch__thumb"></span></span></span>Arsipkan titik</label>
      <label class="field">Catatan<textarea bind:value={edit.catatan} rows="2" maxlength="6000"></textarea></label>
    </fieldset>
    <fieldset disabled={editor.busy}><legend>Koordinat</legend>
      <div class="pair"><label class="field">Latitude<input type="number" min="-90" max="90" step="any" bind:value={edit.lat} required></label><label class="field">Longitude<input type="number" min="-180" max="180" step="any" bind:value={edit.lon} required></label></div>
      <p class="hint">Perpindahan dari lokasi saat ini: <strong>{formatDistance(distance(detail.state, edit))}</strong>. Pin dapat digeser pada peta di panel Foto & lokasi.</p>
    </fieldset>
    <fieldset disabled={editor.busy}><legend>Pengamatan survei</legend>
      <label class="field">Jenis perubahan<Select label="Jenis perubahan" bind:value={editor.mode} options={[{ value: 'correction', label: 'Koreksi foto / data pada pengamatan yang ada' }, { value: 'visit', label: 'Kunjungan survei baru' }]}/></label>
      {#if editor.mode === 'visit'}
        <label class="field">Tanggal kunjungan<input type="date" bind:value={editor.surveyDate} required></label>
        <label class="field">Sumber / referensi survei<input bind:value={editor.source} maxlength="3000" required></label>
        <label class="field">Catatan kunjungan<textarea bind:value={editor.notes} rows="2" maxlength="6000"></textarea></label>
      {:else}<p class="hint">Tanggal dokumentasi tetap {edit.date || 'belum diketahui'}. Bukti lama tetap disimpan. Koreksi koordinat mengubah lokasi saat ini dan tidak menimpa koordinat pengamatan lama.</p>{/if}
    </fieldset>
    <fieldset disabled={editor.busy}><legend>Tinjau perubahan</legend>
      {#if editor.changed.length}<div class="table-wrap"><table><thead><tr><th>Data</th><th>Saat ini</th><th>Usulan</th></tr></thead><tbody>{#each editor.changed as key}<tr><th>{labels[key] || key}</th><td>{String(detail.state[key as keyof PointState] ?? '—')}</td><td>{String(edit[key as keyof PointState] ?? '—')}</td></tr>{/each}</tbody></table></div>{:else}<p class="hint">Belum ada perubahan data alokasi atau lokasi.</p>{/if}
      <p class="hint">Kontribusi ke jumlah resmi: <strong>{detail.state.archived || detail.state.status === 'Cadangan' ? 0 : 1} → {edit.archived || edit.status === 'Cadangan' ? 0 : 1}</strong>. Titik “Belum Ditetapkan” tetap termasuk alokasi resmi.</p>
      <label class="field">Alasan perubahan<textarea bind:value={editor.reason} rows="2" maxlength="3000" required></textarea></label>
    </fieldset>
  </div>
  <div class="edit-foot">
    <p>Draf belum mengubah peta publik.</p>
    <button class="btn-primary" type="submit" disabled={editor.busy || (!editor.changed.length && editor.mode !== 'visit')}>{editor.busy ? 'Memproses…' : 'Simpan draf'}</button>
  </div>
</form>
