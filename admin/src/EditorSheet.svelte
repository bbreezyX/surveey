<script lang="ts">
  import { distance, formatDistance, pasteCoordinates, type PointState } from './api';
  import { badgeOf, type PointEditor } from './editor.svelte';
  import { stageBadgeSvg, stageDone, stageSummary } from '../../src/shared/survey/progress';
  import Select from './Select.svelte';
  import AddressPicker from './AddressPicker.svelte';
  let { editor, canPublish = false, stage = 0, onReload }: { editor: PointEditor; canPublish?: boolean; stage?: number; onReload: () => void } = $props();
  const labels: Record<string, string> = { nomor: 'Nomor', nama: 'Pengusul', jalur: 'Jalur', alamat: 'Alamat Lengkap', keterangan: 'Keterangan',
    lokasi_rekapan: 'Lokasi Rekapan', catatan: 'Catatan', status: 'Status Alokasi', duplikat: 'Perlu Verifikasi', archived: 'Diarsipkan', lat: 'Latitude', lon: 'Longitude', photo_id: 'Foto', date: 'Tanggal' };
  let detail = $derived(editor.detail);
  let edit = $derived(editor.edit);
  let badge = $derived(badgeOf(detail.state));
  let form: HTMLFormElement;
  $effect(() => editor.remember());
  // The address text opens on request; it stays open when the wilayah list failed, since typing is then the only way.
  let addressOpen = $state(false), pickerFailed = $state(false);
  // The review table showed raw "true"/"false" and a blank cell for an emptied field.
  const shown = (value: unknown) => value === true ? 'Ya' : value === false ? 'Tidak' : value == null || value === '' ? '—' : String(value);
  const counted = (state: PointState) => state.archived || state.status === 'Cadangan' ? 0 : 1;
  let hasChanges = $derived(!!editor.changed.length || editor.mode === 'visit');
  // The footer says why the button is off, or what saving will do.
  let footNote = $derived(
    editor.restored ? 'Isian belum tersimpan dipulihkan.'
    : !hasChanges ? 'Belum ada perubahan.'
    : canPublish
      ? (detail.own_draft ? 'Siap diterbitkan dari draf Anda, atau perbarui draf.' : `${editor.changed.length ? `${editor.changed.length} perubahan` : 'Kunjungan baru'} · siap diterbitkan.`)
      : detail.own_draft ? 'Menyimpan memperbarui draf Anda.'
      : `${editor.changed.length ? `${editor.changed.length} perubahan` : 'Kunjungan baru'} · peta publik belum berubah.`);
  function saveAsDraft() { if (form.reportValidity()) void editor.save(); }
</script>
<div class="edit-head">
  <div class="edit-title">
    <h2>{detail.state.lokasi_rekapan || detail.state.nomor}</h2>
    <p class="edit-id">{detail.state.nomor}</p>
    <p class="edit-meta"><span class="badge badge--{badge.kind}">{badge.label}</span>{#if stage}<span class="badge badge--stage" class:is-done={stageDone(stage)}>{@html stageBadgeSvg(stage)}{stageSummary(stage)}</span>{/if}{#if detail.drafts}<span class="badge badge--draf">{detail.drafts > 1 ? `${detail.drafts} Draf Menunggu` : 'Draf Menunggu'}</span>{/if}<span>Revisi {detail.revision}</span></p>
  </div>
  <button class="btn-ghost" type="button" onclick={() => { editor.forget(); onReload(); }} disabled={editor.busy}>Muat Ulang</button>
</div>
{#if editor.error}<p class="notice-error edit-notice" role="alert">{editor.error}</p>{/if}
{#if editor.conflict}<p class="hint edit-notice">Perubahan ini masih tampil di formulir dan akan terganti saat “Muat Ulang” memuat revisi terbaru. Penyimpanan berikutnya mengacu pada revisi terbaru tersebut.</p>{/if}
<form class="edit-form" bind:this={form} onsubmit={event => canPublish ? editor.publish(event) : editor.save(event)}>
  <div class="edit-scroll">
    <fieldset disabled={editor.busy}><legend>Data Alokasi</legend>
      <AddressPicker bind:value={edit.alamat} bind:failed={pickerFailed}/>
      {#if addressOpen || pickerFailed}
        <label class="field">Alamat Lengkap<textarea bind:value={edit.alamat} rows="2" maxlength="3000"></textarea></label>
      {:else}
        <p class="address-line"><span>{edit.alamat || 'Alamat belum diisi.'}</span><button class="text-action" type="button" onclick={() => addressOpen = true}>Ubah Teks</button></p>
      {/if}
      <div class="pair"><label class="field">Pengusul<input bind:value={edit.nama} maxlength="250" placeholder="Belum Diisi"></label><label class="field">Jalur<input bind:value={edit.jalur} maxlength="250" placeholder="Belum Diisi"></label></div>
      <label class="field">Lokasi Rekapan<textarea bind:value={edit.lokasi_rekapan} rows="2" maxlength="3000"></textarea></label>
      <label class="field">Keterangan<textarea bind:value={edit.keterangan} rows="2" maxlength="3000" placeholder="Opsional"></textarea></label>
      <label class="field">Status Alokasi<Select label="Status Alokasi" bind:value={edit.status} options={[{ value: '', label: 'Alokasi Utama' }, { value: 'Cadangan', label: 'Cadangan' }, { value: 'Belum Ditetapkan', label: 'Belum Ditetapkan' }]}/></label>
      <label class="field">Catatan<textarea bind:value={edit.catatan} rows="2" maxlength="6000" placeholder="Opsional"></textarea></label>
    </fieldset>
    <fieldset disabled={editor.busy}><legend>Koordinat</legend>
      <!-- Wheel over a focused number input steps it; blurring keeps a scroll through the form from moving the point. -->
      <div class="pair"><label class="field">Latitude<span class="field__req" aria-hidden="true">*</span><input type="number" min="-90" max="90" step="any" bind:value={edit.lat} onpaste={event => pasteCoordinates(event, edit)} onwheel={event => event.currentTarget.blur()} required></label><label class="field">Longitude<span class="field__req" aria-hidden="true">*</span><input type="number" min="-180" max="180" step="any" bind:value={edit.lon} onpaste={event => pasteCoordinates(event, edit)} onwheel={event => event.currentTarget.blur()} required></label></div>
      <p class="hint">Bergeser <strong>{formatDistance(distance(detail.state, edit))}</strong> · tempel “lat, long” atau geser pin di peta.</p>
      <label class="switch-row"><span class="ctl-switch"><input type="checkbox" bind:checked={edit.duplikat}><span class="ctl-switch__track" aria-hidden="true"><span class="ctl-switch__thumb"></span></span></span>Perlu Verifikasi Lapangan (Duplikat)</label>
    </fieldset>
    <fieldset disabled={editor.busy}><legend>Pengamatan Survei</legend>
      <label class="field">Jenis Perubahan<Select label="Jenis Perubahan" bind:value={editor.mode} options={[{ value: 'correction', label: 'Koreksi Foto / Data pada Pengamatan yang Ada' }, { value: 'visit', label: 'Kunjungan Survei Baru' }]}/></label>
      {#if editor.mode === 'visit'}
        <label class="field">Tanggal Kunjungan<span class="field__req" aria-hidden="true">*</span><input type="date" bind:value={editor.surveyDate} required></label>
        <label class="field">Sumber / Referensi Survei<span class="field__req" aria-hidden="true">*</span><input bind:value={editor.source} maxlength="3000" required></label>
        <label class="field">Catatan Kunjungan<textarea bind:value={editor.notes} rows="2" maxlength="6000" placeholder="Opsional"></textarea></label>
      {:else}<p class="hint">Tanggal {edit.date || 'belum diketahui'} dan bukti lama tetap disimpan.</p>{/if}
    </fieldset>
    <fieldset disabled={editor.busy}><legend>Arsip</legend>
      <div class="archive-row">
        <label class="switch-row"><span class="ctl-switch"><input type="checkbox" bind:checked={edit.archived}><span class="ctl-switch__track" aria-hidden="true"><span class="ctl-switch__thumb"></span></span></span>Arsipkan Titik</label>
        <p>Keluar dari jumlah resmi dan peta publik</p>
      </div>
    </fieldset>
    <fieldset disabled={editor.busy}><legend>Tinjau Perubahan</legend>
      {#if editor.changed.length}<div class="table-wrap"><table><thead><tr><th>Data</th><th>Lama</th><th>Baru</th></tr></thead><tbody>{#each editor.changed as key}<tr><th>{labels[key] || key}</th><td>{shown(detail.state[key as keyof PointState])}</td><td>{shown(edit[key as keyof PointState])}</td></tr>{/each}</tbody></table></div>{/if}
      <p class="hint">Jumlah Resmi: <strong>{counted(detail.state)} → {counted(edit)}</strong>{#if edit.status === 'Belum Ditetapkan'} (belum ditetapkan tetap dihitung){/if}</p>
      <label class="field">Alasan Perubahan<textarea bind:value={editor.reason} rows="2" maxlength="3000" placeholder="Opsional — terisi otomatis bila dikosongkan"></textarea></label>
    </fieldset>
  </div>
  <div class="edit-foot">
    <p>{footNote}</p>
    <div class="edit-foot__actions">
      {#if canPublish}
        <button class="btn-ghost" type="button" onclick={saveAsDraft} disabled={editor.busy || !hasChanges}>{detail.own_draft ? 'Perbarui Draf' : 'Simpan Draf'}</button>
        <button class="btn-primary" type="submit" disabled={editor.busy || !hasChanges}>{editor.busy ? 'Menerbitkan…' : 'Simpan & Terbitkan'}</button>
      {:else}
        <button class="btn-primary" type="submit" disabled={editor.busy || !hasChanges}>{editor.busy ? 'Memproses…' : detail.own_draft ? 'Perbarui Draf' : 'Simpan Draf'}</button>
      {/if}
    </div>
  </div>
</form>
