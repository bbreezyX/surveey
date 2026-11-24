<script lang="ts">
  import { api, distance, formatDistance, pasteCoordinates, type PointState } from './api';
  import type { MapPoint } from './backdrop';
  import { badgeOf, type PointEditor } from './editor.svelte';
  import { formatPointFieldValue, pointFieldLabel } from './labels';
  import { PENDING_CLOCK_SVG, pendingSummary, stageBadgeSvg, stageDone, stageSummary } from '../../src/shared/survey/progress';
  import {
    clearsVerificationOnOldPin, nearbyOfficialPoints, nomorPrefixFromAddress,
    OLD_PIN_WARNING, outsideJambi, OUTSIDE_JAMBI_WARNING, samePlace,
  } from './verification';
  import Select from './Select.svelte';
  import AddressPicker from './AddressPicker.svelte';
  // pending: stages reported from esdm.cloud/lapangan and not yet accepted there.
  let { editor, canPublish = false, stage = 0, pending = null, nearby = [], onReload, onOpenPhotoPane }: {
    editor: PointEditor; canPublish?: boolean; stage?: number; pending?: readonly number[] | null;
    nearby?: readonly MapPoint[]; onReload: () => void; onOpenPhotoPane?: () => void;
  } = $props();
  let detail = $derived(editor.detail);
  let edit = $derived(editor.edit);
  let badge = $derived(badgeOf(detail.state));
  let form: HTMLFormElement;
  $effect(() => editor.remember());
  // The address text opens on request; it stays open when the wilayah list failed, since typing is then the only way.
  let addressOpen = $state(false), pickerFailed = $state(false);
  let confirmingDiscard = $state(false);
  let predictedNomor = $state<string | null>(null);
  let nomorRequest = 0;

  let movedPrefix = $derived.by(() => {
    const prefix = nomorPrefixFromAddress(edit.alamat);
    return prefix && !samePlace(detail.state.nomor, prefix) ? prefix : null;
  });
  let hasFieldProgress = $derived(stage > 0 || !!(pending && pending.length));
  let coordOutOfProvince = $derived(outsideJambi(edit.lat, edit.lon));
  let nearbyConflicts = $derived(nearbyOfficialPoints(edit, nearby, detail.id));
  let movedDistance = $derived(distance(detail.state, edit));

  $effect(() => {
    const alamat = edit.alamat;
    if (!movedPrefix) { predictedNomor = null; return; }
    // Keep the already-assigned Nomor when reopening an own draft that moved to the same desa.
    const ownNomor = detail.own_draft?.proposed.state.nomor;
    if (ownNomor && ownNomor.toUpperCase().startsWith(`${movedPrefix}-`)) {
      predictedNomor = ownNomor;
      return;
    }
    const req = ++nomorRequest;
    const timer = setTimeout(() => {
      api<{ nomor: string | null }>(`points/next-nomor?${new URLSearchParams({ alamat })}`)
        .then(result => { if (req === nomorRequest) predictedNomor = result.nomor; })
        .catch(() => { if (req === nomorRequest) predictedNomor = `${movedPrefix}-…`; });
    }, 220);
    return () => clearTimeout(timer);
  });

  const counted = (state: PointState) => state.archived || state.status === 'Cadangan' ? 0 : 1;
  let hasChanges = $derived(!!editor.changed.length || editor.mode === 'visit');
  // The footer says why the button is off, or what saving will do.
  let footNote = $derived(
    editor.visitNeedsPhoto ? 'Unggah foto bukti baru untuk kunjungan survei baru.'
    : editor.restored ? 'Isian belum tersimpan dipulihkan.'
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
    <p class="edit-meta"><span class="badge badge--{badge.kind}">{badge.label}</span>{#if stage}<span class="badge badge--stage" class:is-done={stageDone(stage)}>{@html stageBadgeSvg(stage)}{stageSummary(stage)}</span>{/if}{#if pending}<span class="badge badge--pending">{@html PENDING_CLOCK_SVG}{pendingSummary(pending)}</span>{/if}{#if detail.drafts}<span class="badge badge--draf">{detail.drafts > 1 ? `${detail.drafts} Draf Menunggu` : 'Draf Menunggu'}</span>{/if}<span>Revisi {detail.revision}</span></p>
  </div>
  <div class="edit-head__actions">
    {#if hasChanges || editor.restored}<button class="text-action" type="button" onclick={() => editor.resetToPublished()} disabled={editor.busy}>Reset</button>{/if}
    <button class="btn-ghost" type="button" onclick={() => { editor.forget(); onReload(); }} disabled={editor.busy}>Muat Ulang</button>
  </div>
</div>
{#if editor.error}<p class="notice-error edit-notice" role="alert">{editor.error}</p>{/if}
{#if editor.conflict}<p class="hint edit-notice">Perubahan ini masih tampil di formulir dan akan terganti saat “Muat Ulang” memuat revisi terbaru. Penyimpanan berikutnya mengacu pada revisi terbaru tersebut.</p>{/if}
{#if editor.ownDraftStale}
  <div class="pin-warning edit-notice" role="status">
    <p>Draf Anda dibuat dari Revisi {detail.own_draft?.base_revision}, sedangkan data terbit kini Revisi {detail.revision}. Tinjau tabel perubahan atau reset ke data terbit agar perubahan terbaru tidak tertimpa.</p>
    <div class="inline-actions">
      <button type="button" class="text-action" disabled={editor.busy} onclick={() => editor.resetToPublished()}>Reset ke Data Terbit</button>
      <button type="button" class="text-action text-action--danger" disabled={editor.busy} onclick={() => editor.discardOwnDraft()}>Batalkan Draf Saya</button>
    </div>
  </div>
{:else if detail.own_draft}
  <div class="draft-banner edit-notice">
    <span>Membuka draf Anda{detail.own_draft.proposed.restore_revision ? ` (pemulihan Revisi ${detail.own_draft.proposed.restore_revision})` : ''}.</span>
    {#if confirmingDiscard}
      <span class="inline-actions">
        <button type="button" class="text-action text-action--danger" disabled={editor.busy} onclick={() => { confirmingDiscard = false; void editor.discardOwnDraft(); }}>Ya, Batalkan</button>
        <button type="button" class="text-action" disabled={editor.busy} onclick={() => confirmingDiscard = false}>Tidak</button>
      </span>
    {:else}
      <button type="button" class="text-action text-action--danger" disabled={editor.busy} onclick={() => confirmingDiscard = true}>Batalkan Draf Saya</button>
    {/if}
  </div>
{/if}
<form class="edit-form" bind:this={form} onsubmit={event => canPublish ? editor.publish(event) : editor.save(event)}>
  <div class="edit-scroll">
    <fieldset disabled={editor.busy}><legend>Data Alokasi</legend>
      <AddressPicker bind:value={edit.alamat} bind:failed={pickerFailed}/>
      {#if addressOpen || pickerFailed}
        <label class="field">Alamat Lengkap<textarea bind:value={edit.alamat} rows="2" maxlength="3000"></textarea></label>
      {:else}
        <p class="address-line"><span>{edit.alamat || 'Alamat belum diisi.'}</span><button class="text-action" type="button" onclick={() => addressOpen = true}>Ubah Teks</button></p>
      {/if}
      <div aria-live="polite">
        {#if movedPrefix}
          <p class="pin-warning">
            Pindah desa akan mengubah Nomor otomatis: <strong>{detail.state.nomor}</strong> → <strong>{predictedNomor ?? `${movedPrefix}-…`}</strong>.
            {#if hasFieldProgress} Unit ini sudah memiliki progres di esdm.cloud — mengubah Nomor dapat memutus pencocokan laporan lapangan.{/if}
          </p>
        {/if}
      </div>
      <div class="pair"><label class="field">Pengusul<input bind:value={edit.nama} maxlength="250" placeholder="Belum Diisi"></label><label class="field">Jalur<input bind:value={edit.jalur} maxlength="250" placeholder="Belum Diisi"></label></div>
      <label class="field">Lokasi Rekapan<textarea bind:value={edit.lokasi_rekapan} rows="2" maxlength="3000"></textarea></label>
      <label class="field">Keterangan<textarea bind:value={edit.keterangan} rows="2" maxlength="3000" placeholder="Opsional"></textarea></label>
      <label class="field">Status Alokasi<Select label="Status Alokasi" bind:value={edit.status} options={[{ value: '', label: 'Alokasi Utama' }, { value: 'Cadangan', label: 'Cadangan' }, { value: 'Belum Ditetapkan', label: 'Belum Ditetapkan' }]}/></label>
      <label class="field">Catatan<textarea bind:value={edit.catatan} rows="2" maxlength="6000" placeholder="Opsional"></textarea></label>
    </fieldset>
    <fieldset disabled={editor.busy}><legend>Koordinat</legend>
      <!-- Wheel over a focused number input steps it; blurring keeps a scroll through the form from moving the point. -->
      <div class="pair"><label class="field">Latitude<span class="field__req" aria-hidden="true">*</span><input type="number" min="-90" max="90" step="any" bind:value={edit.lat} onpaste={event => pasteCoordinates(event, edit)} onwheel={event => event.currentTarget.blur()} required></label><label class="field">Longitude<span class="field__req" aria-hidden="true">*</span><input type="number" min="-180" max="180" step="any" bind:value={edit.lon} onpaste={event => pasteCoordinates(event, edit)} onwheel={event => event.currentTarget.blur()} required></label></div>
      <p class="hint">Bergeser <strong>{formatDistance(movedDistance)}</strong> · tempel “lat, long” atau geser pin di peta.{#if Number.isFinite(movedDistance) && movedDistance > 0} <button type="button" class="link-button" onclick={() => editor.resetCoordinates()}>Kembalikan Koordinat</button>{/if}</p>
      <label class="switch-row"><span class="ctl-switch"><input type="checkbox" bind:checked={edit.duplikat}><span class="ctl-switch__track" aria-hidden="true"><span class="ctl-switch__thumb"></span></span></span>Perlu Verifikasi Lapangan (Duplikat)</label>
      <!-- Polite live region: warnings appear as soon as coordinates or verification flags cross a safety threshold. -->
      <div aria-live="polite">
        {#if coordOutOfProvince}<p class="pin-warning">{OUTSIDE_JAMBI_WARNING}</p>{/if}
        {#if clearsVerificationOnOldPin(detail.state, edit)}<p class="pin-warning">{OLD_PIN_WARNING}</p>{/if}
        {#if nearbyConflicts.length}
          <p class="pin-warning">
            {#if nearbyConflicts[0].stacked}Pin menumpuk ({formatDistance(nearbyConflicts[0].distance_m)}) dengan <strong>{nearbyConflicts[0].nomor}</strong>{:else}Dekat ({formatDistance(nearbyConflicts[0].distance_m)}) dengan <strong>{nearbyConflicts[0].nomor}</strong>{/if}{#if nearbyConflicts.length > 1} dan {nearbyConflicts.length - 1} titik lain{/if}. Foto lapangan dalam radius 30 m dapat tertukar ke pin terdekat di esdm.cloud.
          </p>
        {/if}
      </div>
    </fieldset>
    <fieldset disabled={editor.busy}><legend>Pengamatan Survei</legend>
      <label class="field">Jenis Perubahan<Select label="Jenis Perubahan" bind:value={editor.mode} options={[{ value: 'correction', label: 'Koreksi Foto / Data pada Pengamatan yang Ada' }, { value: 'visit', label: 'Kunjungan Survei Baru' }]}/></label>
      {#if editor.mode === 'visit'}
        {#if editor.visitNeedsPhoto}
          <p class="pin-warning">Kunjungan survei baru memerlukan foto bukti baru. Unggah foto di panel Foto & Lokasi sebelum menyimpan.{#if onOpenPhotoPane} <button type="button" class="link-button" onclick={onOpenPhotoPane}>Buka Foto & Lokasi</button>{/if}</p>
        {/if}
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
      {#if editor.changed.length || predictedNomor}
        <div class="table-wrap"><table><thead><tr><th scope="col">Data</th><th scope="col">Lama</th><th scope="col">Baru</th></tr></thead><tbody>
          {#if predictedNomor && predictedNomor !== detail.state.nomor}<tr><th scope="row">Nomor (Otomatis)</th><td>{detail.state.nomor}</td><td>{predictedNomor}</td></tr>{/if}
          {#each editor.changed as key}{#if key !== 'nomor' || !predictedNomor}<tr><th scope="row">{pointFieldLabel(key)}</th><td>{formatPointFieldValue(key, detail.state[key as keyof PointState])}</td><td>{formatPointFieldValue(key, edit[key as keyof PointState])}</td></tr>{/if}{/each}
        </tbody></table></div>
      {/if}
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
