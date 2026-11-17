<script lang="ts">
  import CoordinateMap from './CoordinateMap.svelte';
  import { photoUrl } from './api';
  import { badgeOf, type PointEditor } from './editor.svelte';
  let { editor, canRevoke }: { editor: PointEditor; canRevoke: boolean } = $props();
  let detail = $derived(editor.detail);
  // The reason field opens only for the action being confirmed, not on every card.
  let confirming = $state<string | null>(null);
  let newPhoto = $derived(editor.edit.photo_id && editor.edit.photo_id !== detail.state.photo_id ? editor.edit.photo_id : null);
  // One date style for observations ("2026-06-17") and revisions (an ISO timestamp).
  const day = (iso: string) => iso ? new Date(`${iso}T00:00`).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'Tanggal Tidak Diketahui';
  const moment = (iso: string) => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const coordinate = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) ? `${lat.toFixed(6)}, ${lon.toFixed(6)}` : 'Tanpa Koordinat';
  // Imported observations carry their whole source record as JSON; it reads as
  // one line here and stays available under "Data Mentah".
  function sourceLabel(source: string) {
    try {
      const data = JSON.parse(source);
      if (data && typeof data === 'object') return data.kind === 'legacy_baseline' ? 'Impor Data Awal (QGIS)' : 'Data Terstruktur';
    } catch { /* plain text, typed with a survey visit */ }
    return source;
  }
</script>
{#if editor.error}<p class="notice-error wing-notice" role="alert">{editor.error}</p>{/if}
<section class="wing-section">
  <h3>Foto Survei</h3>
  <div class="photo-compare">
    <figure><figcaption>Foto Lama</figcaption>{#if detail.state.photo_id}<a class="photo-link" href={photoUrl(detail.state.photo_id)} target="_blank" rel="noopener" title="Buka Foto di Tab Baru"><img src={photoUrl(detail.state.photo_id)} alt="Foto Lama"></a>{:else}<p class="photo-empty">Belum Ada Foto</p>{/if}</figure>
    <!-- The empty "Foto Baru" slot is the upload zone itself; once a photo is
         chosen, a small "Ganti Foto" control sits over it. The native input
         covers the zone invisibly, so clicking and dropping both reach it. -->
    <figure class="photo-slot"><figcaption>Foto Baru</figcaption>
      {#if newPhoto}<a class="photo-link" href={photoUrl(newPhoto)} target="_blank" rel="noopener" title="Buka Foto di Tab Baru"><img src={photoUrl(newPhoto)} alt="Foto Baru"></a>{/if}
      <label class="dropzone" class:dropzone--over={newPhoto} class:is-busy={editor.busy}>
        <input type="file" accept="image/jpeg,image/png,image/webp" onchange={event => editor.upload(event)} disabled={editor.busy} aria-label={newPhoto ? 'Ganti Foto Baru' : 'Pilih atau Seret Foto Baru'}>
        <span class="dropzone__icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M5 20h14"/></svg></span>
        <span class="dropzone__text"><strong>{editor.busy ? 'Mengunggah…' : newPhoto ? 'Ganti Foto' : 'Pilih atau Seret Foto'}</strong>{#if !newPhoto}<small>JPEG, PNG, WebP · maks. 20 MiB</small>{/if}</span>
      </label>
    </figure>
  </div>
  <p class="hint">{editor.uploaded || 'Unggahan belum mengubah foto publik.'}</p>
</section>
<section class="wing-section">
  <h3>Lokasi</h3>
  <CoordinateMap bind:lat={editor.edit.lat} bind:lon={editor.edit.lon} original={detail.state}/>
</section>
<section class="wing-section">
  <h3>Riwayat & Bukti</h3>
  <h4>Pengamatan Survei <span class="wing-count">{detail.observations.length}</span></h4>
  {#each detail.observations as observation}
    <details class="history-item">
      <summary><span class="history-item__title">{day(observation.date)}</span><span class="history-item__meta">{coordinate(observation.lat, observation.lon)}</span></summary>
      <div class="history-item__body">
        {#if observation.notes}<p class="history-item__text">{observation.notes}</p>{/if}
        {#if observation.source}<p class="history-item__meta">Sumber: {sourceLabel(observation.source)}</p>{/if}
        {#each observation.photos as id}
          <figure class="history-photo">
            <a class="photo-link history-photo__frame" href={photoUrl(id)} target="_blank" rel="noopener" title="Buka Foto di Tab Baru"><img src={photoUrl(id)} alt="Bukti Pengamatan" loading="lazy"></a>
            <div class="history-row">
              <a class="text-action" href={`/admin/api/photos/${id}/original`}>Unduh Bukti Asli</a>
              {#if canRevoke && confirming !== `photo:${id}`}<button class="text-action text-action--danger" type="button" disabled={editor.busy} onclick={() => confirming = `photo:${id}`}>Cabut Akses Publik</button>{/if}
            </div>
          </figure>
          {#if canRevoke && confirming === `photo:${id}`}
            <div class="history-action">
              <label class="field">Alasan Pencabutan<textarea bind:value={editor.historyReason} rows="2" maxlength="3000" placeholder="Wajib Diisi"></textarea></label>
              <div class="history-action__buttons">
                <button class="btn-ghost" type="button" onclick={() => confirming = null}>Batal</button>
                <button class="btn-danger" type="button" disabled={editor.busy || !editor.historyReason.trim()} onclick={() => editor.revoke(id)}>Cabut Akses</button>
              </div>
            </div>
          {/if}
        {/each}
        {#if observation.source && sourceLabel(observation.source) !== observation.source}<details class="raw-data"><summary>Data Mentah</summary><pre>{observation.source}</pre></details>{/if}
      </div>
    </details>
  {/each}
  <h4>Riwayat Revisi <span class="wing-count">{detail.revisions.length}</span></h4>
  {#each detail.revisions as revision}
    {@const badge = badgeOf(revision.state)}
    <details class="history-item">
      <summary><span class="history-item__title">Revisi {revision.number}{#if revision.number === detail.revision}<span class="history-item__current">Saat Ini</span>{/if}</span><span class="history-item__meta">{moment(revision.at)}</span></summary>
      <div class="history-item__body">
        {#if revision.reason}<p class="history-item__text">{revision.reason}</p>{/if}
        <dl class="history-fields">
          <dt>Lokasi Rekapan</dt><dd>{revision.state.lokasi_rekapan || '—'}</dd>
          <dt>Status</dt><dd><span class="badge badge--{badge.kind}">{badge.label}</span></dd>
          <dt>Koordinat</dt><dd>{coordinate(revision.state.lat, revision.state.lon)}</dd>
          <dt>Tanggal</dt><dd>{revision.state.date ? day(revision.state.date) : '—'}</dd>
          {#if revision.state.catatan}<dt>Catatan</dt><dd>{revision.state.catatan}</dd>{/if}
        </dl>
        {#if revision.number !== detail.revision && confirming === `revision:${revision.number}`}
          <div class="history-action">
            <label class="field">Alasan Pemulihan<textarea bind:value={editor.historyReason} rows="2" maxlength="3000" placeholder="Wajib Diisi"></textarea></label>
            <div class="history-action__buttons">
              <button class="btn-ghost" type="button" onclick={() => confirming = null}>Batal</button>
              <button class="btn-primary" type="button" disabled={editor.busy || !editor.historyReason.trim()} onclick={() => editor.restore(revision.number)}>Buat Draf Pemulihan</button>
            </div>
          </div>
        {/if}
        <div class="history-row">
          <details class="raw-data"><summary>Data Mentah</summary><pre>{JSON.stringify(revision.state, null, 2)}</pre></details>
          {#if revision.number !== detail.revision && confirming !== `revision:${revision.number}`}<button class="text-action" type="button" disabled={editor.busy} onclick={() => confirming = `revision:${revision.number}`}>Pulihkan ke Revisi Ini</button>{/if}
        </div>
      </div>
    </details>
  {/each}
</section>
