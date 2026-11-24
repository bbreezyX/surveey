<script lang="ts">
  import { onMount } from 'svelte';
  import { api, photoUrl, formatDistance, type Draft, type PointState } from './api';
  import { formatPointFieldValue, pointFieldLabel } from './labels';
  import { clearsVerificationOnOldPin, OLD_PIN_WARNING, outsideJambi, OUTSIDE_JAMBI_WARNING } from './verification';
  let { canPublish, username, onMessage, onOpenPoint, onChanged }: {
    canPublish: boolean; username: string;
    onMessage: (text: string) => void;
    onOpenPoint: (pointId: string) => void;
    onChanged: (published: boolean) => void;
  } = $props();
  let items = $state<Draft[]>([]); let selected = $state<string[]>([]); let reason = $state('');
  let busy = $state(false); let error = $state(''); let confirmingDiscard = $state<string | null>(null);
  const moment = (iso: string) => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  let selectedSet = $derived(new Set(selected));
  let selectedDrafts = $derived(items.filter(d => selectedSet.has(d.id)));
  let selectedPoints = $derived(new Set(selectedDrafts.map(d => d.point_id)));
  // Points with more than one pending draft: only one may be published in a batch.
  let multiDraftPoints = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const d of items) counts.set(d.point_id, (counts.get(d.point_id) ?? 0) + 1);
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id));
  });
  let validSelectableIds = $derived.by(() => {
    const seen = new Set<string>(), ids: string[] = [];
    for (const d of items) {
      if (d.current_revision !== d.base_revision || seen.has(d.point_id)) continue;
      seen.add(d.point_id);
      ids.push(d.id);
      if (ids.length >= 100) break;
    }
    return ids;
  });
  let batchImpact = $derived.by(() => {
    let officialDelta = 0, warnings = 0;
    for (const d of selectedDrafts) {
      officialDelta += d.counts_after.official - d.counts_before.official;
      if (clearsVerificationOnOldPin(d.before, d.after) || outsideJambi(d.after.lat, d.after.lon)) warnings++;
    }
    return { officialDelta, warnings };
  });
  function canDiscard(draft: Draft) { return draft.can_discard ?? (canPublish || draft.author === username); }
  function selectAllValid() { selected = [...validSelectableIds]; }
  async function load() {
    busy = true; error = ''; confirmingDiscard = null;
    try { items = (await api<{items: Draft[]}>('drafts')).items; selected = []; }
    catch(e) { error = e instanceof Error ? e.message : 'Gagal memuat draf.'; }
    finally { busy = false; }
  }
  onMount(load);
  async function publish(event: SubmitEvent) { event.preventDefault(); busy = true; error = ''; try {
    await api('publications/publish', 'POST', { draft_ids: selected, reason });
    onMessage('Penerbitan tersimpan. Peta publik akan memperbarui titik secara otomatis.');
    reason = '';
    await load();
    onChanged(true);
  } catch(e) { error = e instanceof Error ? e.message : 'Penerbitan gagal.'; } finally { busy = false; } }
  async function discard(id: string) { busy = true; error = ''; confirmingDiscard = null; try {
    await api(`drafts/${id}/discard`, 'POST', {});
    await load();
    onMessage('Draf dibatalkan.');
    onChanged(false);
  } catch(e) { error = e instanceof Error ? e.message : 'Tidak dapat membatalkan draf.'; } finally { busy = false; } }
</script>
<header class="page-head">
  <div><h2>Draf & Penerbitan</h2><p>Draf bersifat privat. Setiap penerbitan membuat satu snapshot data dan daftar foto yang disetujui.</p></div>
  <div class="page-head__actions">
    {#if canPublish && validSelectableIds.length}
      {#if selected.length}<button type="button" class="btn-ghost" onclick={() => selected = []} disabled={busy}>Kosongkan Pilihan</button>
      {:else}<button type="button" class="btn-ghost" onclick={selectAllValid} disabled={busy}>Pilih Semua Valid ({validSelectableIds.length})</button>{/if}
    {/if}
    <button type="button" class="btn-ghost" onclick={load} disabled={busy}>Muat Ulang</button>
  </div>
</header>
{#if error}<p class="notice-error page-notice" role="alert">{error}</p>{/if}
<div class="atlas-section" role="heading" aria-level="3">Menunggu Penerbitan<span>{items.length} Draf</span></div>
{#if !items.length}<div class="panel-empty"><p>Belum ada draf menunggu penerbitan.</p></div>{/if}
{#each items as draft (draft.id)}
  {@const conflict = draft.current_revision !== draft.base_revision}
  {@const isSelected = selectedSet.has(draft.id)}
  {@const blockedBySamePoint = !isSelected && selectedPoints.has(draft.point_id)}
  {@const blockedByLimit = !isSelected && selected.length >= 100}
  <article class="page-row">
    <div class="page-row__head">
      <div>
        <h3><button type="button" class="link-button draft-title-link" onclick={() => onOpenPoint(draft.point_id)}>{draft.nomor}</button>{#if draft.before.nomor !== draft.after.nomor} <span class="draft-rename">→ {draft.after.nomor}</span>{/if}</h3>
        <p class="page-row__meta">Oleh {draft.author} · {moment(draft.created_at)} · Revisi {draft.base_revision} ke {draft.base_revision + 1}{#if draft.restore_revision} · <span class="badge badge--draf">Pemulihan Revisi {draft.restore_revision}</span>{/if}</p>
      </div>
      {#if canPublish}<label class="switch-row"><span class="ctl-switch"><input type="checkbox" bind:group={selected} value={draft.id} disabled={busy || conflict || blockedBySamePoint || blockedByLimit}><span class="ctl-switch__track" aria-hidden="true"><span class="ctl-switch__thumb"></span></span></span>Terbitkan</label>{/if}
    </div>
    {#if conflict}<p class="notice-error">Konflik: titik sudah pada revisi {draft.current_revision}. Draf ini tidak dapat diterbitkan; perubahan perlu diajukan ulang dari data terbaru.</p>{/if}
    {#if multiDraftPoints.has(draft.point_id)}<p class="hint">Titik ini memiliki lebih dari satu draf menunggu; hanya satu draf per titik dapat diterbitkan dalam satu penerbitan.</p>{/if}
    {#if clearsVerificationOnOldPin(draft.before, draft.after)}<p class="pin-warning">{OLD_PIN_WARNING}</p>{/if}
    {#if outsideJambi(draft.after.lat, draft.after.lon)}<p class="pin-warning">{OUTSIDE_JAMBI_WARNING}</p>{/if}
    <p class="page-row__text">{draft.reason}</p>
    <dl class="stats-line">
      <div><dt>Perpindahan</dt><dd>{formatDistance(draft.movement_m)}</dd></div>
      <div><dt>Jumlah Resmi</dt><dd>{draft.counts_before.official} → {draft.counts_after.official}</dd></div>
      <div><dt>Cadangan</dt><dd>{draft.counts_before.cadangan} → {draft.counts_after.cadangan}</dd></div>
    </dl>
    <details class="disclosure"><summary>Bandingkan Perubahan & Foto</summary>
      <div class="table-wrap"><table><thead><tr><th scope="col">Kolom</th><th scope="col">Lama</th><th scope="col">Baru</th></tr></thead><tbody>{#each Object.keys(draft.after) as key}{#if draft.before[key as keyof PointState] !== draft.after[key as keyof PointState]}<tr><th scope="row">{pointFieldLabel(key)}</th><td>{formatPointFieldValue(key, draft.before[key as keyof PointState])}</td><td>{formatPointFieldValue(key, draft.after[key as keyof PointState])}</td></tr>{/if}{/each}</tbody></table></div>
      <div class="photo-compare"><figure><figcaption>Foto Lama</figcaption>{#if draft.before.photo_id}<a class="photo-link" href={photoUrl(draft.before.photo_id)} target="_blank" rel="noopener" title="Buka Foto di Tab Baru"><img src={photoUrl(draft.before.photo_id)} alt="Foto Lama" loading="lazy"></a>{:else}<p class="photo-empty">Belum Ada Foto</p>{/if}</figure><figure><figcaption>Foto Baru</figcaption>{#if draft.after.photo_id && draft.after.photo_id !== draft.before.photo_id}<a class="photo-link" href={photoUrl(draft.after.photo_id)} target="_blank" rel="noopener" title="Buka Foto di Tab Baru"><img src={photoUrl(draft.after.photo_id)} alt="Foto Baru" loading="lazy"></a>{:else if !draft.after.photo_id && draft.before.photo_id}<p class="photo-empty">Foto Dihapus</p>{:else}<p class="photo-empty">Belum Ada Foto Baru</p>{/if}</figure></div>
      {#if draft.new_observation}<p class="page-row__text">Survei baru {draft.new_observation.date}, sumber: {draft.new_observation.source}</p>{#if draft.new_observation.notes}<p class="page-row__text">{draft.new_observation.notes}</p>{/if}{/if}
    </details>
    <div class="page-row__actions">
      <button type="button" class="text-action" onclick={() => onOpenPoint(draft.point_id)} disabled={busy}>Buka di Editor</button>
      {#if canDiscard(draft)}
        {#if confirmingDiscard === draft.id}
          <span class="hint">Batalkan draf ini?</span>
          <button type="button" class="btn-danger" onclick={() => discard(draft.id)} disabled={busy}>Ya, Batalkan</button>
          <button type="button" class="btn-ghost" onclick={() => confirmingDiscard = null} disabled={busy}>Tidak</button>
        {:else}
          <button type="button" class="btn-ghost" aria-label={`Batalkan Draf ${draft.nomor} oleh ${draft.author}`} onclick={() => confirmingDiscard = draft.id} disabled={busy}>Batalkan Draf</button>
        {/if}
      {/if}
    </div>
  </article>
{/each}
{#if canPublish && items.length}
  <form class="page-foot" onsubmit={publish}>
    <label class="field">Catatan Penerbitan<textarea bind:value={reason} rows="2" maxlength="3000" placeholder="Opsional — terisi otomatis dari draf bila dikosongkan"></textarea></label>
    <div class="page-foot__bar">
      <p>
        <strong>{selected.length}</strong> draf dipilih{#if selected.length} · Jumlah resmi {batchImpact.officialDelta === 0 ? 'tetap' : `${batchImpact.officialDelta > 0 ? '+' : ''}${batchImpact.officialDelta}`}{#if batchImpact.warnings} · <strong>{batchImpact.warnings} peringatan koordinat</strong>{/if}{/if}.
      </p>
      <button type="submit" class="btn-primary" disabled={busy || !selected.length}>{busy ? 'Menerbitkan…' : 'Terbitkan Draf Terpilih'}</button>
    </div>
  </form>
{/if}
