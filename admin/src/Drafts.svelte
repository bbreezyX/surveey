<script lang="ts">
  import { onMount } from 'svelte';
  import { api, photoUrl, formatDistance, type Draft, type PointState } from './api';
  let { canPublish, onMessage }: { canPublish: boolean; onMessage: (text: string) => void } = $props();
  let items = $state<Draft[]>([]); let selected = $state<string[]>([]); let reason = $state(''); let busy = $state(false); let error = $state('');
  async function load() { try { items = (await api<{items: Draft[]}>('drafts')).items; selected = []; } catch(e) { error = e instanceof Error ? e.message : 'Gagal memuat draf.'; } }
  onMount(load);
  async function publish(event: SubmitEvent) { event.preventDefault(); busy = true; error = ''; try {
    await api('publications/publish', 'POST', { draft_ids: selected, reason }); onMessage('Penerbitan tersimpan. Versi baru tampil setelah peta publik dimuat ulang.'); reason = ''; await load();
  } catch(e) { error = e instanceof Error ? e.message : 'Penerbitan gagal.'; } finally { busy = false; } }
  async function discard(id: string) { busy = true; error = ''; try { await api(`drafts/${id}/discard`, 'POST', {}); await load(); onMessage('Draf dibatalkan.'); } catch(e) { error = e instanceof Error ? e.message : 'Tidak dapat membatalkan draf.'; } finally { busy = false; } }
</script>
<header class="page-head">
  <div><h2>Draf & penerbitan</h2><p>Draf bersifat privat. Setiap penerbitan membuat satu snapshot data dan daftar foto yang disetujui.</p></div>
  <button class="btn-ghost" onclick={load} disabled={busy}>Muat ulang</button>
</header>
{#if error}<p class="notice-error page-notice" role="alert">{error}</p>{/if}
<div class="atlas-section" role="heading" aria-level="3">Menunggu penerbitan<span>{items.length} draf</span></div>
{#if !items.length}<div class="panel-empty"><p>Belum ada draf menunggu penerbitan.</p></div>{/if}
{#each items as draft}
  {@const conflict = draft.current_revision !== draft.base_revision}
  <article class="page-row">
    <div class="page-row__head">
      <div><h3>{draft.nomor}</h3><p class="page-row__meta">Oleh {draft.author}, revisi {draft.base_revision} ke {draft.base_revision + 1}</p></div>
      {#if canPublish}<label class="switch-row"><span class="ctl-switch"><input type="checkbox" bind:group={selected} value={draft.id} disabled={busy || conflict}><span class="ctl-switch__track" aria-hidden="true"><span class="ctl-switch__thumb"></span></span></span>Terbitkan</label>{/if}
    </div>
    {#if conflict}<p class="notice-error">Konflik: titik sudah pada revisi {draft.current_revision}. Draf ini tidak dapat diterbitkan; perubahan perlu diajukan ulang dari data terbaru.</p>{/if}
    <p class="page-row__text">{draft.reason}</p>
    <dl class="stats-line">
      <div><dt>Perpindahan</dt><dd>{formatDistance(draft.movement_m)}</dd></div>
      <div><dt>Jumlah resmi</dt><dd>{draft.counts_before.official} → {draft.counts_after.official}</dd></div>
      <div><dt>Cadangan</dt><dd>{draft.counts_before.cadangan} → {draft.counts_after.cadangan}</dd></div>
    </dl>
    <details class="disclosure"><summary>Bandingkan perubahan & foto</summary>
      <div class="table-wrap"><table><thead><tr><th>Kolom</th><th>Saat ini</th><th>Usulan</th></tr></thead><tbody>{#each Object.keys(draft.after) as key}{#if draft.before[key as keyof PointState] !== draft.after[key as keyof PointState]}<tr><th>{key}</th><td>{String(draft.before[key as keyof PointState] ?? '—')}</td><td>{String(draft.after[key as keyof PointState] ?? '—')}</td></tr>{/if}{/each}</tbody></table></div>
      <div class="photo-compare"><figure><figcaption>Foto saat ini</figcaption>{#if draft.before.photo_id}<img src={photoUrl(draft.before.photo_id)} alt="Foto saat ini" loading="lazy">{:else}<p class="photo-empty">Belum ada foto</p>{/if}</figure><figure><figcaption>Foto usulan</figcaption>{#if draft.after.photo_id}<img src={photoUrl(draft.after.photo_id)} alt="Foto usulan" loading="lazy">{:else}<p class="photo-empty">Belum ada foto</p>{/if}</figure></div>
      {#if draft.new_observation}<p class="page-row__text">Survei baru {draft.new_observation.date}, sumber: {draft.new_observation.source}</p><p class="page-row__text">{draft.new_observation.notes}</p>{/if}
    </details>
    <div class="page-row__actions"><button class="btn-ghost" onclick={() => discard(draft.id)} disabled={busy}>Batalkan draf</button></div>
  </article>
{/each}
{#if canPublish && items.length}
  <form class="page-foot" onsubmit={publish}>
    <label class="field">Catatan penerbitan<textarea bind:value={reason} rows="2" maxlength="3000" required></textarea></label>
    <div class="page-foot__bar"><p>{selected.length} draf dipilih. Foto dan revisi diperiksa sebelum snapshot diaktifkan.</p><button class="btn-primary" disabled={busy || !selected.length}>{busy ? 'Menerbitkan…' : 'Terbitkan draf terpilih'}</button></div>
  </form>
{/if}
