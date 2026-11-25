<script lang="ts">
  import type { Counts } from './api';
  import { badgeOf } from './editor.svelte';
  import {
    BATCH_ARCHIVE_LIMIT,
    batchArchiveImpact,
    batchItemState,
    type BatchArchiveItem,
  } from './batch-archive';
  import {
    PENDING_CLOCK_SVG,
    pendingSummary,
    stageBadgeSvg,
    stageDone,
    stageSummary,
  } from '../../src/shared/survey/progress';

  let {
    items,
    counts,
    canPublish = false,
    busy = false,
    error = '',
    limitHit = false,
    reason = $bindable(''),
    stageOf,
    pendingOf,
    onRemove,
    onClear,
    onClose,
    onOpenListPane,
    onSubmit,
  }: {
    items: readonly BatchArchiveItem[];
    counts?: Counts;
    canPublish?: boolean;
    busy?: boolean;
    error?: string;
    limitHit?: boolean;
    reason?: string;
    stageOf: (nomor: string, cadangan: boolean) => number;
    pendingOf: (nomor: string, cadangan: boolean) => readonly number[] | null;
    onRemove: (id: string) => void;
    onClear: () => void;
    onClose: () => void;
    onOpenListPane?: () => void;
    onSubmit: (mode: 'publish' | 'draft') => void;
  } = $props();

  let impact = $derived(batchArchiveImpact(items, counts));
  let fieldProgressCount = $derived.by(() => {
    let count = 0;
    for (const item of items) {
      if (!item.cadangan && (stageOf(item.nomor, false) > 0 || !!pendingOf(item.nomor, false))) count++;
    }
    return count;
  });

  let footNote = $derived(
    !items.length
      ? 'Pilih minimal 1 titik aktif dari daftar.'
      : canPublish
        ? `${items.length} titik siap diarsipkan dalam satu penerbitan.`
        : `${items.length} titik akan disimpan sebagai draf arsip.`,
  );

  function handlePrimarySubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!items.length || busy) return;
    onSubmit(canPublish ? 'publish' : 'draft');
  }
</script>

<div class="edit-head">
  <div class="edit-title">
    <h2 id="batch-archive-heading">Arsipkan Massal</h2>
    <p class="edit-id">Pilih hingga {BATCH_ARCHIVE_LIMIT} titik aktif dari daftar. Titik arsip keluar dari jumlah resmi dan peta publik.</p>
  </div>
  <div class="edit-head__actions">
    {#if items.length}<button class="text-action" type="button" onclick={onClear} disabled={busy}>Kosongkan</button>{/if}
    <button class="btn-ghost" type="button" onclick={onClose} disabled={busy}>Tutup</button>
  </div>
</div>

{#if error}<p class="notice-error edit-notice" role="alert">{error}</p>{/if}

<form class="edit-form" aria-labelledby="batch-archive-heading" onsubmit={handlePrimarySubmit}>
  <div class="edit-scroll">
    {#if !items.length}
      <div class="batch-empty">
        <p>Belum ada titik dipilih. Klik ubin titik di daftar sebelah kiri, atau gunakan <strong>Pilih Desa</strong> dan <strong>Pilih Halaman</strong> untuk memilih cepat.</p>
        {#if onOpenListPane}
          <button type="button" class="btn-ghost batch-empty__list-btn" onclick={onOpenListPane}>Buka Daftar Titik</button>
        {/if}
      </div>
    {:else}
      <fieldset disabled={busy}>
        <legend>Ringkasan Dampak</legend>
        <dl class="stats-line batch-stats">
          <div><dt>Dipilih</dt><dd>{impact.total} Titik</dd></div>
          <div>
            <dt>Alokasi Resmi</dt>
            <dd>
              {#if counts && impact.officialAfter !== null}
                {counts.official} → {impact.officialAfter}
              {:else}
                {impact.official ? `−${impact.official}` : 'Tetap'}
              {/if}
            </dd>
          </div>
          <div>
            <dt>Cadangan</dt>
            <dd>
              {#if counts && impact.cadanganAfter !== null}
                {counts.cadangan} → {impact.cadanganAfter}
              {:else}
                {impact.cadangan ? `−${impact.cadangan}` : 'Tetap'}
              {/if}
            </dd>
          </div>
        </dl>
        <div aria-live="polite">
          {#if limitHit}
            <p class="hint">Batas maksimum {BATCH_ARCHIVE_LIMIT} titik per batch tercapai.</p>
          {/if}
          {#if fieldProgressCount}
            <p class="pin-warning">
              <strong>{fieldProgressCount} titik terpilih</strong> sudah memiliki progres atau laporan menunggu di esdm.cloud. Mengarsipkan titik akan mengeluarkannya dari peta publik.
            </p>
          {/if}
          {#if impact.withDrafts}
            <p class="pin-warning">
              <strong>{impact.withDrafts} titik terpilih</strong> memiliki draf menunggu penerbitan. {canPublish ? 'Menerbitkan arsip langsung akan membuat draf akun lain pada titik tersebut menjadi kedaluwarsa.' : 'Draf Anda sendiri pada titik tersebut akan diperbarui menjadi draf arsip.'}
            </p>
          {/if}
        </div>
      </fieldset>

      <fieldset disabled={busy}>
        <legend>Titik Terpilih ({items.length})</legend>
        <ul class="batch-list" role="list">
          {#each items as item (item.id)}
            {@const badge = badgeOf(batchItemState(item))}
            {@const stage = stageOf(item.nomor, item.cadangan)}
            {@const waiting = pendingOf(item.nomor, item.cadangan)}
            <li class="batch-list__item">
              <div class="batch-list__main">
                <strong class="batch-list__nomor">{item.nomor}</strong>
                {#if item.lokasi_rekapan && item.lokasi_rekapan !== item.nomor}
                  <span class="batch-list__loc">{item.lokasi_rekapan}</span>
                {/if}
                <div class="batch-list__meta">
                  <span class="badge badge--{badge.kind}">{badge.label}</span>
                  {#if stage}<span class="badge badge--stage" class:is-done={stageDone(stage)}>{@html stageBadgeSvg(stage)}{stageSummary(stage)}</span>{/if}
                  {#if waiting}<span class="badge badge--pending">{@html PENDING_CLOCK_SVG}{pendingSummary(waiting)}</span>{/if}
                  {#if item.drafts}<span class="badge badge--draf">{item.drafts > 1 ? `${item.drafts} Draf` : 'Ada Draf'}</span>{/if}
                </div>
              </div>
              <button
                type="button"
                class="batch-list__remove"
                aria-label={`Hapus ${item.nomor} dari pilihan`}
                onclick={() => onRemove(item.id)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
              </button>
            </li>
          {/each}
        </ul>
      </fieldset>

      <fieldset disabled={busy}>
        <legend>Alasan Pengarsipan</legend>
        <div class="field">
          <label for="batch-archive-reason">Alasan Perubahan</label>
          <textarea
            id="batch-archive-reason"
            name="reason"
            aria-describedby="batch-archive-reason-hint"
            bind:value={reason}
            rows="2"
            maxlength="3000"
            placeholder="Opsional — terisi otomatis bila dikosongkan"
          ></textarea>
        </div>
        <p id="batch-archive-reason-hint" class="hint">
          {canPublish
            ? 'Dicatat pada riwayat revisi tiap titik, jejak audit, dan catatan penerbitan.'
            : 'Dicatat pada setiap draf arsip untuk ditinjau penerbit.'}
        </p>
      </fieldset>
    {/if}
  </div>

  <div class="edit-foot">
    <p>{footNote}</p>
    <div class="edit-foot__actions">
      {#if canPublish}
        <button class="btn-ghost" type="button" onclick={() => onSubmit('draft')} disabled={busy || !items.length}>Simpan Draf</button>
        <button class="btn-primary btn-primary--danger" type="submit" disabled={busy || !items.length}>
          {busy ? 'Mengarsipkan…' : items.length ? `Arsipkan & Terbitkan (${items.length})` : 'Arsipkan & Terbitkan'}
        </button>
      {:else}
        <button class="btn-primary" type="submit" disabled={busy || !items.length}>
          {busy ? 'Menyimpan…' : items.length ? `Simpan Draf Arsip (${items.length})` : 'Simpan Draf Arsip'}
        </button>
      {/if}
    </div>
  </div>
</form>
