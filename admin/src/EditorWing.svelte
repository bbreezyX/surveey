<script lang="ts">
  import CoordinateMap from './CoordinateMap.svelte';
  import { photoUrl } from './api';
  import type { PointEditor } from './editor.svelte';
  let { editor, canRevoke }: { editor: PointEditor; canRevoke: boolean } = $props();
  let detail = $derived(editor.detail);
</script>
{#if editor.error}<p class="notice-error wing-notice" role="alert">{editor.error}</p>{/if}
<section class="wing-section">
  <h3>Foto survei</h3>
  <div class="photo-compare">
    <figure><figcaption>Saat ini</figcaption>{#if detail.state.photo_id}<img src={photoUrl(detail.state.photo_id)} alt="Foto survei saat ini">{:else}<p class="photo-empty">Belum ada foto</p>{/if}</figure>
    <figure><figcaption>Usulan</figcaption>{#if editor.edit.photo_id}<img src={photoUrl(editor.edit.photo_id)} alt="Foto usulan">{:else}<p class="photo-empty">Belum ada foto</p>{/if}</figure>
  </div>
  <!-- The native input covers the whole zone (invisible), so clicking and
       dropping a file both reach it without any script. -->
  <label class="dropzone" class:is-busy={editor.busy}>
    <input type="file" accept="image/jpeg,image/png,image/webp" onchange={event => editor.upload(event)} disabled={editor.busy}>
    <span class="dropzone__icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M5 20h14"/></svg></span>
    <span class="dropzone__text"><strong>{editor.busy ? 'Mengunggah foto…' : 'Pilih atau seret foto ke sini'}</strong><small>JPEG, PNG, atau WebP. Maksimum 20 MiB dan 40 megapiksel.</small></span>
  </label>
  <p class="hint">{editor.uploaded || 'Unggahan tidak langsung mengubah foto publik.'}</p>
</section>
<section class="wing-section">
  <h3>Lokasi</h3>
  <CoordinateMap bind:lat={editor.edit.lat} bind:lon={editor.edit.lon} original={detail.state}/>
</section>
<section class="wing-section">
  <h3>Riwayat & bukti</h3>
  <label class="field">Alasan pemulihan / pencabutan akses publik<textarea bind:value={editor.historyReason} rows="2" maxlength="3000"></textarea></label>
  <h4>Pengamatan survei</h4>
  {#each detail.observations as observation}<details><summary>{observation.date || 'Tanggal tidak diketahui'} · {observation.lat}, {observation.lon}</summary><p>{observation.notes}</p><pre>{observation.source}</pre><div class="history-photos">{#each observation.photos as id}<figure><img src={photoUrl(id)} alt="Bukti pengamatan" loading="lazy"><a href={`/admin/api/photos/${id}/original`}>Unduh bukti asli</a>{#if canRevoke}<button class="btn-ghost" disabled={editor.busy || !editor.historyReason.trim()} onclick={() => editor.revoke(id)}>Cabut akses foto publik (privasi)</button>{/if}</figure>{/each}</div></details>{/each}
  <h4>Riwayat revisi</h4>
  {#each detail.revisions as revision}<details><summary>Revisi {revision.number} · {new Date(revision.at).toLocaleString('id-ID')}</summary><p>{revision.reason}</p><pre>{JSON.stringify(revision.state, null, 2)}</pre>{#if revision.number !== detail.revision}<button class="btn-ghost" disabled={editor.busy || !editor.historyReason.trim()} onclick={() => editor.restore(revision.number)}>Buat draf pemulihan ke revisi {revision.number}</button>{/if}</details>{/each}
</section>
