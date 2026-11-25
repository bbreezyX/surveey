<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { api, ApiError, download, setCsrf, onApiActivity, emptyState, pasteCoordinates, type Account, type PointRow, type Detail, type PointState, type Counts } from './api';
  import { createBackdrop, type MapPoint } from './backdrop';
  import { PointEditor, badgeOf } from './editor.svelte';
  import { fold, foldAway, allowMotion, reducedMotion, narrow, UNFOLD_KEY } from './unfold';
  import EditorSheet from './EditorSheet.svelte';
  import EditorWing from './EditorWing.svelte';
  import BatchArchiveSheet from './BatchArchiveSheet.svelte';
  import Drafts from './Drafts.svelte';
  import Accounts from './Accounts.svelte';
  import CoordinateMap from './CoordinateMap.svelte';
  import Select from './Select.svelte';
  import AddressPicker from './AddressPicker.svelte';
  import { listSections, type ListPoint } from './list-points';
  import {
    BATCH_ARCHIVE_LIMIT,
    syncBatchSelection,
    toggleBatchGroup,
    toggleBatchPoint,
    type BatchArchiveItem,
    type BatchArchiveResult,
  } from './batch-archive';
  import { AUDIT_ACTION_LABELS, auditActionLabel } from './labels';
  import { outsideJambi, OUTSIDE_JAMBI_WARNING } from './verification';
  import { openPendingStages, PENDING_CLOCK_SVG, PROGRESS_URL, parsePending, parseProgress, pendingLabel, pendingSummary, stageBadgeSvg, stageDone, stageSummary, type SurveyPending, type SurveyProgress } from '../../src/shared/survey/progress';
  let account = $state<Account>(); let csrf = $state(''); let error = $state(''); let message = $state('');
  let loadingList = $state(false); let loadingDetail = $state(false); let submitting = $state(false);
  let busy = $derived(loadingList || loadingDetail || submitting);
  let page = $state<'points' | 'drafts' | 'publications' | 'accounts' | 'audit' | 'password' | 'evidence'>('points');
  let points = $state<PointRow[]>([]); let detail = $state<Detail>(); let q = $state(''); let status = $state(''); let archived = $state(false);
  let pendingOnly = $state(false);
  // Official-only and pending-drafts filters define their own archive scope, so the archive switch is off for them.
  let officialOnly = $derived(status === 'resmi' || status === 'pasti' || status === 'drafts');
  let region = $state('');
  let regions = $state<{ value: string; label: string }[]>([]);
  let regionOptions = $derived([{ value: '', label: 'Semua Kabupaten/Kota' }, ...regions]);
  let exporting = $state(false);
  let pointsRequest = 0; let detailRequest = 0; let pageRequest = 0; let auditRequest = 0;
  let listPage = $state(1); let pages = $state(1); let total = $state(0); let counts = $state<Counts>();
  let pendingDrafts = $state(0); let missingPhoto = $state(0);
  // Desa whose units are not numbered 001..N (server-side, across all pages).
  let gaps = $state<Record<string, number[]>>({}); let tidying = $state('');
  let mapPoints = $state.raw<MapPoint[]>([]);
  let creating = $state(false); let newPoint = $state<PointState>(emptyState()); let newReason = $state('');
  let batchMode = $state(false);
  let batchSelected = $state.raw<Map<string, BatchArchiveItem>>(new Map());
  let batchReason = $state('');
  let batchError = $state('');
  let batchLimitHit = $state(false);
  let batchSelectedList = $derived(Array.from(batchSelected.values()));
  let publications = $state<{id: string; at: string; checksum: string; points: number; actor?: string | null; reason?: string}[]>([]);
  let active = $state(''); let baselineReason = $state('');
  let auditRows = $state<{id: number; actor: string; action: string; target: string; target_label?: string; reason: string; before: unknown; after: unknown; at: string}[]>([]);
  let auditQuery = $state(''); let auditAction = $state('');
  const auditActionOptions = [{ value: '', label: 'Semua Aktivitas' }, ...Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => ({ value, label }))];
  let evidence = $state<{id: string; name: string; ready: boolean; checksum: string}[]>([]);
  let oldPassword = $state(''); let newPassword = $state('');
  let idleSeconds = $state(1800); let lastActivity = $state(Date.now()); let idleWarningMinutes = $state<number | null>(null);
  let canPublish = $derived(account?.role === 'publisher' || account?.role === 'owner');
  const ROLE: Record<string, string> = { editor: 'Editor', publisher: 'Penerbit', owner: 'Pemilik' };

  // C layout. The centre sheet sits exactly where the login card was. Right
  // after a login it starts at the card's height ('login'), then grows while
  // the two wings unfold ('open'). Logging out reverses it ('closing') before
  // the form is submitted, so the login page reappears in the same place.
  const unfoldFrom = (() => {
    try { const value = Number(sessionStorage.getItem(UNFOLD_KEY)) || 0; sessionStorage.removeItem(UNFOLD_KEY); return value; }
    catch { return 0; /* storage blocked */ }
  })();
  let phase = $state<'login' | 'open' | 'closing'>(unfoldFrom ? 'login' : 'open');
  // Phones have no room for wings: the list, editor and photo/location
  // panels become panes inside the sheet.
  let pane = $state<'list' | 'edit' | 'photo'>('list');
  let showWings = $derived(!!account && page === 'points' && phase === 'open');
  let editor = $state.raw<PointEditor>();
  let backdropEl: HTMLDivElement;
  let sheetEl: HTMLDivElement;
  let backdrop: ReturnType<typeof createBackdrop> | undefined;

  let sections = $derived(listSections(points));
  let visibleActivePoints = $derived(sections.flatMap(section => section.items).filter(point => !point.archived));
  let allPageSelected = $derived(visibleActivePoints.length > 0 && visibleActivePoints.every(point => batchSelected.has(point.id)));
  // Build stage per Nomor from esdm.cloud, the same feed as the public map's chips. Optional:
  // a slow or failed esdm.cloud leaves the list as it was. Cadangan units are not built.
  let progress = $state.raw<SurveyProgress>(new Map());
  const stageOf = (nomor: string, cadangan: boolean) => cadangan ? 0 : progress.get(nomor) ?? 0;
  // Reports a crew sent from esdm.cloud/lapangan that nobody has accepted there yet. Filtered
  // through openPendingStages so already-accepted stages left in the feed do not show as pending.
  let pending = $state.raw<SurveyPending>(new Map());
  const pendingOf = (nomor: string, cadangan: boolean) => {
    if (cadangan) return null;
    const open = openPendingStages(progress.get(nomor) ?? 0, pending.get(nomor));
    return open.length ? open : null;
  };
  let activeOfficialNomors = $derived(new Set(mapPoints.filter(p => p.status !== 'Cadangan' && p.nomor).map(p => p.nomor!)));
  let openPendingNomors = $derived.by(() => {
    const out: string[] = [];
    for (const [nomor, stages] of pending) {
      if (activeOfficialNomors.size && !activeOfficialNomors.has(nomor)) continue;
      if (openPendingStages(progress.get(nomor) ?? 0, stages).length) out.push(nomor);
    }
    return out;
  });
  // badgeOf reads only these fields; the list point carries them under public names.
  function editorState(point: ListPoint) { return { archived: point.archived, status: point.cadangan ? 'Cadangan' : point.belum ? 'Belum Ditetapkan' : '', duplikat: point.duplikat } as PointState; }
  // Search runs as the user types, like the public map's; the server does the matching.
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let auditTimer: ReturnType<typeof setTimeout> | undefined;
  type PointFilters = Partial<{ region: string; status: string }>;
  function refresh(filters?: PointFilters) { clearTimeout(searchTimer); listPage = 1; tidying = ''; loadPoints(filters); }
  function queueSearch() { clearTimeout(searchTimer); searchTimer = setTimeout(refresh, 300); }
  function queueAuditSearch() { clearTimeout(auditTimer); auditTimer = setTimeout(loadAudit, 300); }
  // Clicking an overview tally filters the list to those points; clicking again clears it.
  // Search and region reset so the filtered list matches the global count shown in the card.
  function toggleFlagFilter(next: string) {
    pendingOnly = false;
    status = status === next ? '' : next;
    if (status) { q = ''; region = ''; }
    refresh();
  }
  function togglePendingFilter() {
    pendingOnly = !pendingOnly;
    if (pendingOnly) { q = ''; region = ''; status = ''; }
    refresh();
  }
  function resetAllFilters() {
    q = ''; status = ''; region = ''; pendingOnly = false;
    refresh();
  }
  // The kecamatan head currently pinned at the top of the list turns navy,
  // as on the public map (custom.js syncStuck there).
  function stuckHeads(node: HTMLElement) {
    const sync = () => {
      const top = node.getBoundingClientRect().top;
      for (const head of node.querySelectorAll<HTMLElement>('.atlas-section')) {
        const group = head.parentElement!.getBoundingClientRect();
        head.classList.toggle('is-stuck', group.top < top - 0.5 && group.bottom > top + head.offsetHeight);
      }
    };
    node.addEventListener('scroll', sync, { passive: true });
    const observer = new MutationObserver(sync); observer.observe(node, { childList: true, subtree: true });
    return { destroy() { node.removeEventListener('scroll', sync); observer.disconnect(); } };
  }
  function announce(text: string) { message = text; }
  function failed(e: unknown) { error = e instanceof Error ? e.message : 'Permintaan gagal.'; }
  type PointsResponse = { items: PointRow[]; total: number; page: number; pages: number; counts: Counts; pending_drafts: number; missing_photo: number; gaps: Record<string, number[]> };
  function applyPointsResponse(result: PointsResponse) {
    points = result.items; total = result.total; listPage = result.page; pages = result.pages;
    counts = result.counts; gaps = result.gaps;
    pendingDrafts = result.pending_drafts ?? 0; missingPhoto = result.missing_photo ?? 0;
    if (batchSelected.size) batchSelected = syncBatchSelection(batchSelected, result.items);
  }
  async function loadPoints(filters: PointFilters = {}) {
    const requestId = ++pointsRequest;
    error = ''; loadingList = true;
    try {
      const params = new URLSearchParams({ q, region, status, page: String(listPage), archived: archived ? '1' : '0', ...filters });
      if (pendingOnly && openPendingNomors.length) params.set('nomors', openPendingNomors.join(','));
      const result = await api<PointsResponse>(`points?${params}`);
      if (requestId === pointsRequest) applyPointsResponse(result);
    } catch(e) { if (requestId === pointsRequest) failed(e); } finally { if (requestId === pointsRequest) loadingList = false; }
  }
  function refreshMap() {
    api<{items: MapPoint[]}>('points/map').then(result => { mapPoints = result.items; backdrop?.setPoints(result.items); }).catch(() => {});
  }
  async function exportPoints() {
    exporting = true; error = ''; message = '';
    try {
      await download(`export.xlsx?${new URLSearchParams({ q, region })}`, 'Titik Survei PUTS 2026.xlsx');
      announce('Unduhan Excel titik survei dimulai.');
    } catch(e) { failed(e); } finally { exporting = false; }
  }
  async function exportActive(kind: 'geojson' | 'csv') {
    if (!active) return;
    exporting = true; error = ''; message = '';
    try {
      await download(kind === 'csv' ? 'export.csv' : 'export', kind === 'csv' ? 'points.csv' : 'points.geojson');
      announce(`Unduhan ${kind === 'csv' ? 'CSV' : 'GeoJSON'} terbitan aktif dimulai.`);
    } catch(e) { failed(e); } finally { exporting = false; }
  }
  async function select(id: string, options: { switchTab?: boolean; keepPane?: boolean } = {}) {
    const requestId = ++detailRequest;
    if (options.switchTab) page = 'points';
    loadingDetail = true; error = ''; creating = false;
    if (!options.keepPane) pane = 'edit';
    try {
      const loaded = await api<Detail>(`points/${id}`);
      if (requestId !== detailRequest) return;
      detail = loaded;
      editor = new PointEditor(loaded, {
        onSaved: (text, published) => {
          announce(text);
          void loadPoints();
          void select(id, { keepPane: true });
          if (published) refreshMap();
        },
      });
      backdrop?.setSelected(id);
    }
    catch(e) { if (requestId === detailRequest) failed(e); } finally { if (requestId === detailRequest) loadingDetail = false; }
  }
  async function loadAudit() {
    const requestId = ++auditRequest;
    error = '';
    try {
      const params = new URLSearchParams();
      if (auditAction) params.set('action', auditAction);
      if (auditQuery.trim()) params.set('q', auditQuery.trim());
      const query = params.toString();
      const result = await api<{items: typeof auditRows}>(`audit${query ? `?${query}` : ''}`);
      if (requestId === auditRequest) auditRows = result.items;
    } catch(e) { if (requestId === auditRequest) failed(e); }
  }
  async function navigate(next: typeof page) {
    const requestId = ++pageRequest;
    page = next; error = ''; message = '';
    try {
      if (next === 'points') await loadPoints();
      if (next === 'publications') {
        const result = await api<{active_id: string; items: typeof publications}>('publications');
        if (requestId === pageRequest) { publications = result.items; active = result.active_id; }
      }
      if (next === 'audit') await loadAudit();
      if (next === 'evidence') {
        const result = await api<{items: typeof evidence}>('evidence');
        if (requestId === pageRequest) evidence = result.items;
      }
    } catch(e) { if (requestId === pageRequest) failed(e); }
  }
  function onDraftsChanged(published: boolean) {
    void loadPoints();
    if (published) refreshMap();
    // Keep any point already open in the editor synchronized with the new revision/draft state.
    if (detail) void select(detail.id, { keepPane: true });
  }
  async function create(event: SubmitEvent) { event.preventDefault(); submitting = true; error = ''; try {
    const result = await api<{id: string}>('points', 'POST', { state: $state.snapshot(newPoint), reason: newReason });
    q = ''; status = ''; region = ''; pendingOnly = false; archived = true; listPage = 1;
    await loadPoints(); await select(result.id);
    announce('Titik dibuat sebagai arsip. Titik menjadi aktif setelah survei lengkap, status arsip dinonaktifkan, dan drafnya diterbitkan.');
  } catch(e) { failed(e); } finally { submitting = false; } }
  async function baseline(event: SubmitEvent) { event.preventDefault(); submitting = true; error = ''; try { await api('publications/baseline', 'POST', { reason: baselineReason }); await navigate('publications'); announce('Baseline diterbitkan.'); } catch(e) { failed(e); } finally { submitting = false; } }
  async function changePassword(event: SubmitEvent) { event.preventDefault(); submitting = true; error = ''; try {
    await api('password', 'POST', { old_password: oldPassword, password: newPassword }); oldPassword = ''; newPassword = '';
    const result = await api<{csrf: string}>('session'); csrf = result.csrf; setCsrf(csrf); announce('Kata sandi diperbarui. Sesi lain dicabut.');
  } catch(e) { failed(e); } finally { submitting = false; } }
  async function extendSession() {
    error = '';
    try {
      const result = await api<{csrf: string}>('session');
      csrf = result.csrf; setCsrf(csrf);
      idleWarningMinutes = null;
      announce('Sesi diperpanjang.');
    } catch(e) { failed(e); }
  }
  function desaPrefix(nomor: string) { return nomor.slice(0, nomor.lastIndexOf('-')).toUpperCase(); }
  function desaHasFieldProgress(items: readonly ListPoint[]) {
    return items.some(item => !item.archived && !item.cadangan && (stageOf(item.nomor, false) > 0 || !!pendingOf(item.nomor, false)));
  }
  async function tidy(event: SubmitEvent, prefix: string, title: string) { event.preventDefault(); submitting = true; error = ''; try {
    const result = await api<{renumbered: number}>('points/renumber', 'POST', { prefix, reason: '' });
    tidying = ''; await loadPoints(); refreshMap();
    // An open point from this desa now has a new Nomor and revision; reload it so saving does not conflict.
    if (detail && desaPrefix(detail.state.nomor) === prefix) await select(detail.id, { keepPane: true });
    announce(`${result.renumbered} titik di ${title} dinomori ulang dan diterbitkan.`);
  } catch(e) { failed(e); } finally { submitting = false; } }
  // The next free number in the picked desa; the field stays editable.
  async function fillNomor(alamat: string) {
    try { const { nomor } = await api<{nomor: string | null}>(`points/next-nomor?${new URLSearchParams({ alamat })}`);
      if (nomor && newPoint.alamat === alamat) newPoint.nomor = nomor;
    } catch(e) { failed(e); }
  }
  function startCreate() { closeBatchMode(); creating = true; detail = undefined; editor = undefined; backdrop?.setSelected(null); newPoint = emptyState(); newReason = ''; pane = 'edit'; }
  function closeBatchMode() { batchMode = false; batchSelected = new Map(); batchReason = ''; batchError = ''; batchLimitHit = false; }
  function toggleBatchMode() {
    if (batchMode) { closeBatchMode(); return; }
    batchMode = true; creating = false; tidying = ''; batchError = ''; batchLimitHit = false; error = '';
  }
  function clearBatchSelection() { batchSelected = new Map(); batchLimitHit = false; batchError = ''; }
  function toggleBatchSelectPoint(point: ListPoint) {
    const result = toggleBatchPoint(batchSelected, point);
    batchSelected = result.next; batchLimitHit = result.limited; batchError = '';
  }
  function toggleBatchSelectGroup(items: readonly ListPoint[]) {
    const result = toggleBatchGroup(batchSelected, items);
    batchSelected = result.next; batchLimitHit = result.limited; batchError = '';
  }
  function removeBatchItem(id: string) {
    const next = new Map(batchSelected);
    next.delete(id);
    batchSelected = next; batchLimitHit = false; batchError = '';
  }
  async function submitBatchArchive(mode: 'publish' | 'draft') {
    if (!batchSelected.size || submitting) return;
    submitting = true; batchError = ''; error = '';
    const selectedIds = new Set(batchSelected.keys());
    const payload = {
      items: batchSelectedList.map(item => ({ id: item.id, base_revision: item.revision })),
      reason: batchReason,
      mode,
    };
    try {
      const result = await api<BatchArchiveResult>('points/batch-archive', 'POST', payload);
      closeBatchMode();
      await loadPoints();
      if (result.mode === 'publish') refreshMap();
      if (detail && selectedIds.has(detail.id)) void select(detail.id, { keepPane: true });
      announce(
        result.mode === 'publish'
          ? `${result.archived} titik diarsipkan dan diterbitkan. Peta publik akan memperbarui titik secara otomatis.`
          : `${result.archived} draf arsip tersimpan. Tinjau dan terbitkan di tab Draf.`,
      );
      if (narrow()) pane = 'list';
    } catch (e) {
      batchError = e instanceof Error ? e.message : 'Pengarsipan massal gagal.';
      if (e instanceof ApiError && e.status === 409) void loadPoints();
    } finally {
      submitting = false;
    }
  }
  function leave(event: SubmitEvent) {
    if (reducedMotion() || narrow()) return;
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    phase = 'closing';
    setTimeout(() => form.submit(), 620);
  }
  onMount(() => {
    backdrop = createBackdrop(backdropEl, { onSelect: id => { if (page === 'points' && !batchMode) select(id); } });
    onApiActivity(() => { lastActivity = Date.now(); idleWarningMinutes = null; });
    const idleTimer = setInterval(() => {
      if (!account) return;
      const elapsed = Math.floor((Date.now() - lastActivity) / 1000);
      const remaining = idleSeconds - elapsed;
      if (remaining <= 0) idleWarningMinutes = 0;
      else if (remaining <= 300) idleWarningMinutes = Math.max(1, Math.ceil(remaining / 60));
      else idleWarningMinutes = null;
    }, 15_000);
    // no-cache: esdm.cloud allows a 60 s browser copy, which hid a stage just accepted there.
    fetch(PROGRESS_URL, { credentials: 'omit', cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(v => { if (v) { progress = parseProgress(v); pending = parsePending(v); } }).catch(() => {});
    (async () => {
      try {
        const result = await api<{account: Account; csrf: string; idle_seconds?: number; points: PointsResponse; regions: typeof regions; map: {items: MapPoint[]}}>('bootstrap');
        account = result.account; csrf = result.csrf; setCsrf(csrf);
        if (result.idle_seconds) idleSeconds = result.idle_seconds;
        applyPointsResponse(result.points);
        regions = result.regions;
        mapPoints = result.map.items;
        backdrop?.setPoints(result.map.items);
        if (phase === 'login') {
          // Commit the login card's height with a forced reflow, then grow.
          // Not requestAnimationFrame: browsers pause it in background tabs,
          // which left the dashboard stuck at the card's size.
          allowMotion(); await tick();
          void sheetEl.offsetHeight;
          phase = 'open';
        } else { await tick(); allowMotion(); }
      } catch(e) { failed(e); phase = 'open'; }
    })();
    return () => { clearInterval(idleTimer); clearTimeout(searchTimer); clearTimeout(auditTimer); onApiActivity(undefined); backdrop?.dispose(); };
  });
</script>

<div class="backdrop" bind:this={backdropEl} aria-hidden="true"></div>
<div class="sheet app-sheet" bind:this={sheetEl} class:is-wide={page !== 'points'} data-phase={phase} data-pane={pane} style:--login-h={`${unfoldFrom || 540}px`}>
  <header class="sheet-head">
    <span class="emblem" aria-hidden="true"></span>
    <div class="sheet-title"><h1>Administrasi Survei</h1><p>{account ? `Peran: ${ROLE[account.role] ?? account.role}` : 'Data Titik & Dokumentasi PUTS'}</p></div>
    {#if account}<div class="account-menu"><span class="who"><strong>{account.username}</strong><button type="button" class="link-button" aria-current={page === 'password' ? 'page' : undefined} onclick={() => navigate('password')}>Ubah Kata Sandi</button></span><form method="post" action="/admin/logout" onsubmit={leave}><input type="hidden" name="csrfmiddlewaretoken" value={csrf}><button type="submit" class="btn-ghost">Keluar</button></form></div>{/if}
  </header>
  {#if account}<nav class="tabs" aria-label="Navigasi Administrasi">
    <button type="button" aria-current={page === 'points' ? 'page' : undefined} onclick={() => navigate('points')}>Titik</button><button type="button" aria-current={page === 'drafts' ? 'page' : undefined} onclick={() => navigate('drafts')}>Draf{#if pendingDrafts}<span class="tab-badge" aria-label={`${pendingDrafts} draf menunggu`}>{pendingDrafts}</span>{/if}</button>
    {#if canPublish}<button type="button" aria-current={page === 'publications' ? 'page' : undefined} onclick={() => navigate('publications')}>Penerbitan</button><button type="button" aria-current={page === 'audit' ? 'page' : undefined} onclick={() => navigate('audit')}>Audit</button><button type="button" aria-current={page === 'evidence' ? 'page' : undefined} onclick={() => navigate('evidence')}>Bukti Lama</button>{/if}
    {#if account.role === 'owner'}<button type="button" aria-current={page === 'accounts' ? 'page' : undefined} onclick={() => navigate('accounts')}>Akun</button>{/if}
  </nav>{/if}
  {#if account && page === 'points'}<div class="panes" role="group" aria-label="Tampilan">
    <button type="button" aria-pressed={pane === 'list'} onclick={() => pane = 'list'}>Daftar</button>
    <button type="button" aria-pressed={pane === 'edit'} onclick={() => pane = 'edit'}>{batchMode ? (batchSelectedList.length ? `Arsipkan (${batchSelectedList.length})` : 'Arsipkan') : 'Sunting'}</button>
    <button type="button" aria-pressed={pane === 'photo'} onclick={() => pane = 'photo'} disabled={batchMode || (!editor && !creating)}>Foto & Lokasi</button>
  </div>{/if}
  {#if idleWarningMinutes !== null}
    <div class="notices">
      <div class="session-warning" role="alert">
        <span>{idleWarningMinutes === 0 ? 'Sesi mungkin telah berakhir karena tidak ada aktivitas.' : `Sesi akan berakhir dalam ~${idleWarningMinutes} menit karena tidak ada aktivitas.`}</span>
        <button type="button" class="btn-ghost" onclick={extendSession}>Perpanjang Sesi</button>
      </div>
    </div>
  {/if}
  {#if message || error}<div class="notices">{#if message}<p class="notice-success" role="status">{message}</p>{/if}{#if error}<p class="notice-error" role="alert">{error}</p>{/if}</div>{/if}

  {#if !account}<p class="sheet-body loading">Memuat Sesi…</p>
  {:else if page === 'points'}
    <section class="editor sheet-body">
      {#if batchMode}
        <BatchArchiveSheet
          items={batchSelectedList}
          {counts}
          {canPublish}
          busy={submitting}
          error={batchError}
          limitHit={batchLimitHit}
          bind:reason={batchReason}
          {stageOf}
          {pendingOf}
          onRemove={removeBatchItem}
          onClear={clearBatchSelection}
          onClose={closeBatchMode}
          onOpenListPane={() => pane = 'list'}
          onSubmit={submitBatchArchive}
        />
      {:else if editor}{#key editor}<EditorSheet {editor} {canPublish} nearby={mapPoints} stage={stageOf(editor.detail.state.nomor, editor.detail.state.status === 'Cadangan')} pending={pendingOf(editor.detail.state.nomor, editor.detail.state.status === 'Cadangan')} onReload={() => select(editor!.detail.id, { keepPane: true })} onOpenPhotoPane={() => pane = 'photo'}/>{/key}
      {:else if creating}<div class="edit-head"><div class="edit-title"><h2>Titik Baru</h2><p class="edit-id">Titik baru dimulai sebagai arsip. Setelah data dan bukti lengkap, aktivasi diajukan melalui draf.</p></div><button type="button" class="btn-ghost" onclick={() => { creating = false; pane = 'list'; }} disabled={submitting}>Batal</button></div>
        <form class="edit-form" onsubmit={create}><div class="edit-scroll"><fieldset disabled={submitting}><legend>Identitas & Alokasi</legend>
          <label class="field">Nomor<span class="field__req" aria-hidden="true">*</span><input bind:value={newPoint.nomor} placeholder="KABUPATEN-KECAMATAN-DESA-001" autocorrect="off" autocapitalize="characters" spellcheck="false" required maxlength="250"></label>
          <AddressPicker bind:value={newPoint.alamat} onpick={fillNomor}/>
          <label class="field">Alamat Lengkap<span class="field__req" aria-hidden="true">*</span><textarea bind:value={newPoint.alamat} rows="2" maxlength="3000" required></textarea></label>
          <div class="pair"><label class="field">Pengusul<input bind:value={newPoint.nama} maxlength="250" placeholder="Opsional"></label><label class="field">Jalur<input bind:value={newPoint.jalur} maxlength="250" placeholder="Opsional"></label></div>
          <label class="field">Lokasi Rekapan<textarea bind:value={newPoint.lokasi_rekapan} rows="2" maxlength="3000" placeholder="Teks alokasi SK / rekapan"></textarea></label>
          <label class="field">Keterangan<textarea bind:value={newPoint.keterangan} rows="2" maxlength="3000" placeholder="Opsional"></textarea></label>
          <label class="field">Status Alokasi<Select label="Status Alokasi" bind:value={newPoint.status} options={[{ value: '', label: 'Alokasi Utama' }, { value: 'Cadangan', label: 'Cadangan' }, { value: 'Belum Ditetapkan', label: 'Belum Ditetapkan' }]}/></label>
          <label class="field">Catatan<textarea bind:value={newPoint.catatan} rows="2" maxlength="6000" placeholder="Opsional"></textarea></label>
        </fieldset>
        <fieldset disabled={submitting}><legend>Koordinat & Alasan</legend>
          <div class="pair"><label class="field">Latitude<span class="field__req" aria-hidden="true">*</span><input type="number" bind:value={newPoint.lat} onpaste={event => pasteCoordinates(event, newPoint)} onwheel={event => event.currentTarget.blur()} min="-90" max="90" step="any" required></label><label class="field">Longitude<span class="field__req" aria-hidden="true">*</span><input type="number" bind:value={newPoint.lon} onpaste={event => pasteCoordinates(event, newPoint)} onwheel={event => event.currentTarget.blur()} min="-180" max="180" step="any" required></label></div>
          <p class="hint">Lokasi dapat ditentukan lewat peta di panel Foto & Lokasi, diketik, atau ditempel sebagai “lat, long”.</p>
          {#if outsideJambi(newPoint.lat, newPoint.lon)}<p class="pin-warning">{OUTSIDE_JAMBI_WARNING}</p>{/if}
          <label class="field">Alasan Penambahan<span class="field__req" aria-hidden="true">*</span><textarea bind:value={newReason} rows="2" maxlength="3000" required></textarea></label>
        </fieldset></div><div class="edit-foot"><p>Titik baru belum tampil di peta publik.</p><button type="submit" class="btn-primary" disabled={submitting}>{submitting ? 'Membuat…' : 'Buat Titik'}</button></div></form>
      {:else}<div class="editor-empty"><h2>Belum Ada Titik Terpilih</h2><p>{canPublish ? 'Titik dari daftar atau pin di peta terbuka di sini. Perubahan dapat disimpan sebagai draf atau langsung diterbitkan.' : 'Titik dari daftar atau pin di peta terbuka di sini. Setiap perubahan tersimpan sebagai draf dan ditinjau sebelum diterbitkan.'}</p></div>{/if}
    </section>
  {:else}<section class="page sheet-body">
    {#if page === 'drafts'}{#key page}<Drafts {canPublish} username={account.username} onMessage={announce} onOpenPoint={id => select(id, { switchTab: true })} onChanged={onDraftsChanged}/>{/key}
    {:else if page === 'accounts'}{#key page}<Accounts currentUsername={account.username} onMessage={announce}/>{/key}
    {:else if page === 'publications'}
      <header class="page-head">
        <div><h2>Riwayat Penerbitan</h2><p>{active ? 'Peta publik memuat versi yang bertanda Aktif. Versi lain tersimpan sebagai riwayat.' : 'Belum ada versi aktif.'}</p></div>
        <div class="page-head__actions">
          <button type="button" class="btn-ghost" disabled={!active || exporting} onclick={() => exportActive('geojson')}>Ekspor GeoJSON</button>
          <button type="button" class="btn-ghost" disabled={!active || exporting} onclick={() => exportActive('csv')}>Ekspor CSV</button>
        </div>
      </header>
      {#if !active}<div class="atlas-section" role="heading" aria-level="3">Baseline Hasil Impor</div><form class="page-row" onsubmit={baseline}><label class="field">Alasan Penerbitan Baseline<textarea bind:value={baselineReason} rows="2" required maxlength="3000"></textarea></label><div class="page-row__actions"><button type="submit" class="btn-primary" disabled={submitting}>Terbitkan Baseline Hasil Impor</button></div></form>{/if}
      <div class="atlas-section" role="heading" aria-level="3">Versi<span>{publications.length} Penerbitan</span></div>
      {#each publications as publication (publication.id)}
        <div class="page-row page-row--compact">
          <div class="page-row__head">
            <div>
              <h3>{new Date(publication.at).toLocaleString('id-ID')}</h3>
              <p class="page-row__meta">{[publication.actor ? `Oleh ${publication.actor}` : '', `Versi ${publication.id}`].filter(Boolean).join(' · ')}</p>
              {#if publication.reason}<p class="page-row__text">{publication.reason}</p>{/if}
            </div>
            <div class="page-row__aside"><span class="page-row__figure"><b>{publication.points}</b> Titik</span>{#if publication.id === active}<span class="badge badge--sk">Aktif</span>{:else}<span class="badge badge--arsip">Riwayat</span>{/if}</div>
          </div>
        </div>
      {:else}<div class="panel-empty"><p>Belum ada penerbitan.</p></div>{/each}
    {:else if page === 'audit'}
      <header class="page-head"><div><h2>Jejak Audit</h2><p>200 peristiwa terbaru sesuai filter. Peristiwa sebelumnya tetap tersimpan di database.</p></div></header>
      <search class="page-filter">
        <form class="page-filter__row" onsubmit={event => { event.preventDefault(); loadAudit(); }}>
          <label class="panel-search"><span class="visually-hidden">Cari Audit</span>
            <svg class="panel-search__icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <input type="search" bind:value={auditQuery} oninput={queueAuditSearch} placeholder="Cari Nomor, Akun, Alasan…" autocorrect="off" autocapitalize="none" spellcheck="false">
            <button type="button" class="panel-search__clear" aria-label="Hapus Pencarian Audit" onclick={() => { auditQuery = ''; loadAudit(); }}><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
          </label>
          <Select variant="pill" label="Jenis Aktivitas" value={auditAction} onchange={value => { auditAction = value; loadAudit(); }} options={auditActionOptions}/>
        </form>
      </search>
      {#each auditRows as row, i (row.id)}
        {@const day = new Date(row.at).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        {#if i === 0 || day !== new Date(auditRows[i - 1].at).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}<div class="atlas-section" role="heading" aria-level="3">{day}</div>{/if}
        <details class="page-row page-row--compact disclosure-row">
          <summary><span class="page-row__time">{new Date(row.at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span><span class="page-row__title">{auditActionLabel(row.action)}</span><span class="page-row__meta">{[row.target_label && row.target_label !== row.target ? row.target_label : '', row.actor || 'Sistem'].filter(Boolean).join(' · ')}</span></summary>
          {#if row.target_label || row.reason}<p class="page-row__text">{[row.target_label || row.target, row.reason].filter(Boolean).join('. ')}</p>{/if}
          {#if row.target_label && row.target_label !== row.target}<p class="page-row__meta">ID: {row.target}</p>{/if}
          {#if row.before != null || row.after != null}<pre>{JSON.stringify({before: row.before, after: row.after}, null, 2)}</pre>{/if}
        </details>
      {:else}<div class="panel-empty"><p>{auditQuery || auditAction ? 'Tidak ada peristiwa audit yang cocok dengan filter ini.' : 'Belum ada peristiwa tercatat.'}</p>{#if auditQuery || auditAction}<div class="panel-empty__actions"><button type="button" onclick={() => { auditQuery = ''; auditAction = ''; loadAudit(); }}>Reset Filter</button></div>{/if}</div>{/each}
    {:else if page === 'evidence'}
      <header class="page-head"><div><h2>Bukti Lama tanpa Titik Terkait</h2><p>Berkas ini dipertahankan sebagai bukti sumber dan tidak dianggap sebagai kunjungan survei baru.</p></div></header>
      <div class="atlas-section" role="heading" aria-level="3">Berkas<span>{evidence.length} Berkas</span></div>
      {#each evidence as item (item.id)}
        <details class="page-row page-row--compact disclosure-row">
          <summary><span class="page-row__title">{item.name}</span><span class="status-flag" class:status-flag--ready={item.ready} class:status-flag--belum={!item.ready}>{item.ready ? 'Dapat Ditampilkan' : 'Hanya Bukti Asli'}</span></summary>
          {#if item.ready}<a class="photo-link photo-link--evidence" href={`/admin/api/photos/${item.id}/display`} target="_blank" rel="noopener" title="Buka Foto di Tab Baru"><img class="evidence-image" src={`/admin/api/photos/${item.id}/display`} alt="Bukti Lama" loading="lazy"></a>{:else}<p class="page-row__text">Format berkas tidak dapat dipublikasikan; berkas asli tetap tersimpan.</p>{/if}
          <p class="page-row__meta">SHA-256 {item.checksum}</p>
          <div class="page-row__actions"><a class="btn-ghost" href={`/admin/api/photos/${item.id}/original`}>Unduh Bukti Asli</a></div>
        </details>
      {:else}<div class="panel-empty"><p>Tidak ada bukti lama tanpa titik terkait.</p></div>{/each}
    {:else if page === 'password'}
      <header class="page-head"><div><h2>Kata Sandi Akun</h2><p>Minimal 15 karakter. Kata sandi yang terlalu umum ditolak. Sesi lain dicabut setelah kata sandi diganti.</p></div></header>
      <div class="atlas-section" role="heading" aria-level="3">Ganti Kata Sandi</div>
      <form class="page-row" onsubmit={changePassword}><fieldset disabled={submitting}><div class="form-grid">
        <label class="field">Kata Sandi Lama<input type="password" bind:value={oldPassword} autocomplete="current-password" required maxlength="1024"></label>
        <label class="field">Kata Sandi Baru<input type="password" bind:value={newPassword} autocomplete="new-password" minlength="15" maxlength="1024" required></label>
      </div><div class="page-row__actions"><button type="submit" class="btn-primary">Perbarui Kata Sandi</button></div></fieldset></form>{/if}
  </section>{/if}

  {#if showWings}
    <aside class="wing wing-l" aria-label="Daftar Titik" in:fold={{ side: 'left', delay: 380 }} out:foldAway={{ side: 'left' }}>
      <search>
        <form class="list-filter" onsubmit={event => { event.preventDefault(); refresh(); }}>
          <label class="panel-search"><span class="visually-hidden">Cari Titik</span>
            <svg class="panel-search__icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <input type="search" bind:value={q} oninput={queueSearch} placeholder="Cari Nomor, Rekapan, Alamat, Koordinat…" autocorrect="off" autocapitalize="none" spellcheck="false">
            <button type="button" class="panel-search__clear" aria-label="Hapus Pencarian" onclick={() => { q = ''; refresh(); }}><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
          </label>
          <div class="filter-row">
            <Select variant="pill" label="Kabupaten/Kota" value={region} onchange={value => { region = value; pendingOnly = false; refresh({ region: value }); }} options={regionOptions}/>
          </div>
          <div class="filter-row">
            <Select variant="pill" label="Status" value={status} onchange={value => { status = value; pendingOnly = false; refresh({ status: value }); }} options={[{ value: '', label: 'Semua Status' }, { value: 'resmi', label: 'Alokasi Resmi' }, { value: 'pasti', label: 'Titik Pasti' }, { value: 'Cadangan', label: 'Cadangan' }, { value: 'Belum Ditetapkan', label: 'Belum Ditetapkan' }, { value: 'duplikat', label: 'Perlu Verifikasi' }, { value: 'drafts', label: 'Ada Draf Menunggu' }, { value: 'tanpa_foto', label: 'Tanpa Foto Survei' }, { value: 'urut', label: 'Nomor Belum Urut' }]}/>
            <label class="switch-row"><span class="ctl-switch"><input type="checkbox" checked={archived && !officialOnly} onchange={event => { archived = event.currentTarget.checked; refresh(); }} disabled={officialOnly}><span class="ctl-switch__track" aria-hidden="true"><span class="ctl-switch__thumb"></span></span></span>Sertakan Arsip</label>
          </div>
        </form>
      </search>
      <!-- Overview, actions, then the result count: the three used to be mixed
           into the filter rows, with Export alone on a line as a bare link. -->
      {#if counts}<div class="list-overview">
        <div class="atlas-total"><span class="atlas-total__num">{counts.official}</span><span class="atlas-total__label"><span>Alokasi Resmi</span><span>{counts.cadangan} Cadangan Tidak Dihitung</span></span></div>
        <!-- One row per flag with the number right-aligned, so the list reads as
             a tally; each row toggles the matching status filter. -->
        <ul class="list-overview__flags">
          <li><button type="button" class="status-flag status-flag--duplikat list-overview__flag" aria-pressed={status === 'duplikat'} onclick={() => toggleFlagFilter('duplikat')}><span>Perlu Verifikasi</span><b>{counts.duplikat}</b></button></li>
          <li><button type="button" class="status-flag status-flag--belum list-overview__flag" aria-pressed={status === 'Belum Ditetapkan'} onclick={() => toggleFlagFilter('Belum Ditetapkan')}><span>Belum Ditetapkan</span><b>{counts.belum}</b></button></li>
          {#if Object.keys(gaps).length}<li><button type="button" class="status-flag status-flag--urut list-overview__flag" aria-pressed={status === 'urut'} onclick={() => toggleFlagFilter('urut')}><span>Desa Nomor Belum Urut</span><b>{Object.keys(gaps).length}</b></button></li>{/if}
          {#if missingPhoto}<li><button type="button" class="status-flag status-flag--belum list-overview__flag" aria-pressed={status === 'tanpa_foto'} onclick={() => toggleFlagFilter('tanpa_foto')}><span>Tanpa Foto Survei</span><b>{missingPhoto}</b></button></li>{/if}
          {#if openPendingNomors.length}<li><button type="button" class="status-flag status-flag--pending list-overview__flag" aria-pressed={pendingOnly} onclick={togglePendingFilter}><span>Laporan Menunggu (esdm.cloud)</span><b>{openPendingNomors.length}</b></button></li>{/if}
        </ul>
      </div>{/if}
      <div class="list-actions">
        {#if canPublish}<button type="button" class="btn-ghost list-actions__btn" disabled={exporting} aria-busy={exporting} onclick={exportPoints} title="Unduh alokasi resmi sesuai pencarian dan kabupaten terpilih, beserta foto survei (.xlsx)"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19h14"/></svg>{exporting ? 'Menyiapkan…' : 'Ekspor Excel'}</button>{/if}
        <button type="button" class="list-actions__btn list-actions__btn--primary" onclick={startCreate}><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Tambah Titik</button>
      </div>
      <div class="atlas-summary">
        <p><b>{total}</b> Titik Ditemukan</p>
        <button type="button" class="text-action" class:text-action--danger={batchMode} aria-pressed={batchMode} onclick={toggleBatchMode}>{batchMode ? 'Selesai Pilih' : 'Arsipkan Massal'}</button>
      </div>
      {#if batchMode}
        <div class="batch-bar" aria-live="polite">
          <span class="batch-bar__count"><b>{batchSelectedList.length}</b>/{BATCH_ARCHIVE_LIMIT} dipilih</span>
          <span class="batch-bar__actions">
            {#if visibleActivePoints.length}
              <button type="button" class="text-action" onclick={() => toggleBatchSelectGroup(visibleActivePoints)}>{allPageSelected ? 'Lepas Halaman' : 'Pilih Halaman'}</button>
            {/if}
            {#if batchSelectedList.length}
              <button type="button" class="text-action text-action--danger" onclick={clearBatchSelection}>Kosongkan</button>
            {/if}
          </span>
        </div>
      {/if}
      <div class="sidebar-scroll" use:stuckHeads>
        {#each sections as section (section.key)}
          <div class="atlas-group">
            <div class="atlas-section" role="heading" aria-level="3">{section.title}<span>{section.kabupaten}</span></div>
            {#each section.groups as group (group.key)}
              {@const prefix = desaPrefix(group.items[0].nomor)}
              {@const tidyKey = section.key + '|' + group.key}
              {@const selectableInGroup = batchMode ? group.items.filter(point => !point.archived) : []}
              {@const allGroupSelected = batchMode && selectableInGroup.length > 0 && selectableInGroup.every(point => batchSelected.has(point.id))}
              <div class="atlas-desa">
                <div class="atlas-desa__head">
                  <span class="atlas-desa__title">{group.head.title}</span>
                  <span class="atlas-desa__side">
                    <span class="atlas-desa__count">{group.items.filter(point => !point.cadangan).length} Titik</span>
                    {#if batchMode}
                      {#if selectableInGroup.length}
                        <button
                          type="button"
                          class="text-action"
                          aria-pressed={allGroupSelected}
                          aria-label={allGroupSelected ? `Lepas Desa ${group.head.title}` : `Pilih Desa ${group.head.title}`}
                          onclick={() => toggleBatchSelectGroup(group.items)}
                        >{allGroupSelected ? 'Lepas Desa' : 'Pilih Desa'}</button>
                      {/if}
                    {:else if canPublish && gaps[prefix] && tidying !== tidyKey}
                      <button type="button" class="text-action" title="Urutkan ulang nomor unit desa ini menjadi 001, 002, … lalu terbitkan" onclick={() => tidying = tidyKey}>Rapikan Nomor</button>
                    {/if}
                  </span>
                </div>
                {#if !batchMode && tidying === tidyKey}<form class="desa-tidy" onsubmit={event => tidy(event, prefix, group.head.title)}><p class="desa-tidy__note">Nomor aktif menjadi 001, 002, … dan langsung terbit.</p>{#if desaHasFieldProgress(group.items)}<p class="pin-warning desa-tidy__warn">Ada unit di desa ini yang sudah punya progres di esdm.cloud. Mengubah Nomor dapat memengaruhi pencocokan laporan lapangan.</p>{/if}<button type="submit" class="btn-primary" disabled={submitting}>Rapikan</button><button type="button" class="btn-ghost" onclick={() => tidying = ''}>Batal</button></form>{/if}
                {#if gaps[prefix]}<p class="status-flag status-flag--urut atlas-desa__flag">Nomor Belum Urut ({gaps[prefix].map(n => String(n).padStart(3, '0')).join(', ')})</p>{/if}
                {#if group.head.line}<p class="atlas-desa__note">Rekapan: {group.head.line}</p>{/if}
                {#if group.shared}<p class="atlas-desa__note">{group.shared}</p>{/if}
                <div class="atlas-units">
                  {#each group.items as point, index (point.id)}
                    {@const stage = stageOf(point.nomor, point.cadangan)}
                    {@const waiting = pendingOf(point.nomor, point.cadangan)}
                    {@const picked = batchMode && batchSelected.has(point.id)}
                    <button
                      class="atlas-pt"
                      class:is-batch-selected={picked}
                      class:is-batch-disabled={batchMode && point.archived}
                      type="button"
                      disabled={batchMode && point.archived}
                      aria-pressed={batchMode ? picked : detail?.id === point.id}
                      aria-label={[`Titik ${point.display.code}`, badgeOf(editorState(point)).label, point.drafts ? 'Ada Draf Menunggu' : '', point.display.primary, stage ? stageSummary(stage) : '', waiting ? pendingSummary(waiting) : ''].filter(Boolean).join('. ')}
                      onclick={() => batchMode ? toggleBatchSelectPoint(point) : select(point.id)}
                    >
                      <span class="atlas-unit" class:is-active={!batchMode && detail?.id === point.id} class:is-batch-selected={picked} class:is-cadangan={point.cadangan} class:is-duplikat={point.duplikat} class:is-belum={point.belum} class:is-arsip={point.archived}>
                        {#if picked}<svg class="atlas-unit__check" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>{/if}{point.display.code}
                      </span>
                      <span class="atlas-pt__info">
                        {#if !group.shared && group.landmarks[index]}<span class="atlas-pt__note">{group.landmarks[index]}</span>{/if}
                        {#if point.archived}<span class="atlas-pt__coord atlas-pt__coord--none">Arsip</span>
                        {:else if point.belum || !point.koordinat}<span class="atlas-pt__coord atlas-pt__coord--none">Belum Ada Koordinat</span>
                        {:else}<span class="atlas-pt__coord">{point.koordinat.split(', ')[0]}<br/>{point.koordinat.split(', ')[1]}</span>{/if}
                        {#if point.drafts}<span class="atlas-pt__draft">{point.drafts > 1 ? `${point.drafts} Draf` : 'Ada Draf'}</span>{/if}
                      </span>
                      {#if stage || waiting}<span class="atlas-pt__stages" aria-hidden="true">
                        {#if stage}<span class="atlas-pt__stage" class:is-done={stageDone(stage)}>{@html stageBadgeSvg(stage)}{stageSummary(stage)}</span>{/if}
                        {#if waiting}<span class="atlas-pt__stage is-pending" title={pendingSummary(waiting)}>{@html PENDING_CLOCK_SVG}{pendingLabel(waiting)}</span>{/if}
                      </span>{/if}
                    </button>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <div class="panel-empty"><p>{q || status || region || pendingOnly ? 'Tidak ada titik yang cocok dengan filter ini.' : 'Belum ada titik untuk ditampilkan.'}</p>{#if q || status || region || pendingOnly}<div class="panel-empty__actions"><button type="button" onclick={resetAllFilters}>Reset Filter</button></div>{/if}</div>
        {/each}
      </div>
      {#if batchMode}
        <div class="batch-mobile-bar">
          <span><b>{batchSelectedList.length}</b> titik dipilih</span>
          <button type="button" class="btn-primary btn-primary--danger" disabled={!batchSelectedList.length} onclick={() => pane = 'edit'}>Tinjau & Arsipkan</button>
        </div>
      {/if}
      <div class="list-pager">
        <button type="button" class="text-action" disabled={busy || listPage <= 1} onclick={() => { listPage--; loadPoints(); }}><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>Sebelumnya</button>
        <span class="list-pager__count" title="Halaman {listPage} dari {pages}"><b>{listPage}</b> dari {pages}</span>
        <button type="button" class="text-action" disabled={busy || listPage >= pages} onclick={() => { listPage++; loadPoints(); }}>Berikutnya<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>
      </div>
    </aside>
    <aside class="wing wing-r" aria-label="Foto dan Lokasi" in:fold={{ side: 'right', delay: 460 }} out:foldAway={{ side: 'right' }}>
      <div class="wing-scroll">
        {#if batchMode}<div class="wing-empty"><h3>Arsipkan Massal</h3><p>Foto survei, koordinat, dan riwayat titik tetap tersimpan aman. Titik yang diarsipkan keluar dari peta publik dan masih dapat dipulihkan lewat riwayat revisi.</p></div>
        {:else if editor}{#key editor}<EditorWing {editor} canRevoke={account?.role === 'owner'} nearby={mapPoints}/>{/key}
        {:else if creating}<section class="wing-section"><h3>Lokasi</h3><CoordinateMap bind:lat={newPoint.lat} bind:lon={newPoint.lon} disabled={submitting} nearby={mapPoints}/></section>
        {:else}<div class="wing-empty"><h3>Foto & Lokasi</h3><p>Foto survei, peta koordinat, dan riwayat titik tampil di sini setelah titik dipilih.</p></div>{/if}
      </div>
    </aside>
  {/if}
</div>
