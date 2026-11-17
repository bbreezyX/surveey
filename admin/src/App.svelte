<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { api, download, setCsrf, emptyState, pasteCoordinates, type Account, type PointRow, type Detail, type PointState, type Counts } from './api';
  import { createBackdrop, type MapPoint } from './backdrop';
  import { PointEditor, badgeOf } from './editor.svelte';
  import { fold, foldAway, allowMotion, reducedMotion, narrow, UNFOLD_KEY } from './unfold';
  import EditorSheet from './EditorSheet.svelte';
  import EditorWing from './EditorWing.svelte';
  import Drafts from './Drafts.svelte';
  import Accounts from './Accounts.svelte';
  import CoordinateMap from './CoordinateMap.svelte';
  import Select from './Select.svelte';
  import AddressPicker from './AddressPicker.svelte';
  import { listSections, type ListPoint } from './list-points';
  import { auditActionLabel } from './labels';
  import { PENDING_CLOCK_SVG, PROGRESS_URL, parsePending, parseProgress, pendingLabel, pendingSummary, stageBadgeSvg, stageDone, stageSummary, type SurveyPending, type SurveyProgress } from '../../src/shared/survey/progress';
  let account = $state<Account>(); let csrf = $state(''); let error = $state(''); let message = $state(''); let busy = $state(false);
  let page = $state<'points' | 'drafts' | 'publications' | 'accounts' | 'audit' | 'password' | 'evidence'>('points');
  let points = $state<PointRow[]>([]); let detail = $state<Detail>(); let q = $state(''); let status = $state(''); let archived = $state(false);
  // Both official-only filters leave archived points out by definition, so the archive switch is off for them.
  let officialOnly = $derived(status === 'resmi' || status === 'pasti');
  let region = $state('');
  let regions = $state<{ value: string; label: string }[]>([]);
  let regionOptions = $derived([{ value: '', label: 'Semua Kabupaten/Kota' }, ...regions]);
  let exporting = $state(false);
  let pointsRequest = 0;
  let listPage = $state(1); let pages = $state(1); let total = $state(0); let counts = $state<Counts>();
  // Desa whose units are not numbered 001..N (server-side, across all pages).
  let gaps = $state<Record<string, number[]>>({}); let tidying = $state('');
  let creating = $state(false); let newPoint = $state<PointState>(emptyState()); let newReason = $state('');
  let publications = $state<{id: string; at: string; checksum: string; points: number}[]>([]); let active = $state(''); let baselineReason = $state('');
  let auditRows = $state<{id: number; actor: string; action: string; target: string; reason: string; before: unknown; after: unknown; at: string}[]>([]);
  let evidence = $state<{id: string; name: string; ready: boolean; checksum: string}[]>([]);
  let oldPassword = $state(''); let newPassword = $state('');
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
  // Build stage per Nomor from esdm.cloud, the same feed as the public map's chips. Optional:
  // a slow or failed esdm.cloud leaves the list as it was. Cadangan units are not built.
  let progress = $state.raw<SurveyProgress>(new Map());
  const stageOf = (nomor: string, cadangan: boolean) => cadangan ? 0 : progress.get(nomor) ?? 0;
  // Reports a crew sent from esdm.cloud/lapangan that nobody has accepted there yet. They are the ones worth
  // a look here: a crew may have found the unit somewhere else than its pin, so its coordinates or its
  // Perlu Verifikasi flag may need a correction. The public list shows the same "… Menunggu" pill.
  let pending = $state.raw<SurveyPending>(new Map());
  const pendingOf = (nomor: string, cadangan: boolean) => cadangan ? null : pending.get(nomor) ?? null;
  // badgeOf reads only these fields; the list point carries them under public names.
  function editorState(point: ListPoint) { return { archived: point.archived, status: point.cadangan ? 'Cadangan' : point.belum ? 'Belum Ditetapkan' : '', duplikat: point.duplikat } as PointState; }
  // Search runs as the user types, like the public map's; the server does the matching.
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  type PointFilters = Partial<{ region: string; status: string }>;
  function refresh(filters?: PointFilters) { clearTimeout(searchTimer); listPage = 1; loadPoints(filters); }
  function queueSearch() { clearTimeout(searchTimer); searchTimer = setTimeout(refresh, 300); }
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
  async function loadPoints(filters: PointFilters = {}) {
    const requestId = ++pointsRequest;
    error = ''; busy = true;
    try { const result = await api<{items: PointRow[]; total: number; pages: number; counts: Counts; gaps: Record<string, number[]>}>(`points?${new URLSearchParams({ q, region, status, page: String(listPage), archived: archived ? '1' : '0', ...filters })}`);
      if (requestId === pointsRequest) {
        points = result.items; total = result.total; pages = result.pages; counts = result.counts; gaps = result.gaps;
      }
    } catch(e) { if (requestId === pointsRequest) failed(e); } finally { if (requestId === pointsRequest) busy = false; }
  }
  async function exportPoints() {
    exporting = true; error = ''; message = '';
    try {
      await download(`export.xlsx?${new URLSearchParams({ q, region })}`, 'Titik Survei PUTS 2026.xlsx');
      announce('Unduhan Excel titik survei dimulai.');
    } catch(e) { failed(e); } finally { exporting = false; }
  }
  async function select(id: string) {
    busy = true; error = ''; creating = false; pane = 'edit';
    try {
      detail = await api<Detail>(`points/${id}`);
      editor = new PointEditor(detail, {
        onSaved: (text, published) => {
          announce(text);
          loadPoints();
          select(id);
          if (published) api<{items: MapPoint[]}>('points/map').then(result => backdrop?.setPoints(result.items)).catch(() => {});
        },
      });
      backdrop?.setSelected(id);
    }
    catch(e) { failed(e); } finally { busy = false; }
  }
  async function navigate(next: typeof page) { page = next; error = ''; message = ''; try {
    if (next === 'points') await loadPoints();
    if (next === 'publications') { const result = await api<{active_id: string; items: typeof publications}>('publications'); publications = result.items; active = result.active_id; }
    if (next === 'audit') auditRows = (await api<{items: typeof auditRows}>('audit')).items;
    if (next === 'evidence') evidence = (await api<{items: typeof evidence}>('evidence')).items;
  } catch(e) { failed(e); } }
  async function create(event: SubmitEvent) { event.preventDefault(); busy = true; error = ''; try {
    const result = await api<{id: string}>('points', 'POST', { state: $state.snapshot(newPoint), reason: newReason });
    archived = true; listPage = 1; await loadPoints(); await select(result.id); announce('Titik dibuat sebagai arsip. Titik menjadi aktif setelah survei lengkap, status arsip dinonaktifkan, dan drafnya diterbitkan.');
  } catch(e) { failed(e); } finally { busy = false; } }
  async function baseline(event: SubmitEvent) { event.preventDefault(); busy = true; error = ''; try { await api('publications/baseline', 'POST', { reason: baselineReason }); await navigate('publications'); announce('Baseline diterbitkan.'); } catch(e) { failed(e); } finally { busy = false; } }
  async function changePassword(event: SubmitEvent) { event.preventDefault(); busy = true; error = ''; try {
    await api('password', 'POST', { old_password: oldPassword, password: newPassword }); oldPassword = ''; newPassword = '';
    const result = await api<{csrf: string}>('session'); csrf = result.csrf; setCsrf(csrf); announce('Kata sandi diperbarui. Sesi lain dicabut.');
  } catch(e) { failed(e); } finally { busy = false; } }
  function desaPrefix(nomor: string) { return nomor.slice(0, nomor.lastIndexOf('-')).toUpperCase(); }
  async function tidy(event: SubmitEvent, prefix: string, title: string) { event.preventDefault(); busy = true; error = ''; try {
    const result = await api<{renumbered: number}>('points/renumber', 'POST', { prefix, reason: '' });
    tidying = ''; await loadPoints();
    // An open point from this desa now has a new Nomor and revision; reload it so saving does not conflict.
    if (detail && desaPrefix(detail.state.nomor) === prefix) { const keep = pane; await select(detail.id); pane = keep; }
    announce(`${result.renumbered} titik di ${title} dinomori ulang dan diterbitkan.`);
  } catch(e) { failed(e); } finally { busy = false; } }
  // The next free number in the picked desa; the field stays editable.
  async function fillNomor(alamat: string) {
    try { const { nomor } = await api<{nomor: string | null}>(`points/next-nomor?${new URLSearchParams({ alamat })}`);
      if (nomor && newPoint.alamat === alamat) newPoint.nomor = nomor;
    } catch(e) { failed(e); }
  }
  function startCreate() { creating = true; detail = undefined; editor = undefined; backdrop?.setSelected(null); newPoint = emptyState(); newReason = ''; pane = 'edit'; }
  function leave(event: SubmitEvent) {
    if (reducedMotion() || narrow()) return;
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    phase = 'closing';
    setTimeout(() => form.submit(), 620);
  }
  onMount(() => {
    backdrop = createBackdrop(backdropEl, { onSelect: id => { if (page === 'points') select(id); } });
    // no-cache: esdm.cloud allows a 60 s browser copy, which hid a stage just accepted there.
    fetch(PROGRESS_URL, { credentials: 'omit', cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(v => { if (v) { progress = parseProgress(v); pending = parsePending(v); } }).catch(() => {});
    (async () => {
      try {
        const result = await api<{account: Account; csrf: string; points: {items: PointRow[]; total: number; pages: number; counts: Counts; gaps: Record<string, number[]>}; regions: typeof regions; map: {items: MapPoint[]}}>('bootstrap');
        account = result.account; csrf = result.csrf; setCsrf(csrf);
        points = result.points.items; total = result.points.total; pages = result.points.pages;
        counts = result.points.counts; gaps = result.points.gaps; regions = result.regions;
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
    return () => backdrop?.dispose();
  });
</script>

<div class="backdrop" bind:this={backdropEl} aria-hidden="true"></div>
<div class="sheet app-sheet" bind:this={sheetEl} class:is-wide={page !== 'points'} data-phase={phase} data-pane={pane} style:--login-h={`${unfoldFrom || 540}px`}>
  <header class="sheet-head">
    <span class="emblem" aria-hidden="true"></span>
    <div class="sheet-title"><h1>Administrasi Survei</h1><p>{account ? `Peran: ${ROLE[account.role] ?? account.role}` : 'Data Titik & Dokumentasi PUTS'}</p></div>
    {#if account}<div class="account-menu"><span class="who"><strong>{account.username}</strong><button type="button" class="link-button" aria-current={page === 'password' ? 'page' : undefined} onclick={() => navigate('password')}>Ubah Kata Sandi</button></span><form method="post" action="/admin/logout" onsubmit={leave}><input type="hidden" name="csrfmiddlewaretoken" value={csrf}><button class="btn-ghost">Keluar</button></form></div>{/if}
  </header>
  {#if account}<nav class="tabs" aria-label="Navigasi Administrasi">
    <button aria-current={page === 'points' ? 'page' : undefined} onclick={() => navigate('points')}>Titik</button><button aria-current={page === 'drafts' ? 'page' : undefined} onclick={() => navigate('drafts')}>Draf</button>
    {#if canPublish}<button aria-current={page === 'publications' ? 'page' : undefined} onclick={() => navigate('publications')}>Penerbitan</button><button aria-current={page === 'audit' ? 'page' : undefined} onclick={() => navigate('audit')}>Audit</button><button aria-current={page === 'evidence' ? 'page' : undefined} onclick={() => navigate('evidence')}>Bukti Lama</button>{/if}
    {#if account.role === 'owner'}<button aria-current={page === 'accounts' ? 'page' : undefined} onclick={() => navigate('accounts')}>Akun</button>{/if}
  </nav>{/if}
  {#if account && page === 'points'}<div class="panes" role="group" aria-label="Tampilan">
    <button type="button" aria-pressed={pane === 'list'} onclick={() => pane = 'list'}>Daftar</button>
    <button type="button" aria-pressed={pane === 'edit'} onclick={() => pane = 'edit'}>Sunting</button>
    <button type="button" aria-pressed={pane === 'photo'} onclick={() => pane = 'photo'} disabled={!editor && !creating}>Foto & Lokasi</button>
  </div>{/if}
  {#if message || error}<div class="notices">{#if message}<p class="notice-success" role="status">{message}</p>{/if}{#if error}<p class="notice-error" role="alert">{error}</p>{/if}</div>{/if}

  {#if !account}<p class="sheet-body loading">Memuat Sesi…</p>
  {:else if page === 'points'}
    <section class="editor sheet-body">
      {#if editor}{#key editor}<EditorSheet {editor} {canPublish} stage={stageOf(editor.detail.state.nomor, editor.detail.state.status === 'Cadangan')} pending={pendingOf(editor.detail.state.nomor, editor.detail.state.status === 'Cadangan')} onReload={() => select(editor!.detail.id)}/>{/key}
      {:else if creating}<div class="edit-head"><div class="edit-title"><h2>Titik Baru</h2><p class="edit-id">Titik baru dimulai sebagai arsip. Setelah data dan bukti lengkap, aktivasi diajukan melalui draf.</p></div></div>
        <form class="edit-form" onsubmit={create}><div class="edit-scroll"><fieldset disabled={busy}><legend>Identitas & Lokasi</legend>
          <label class="field">Nomor<input bind:value={newPoint.nomor} placeholder="KABUPATEN-KECAMATAN-DESA-001" required maxlength="250"></label>
          <AddressPicker bind:value={newPoint.alamat} onpick={fillNomor}/>
          <label class="field">Alamat Lengkap<textarea bind:value={newPoint.alamat} rows="2" maxlength="3000" required></textarea></label>
          <div class="pair"><label class="field">Latitude<input type="number" bind:value={newPoint.lat} onpaste={event => pasteCoordinates(event, newPoint)} min="-90" max="90" step="any" required></label><label class="field">Longitude<input type="number" bind:value={newPoint.lon} onpaste={event => pasteCoordinates(event, newPoint)} min="-180" max="180" step="any" required></label></div>
          <p class="hint">Lokasi dapat ditentukan lewat peta di panel Foto & Lokasi, diketik, atau ditempel sebagai “lat, long”.</p>
          <label class="field">Alasan Penambahan<textarea bind:value={newReason} rows="2" maxlength="3000" required></textarea></label>
        </fieldset></div><div class="edit-foot"><p>Titik baru belum tampil di peta publik.</p><button class="btn-primary" disabled={busy}>Buat Titik</button></div></form>
      {:else}<div class="editor-empty"><h2>Belum Ada Titik Terpilih</h2><p>{canPublish ? 'Titik dari daftar atau pin di peta terbuka di sini. Perubahan dapat disimpan sebagai draf atau langsung diterbitkan.' : 'Titik dari daftar atau pin di peta terbuka di sini. Setiap perubahan tersimpan sebagai draf dan ditinjau sebelum diterbitkan.'}</p></div>{/if}
    </section>
  {:else}<section class="page sheet-body">
    {#if page === 'drafts'}{#key page}<Drafts {canPublish} onMessage={announce}/>{/key}
    {:else if page === 'accounts'}{#key page}<Accounts onMessage={announce}/>{/key}
    {:else if page === 'publications'}
      <header class="page-head">
        <div><h2>Riwayat Penerbitan</h2><p>{active ? 'Peta publik memuat versi yang bertanda Aktif. Versi lain tersimpan sebagai riwayat.' : 'Belum ada versi aktif.'}</p></div>
        <div class="page-head__actions"><a class="btn-ghost" href="/admin/api/export">Ekspor GeoJSON</a><a class="btn-ghost" href="/admin/api/export.csv">Ekspor CSV</a></div>
      </header>
      {#if !active}<div class="atlas-section" role="heading" aria-level="3">Baseline Hasil Impor</div><form class="page-row" onsubmit={baseline}><label class="field">Alasan Penerbitan Baseline<textarea bind:value={baselineReason} rows="2" required maxlength="3000"></textarea></label><div class="page-row__actions"><button class="btn-primary" disabled={busy}>Terbitkan Baseline Hasil Impor</button></div></form>{/if}
      <div class="atlas-section" role="heading" aria-level="3">Versi<span>{publications.length} Penerbitan</span></div>
      {#each publications as publication}
        <div class="page-row page-row--compact">
          <div class="page-row__head">
            <div><h3>{new Date(publication.at).toLocaleString('id-ID')}</h3><p class="page-row__meta">Versi {publication.id}</p></div>
            <div class="page-row__aside"><span class="page-row__figure"><b>{publication.points}</b> Titik</span>{#if publication.id === active}<span class="badge badge--sk">Aktif</span>{:else}<span class="badge badge--arsip">Riwayat</span>{/if}</div>
          </div>
        </div>
      {:else}<div class="panel-empty"><p>Belum ada penerbitan.</p></div>{/each}
    {:else if page === 'audit'}
      <header class="page-head"><div><h2>Jejak Audit</h2><p>200 peristiwa terbaru. Peristiwa sebelumnya tetap tersimpan di database.</p></div></header>
      {#each auditRows as row, i}
        {@const day = new Date(row.at).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        {#if i === 0 || day !== new Date(auditRows[i - 1].at).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}<div class="atlas-section" role="heading" aria-level="3">{day}</div>{/if}
        <details class="page-row page-row--compact disclosure-row">
          <summary><span class="page-row__time">{new Date(row.at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span><span class="page-row__title">{auditActionLabel(row.action)}</span><span class="page-row__meta">{row.actor || 'Sistem'}</span></summary>
          {#if row.target || row.reason}<p class="page-row__text">{[row.target, row.reason].filter(Boolean).join('. ')}</p>{/if}
          <pre>{JSON.stringify({before: row.before, after: row.after}, null, 2)}</pre>
        </details>
      {:else}<div class="panel-empty"><p>Belum ada peristiwa tercatat.</p></div>{/each}
    {:else if page === 'evidence'}
      <header class="page-head"><div><h2>Bukti Lama tanpa Titik Terkait</h2><p>Berkas ini dipertahankan sebagai bukti sumber dan tidak dianggap sebagai kunjungan survei baru.</p></div></header>
      <div class="atlas-section" role="heading" aria-level="3">Berkas<span>{evidence.length} Berkas</span></div>
      {#each evidence as item}
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
      <form class="page-row" onsubmit={changePassword}><fieldset disabled={busy}><div class="form-grid">
        <label class="field">Kata Sandi Lama<input type="password" bind:value={oldPassword} autocomplete="current-password" required maxlength="1024"></label>
        <label class="field">Kata Sandi Baru<input type="password" bind:value={newPassword} autocomplete="new-password" minlength="15" maxlength="1024" required></label>
      </div><div class="page-row__actions"><button class="btn-primary">Perbarui Kata Sandi</button></div></fieldset></form>{/if}
  </section>{/if}

  {#if showWings}
    <aside class="wing wing-l" aria-label="Daftar Titik" in:fold={{ side: 'left', delay: 380 }} out:foldAway={{ side: 'left' }}>
      <form class="list-filter" onsubmit={event => { event.preventDefault(); refresh(); }}>
        <label class="panel-search"><span class="visually-hidden">Cari Titik</span>
          <svg class="panel-search__icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input type="search" bind:value={q} oninput={queueSearch} placeholder="Cari Nomor, Alamat, Pengusul…">
          <button type="button" class="panel-search__clear" aria-label="Hapus Pencarian" onclick={() => { q = ''; refresh(); }}><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        </label>
        <div class="filter-row">
          <Select variant="pill" label="Kabupaten/Kota" value={region} onchange={value => { region = value; refresh({ region: value }); }} options={regionOptions}/>
        </div>
        <div class="filter-row">
          <Select variant="pill" label="Status" value={status} onchange={value => { status = value; refresh({ status: value }); }} options={[{ value: '', label: 'Semua Status' }, { value: 'resmi', label: 'Alokasi Resmi' }, { value: 'pasti', label: 'Titik Pasti' }, { value: 'Cadangan', label: 'Cadangan' }, { value: 'Belum Ditetapkan', label: 'Belum Ditetapkan' }, { value: 'duplikat', label: 'Perlu Verifikasi' }]}/>
          <label class="switch-row"><span class="ctl-switch"><input type="checkbox" checked={archived && !officialOnly} onchange={event => { archived = event.currentTarget.checked; refresh(); }} disabled={officialOnly}><span class="ctl-switch__track" aria-hidden="true"><span class="ctl-switch__thumb"></span></span></span>Sertakan Arsip</label>
        </div>
      </form>
      <!-- Overview, actions, then the result count: the three used to be mixed
           into the filter rows, with Export alone on a line as a bare link. -->
      {#if counts}<div class="list-overview">
        <div class="atlas-total"><span class="atlas-total__num">{counts.official}</span><span class="atlas-total__label"><span>Alokasi Resmi</span><span>{counts.cadangan} Cadangan Tidak Dihitung</span></span></div>
        <!-- One row per flag with the number right-aligned, so the list reads as
             a tally; inline flags wrapped unevenly in the narrow wing. -->
        <ul class="list-overview__flags">
          <li class="status-flag status-flag--duplikat"><span>Perlu Verifikasi</span><b>{counts.duplikat}</b></li>
          <li class="status-flag status-flag--belum"><span>Belum Ditetapkan</span><b>{counts.belum}</b></li>
          {#if Object.keys(gaps).length}<li class="status-flag status-flag--urut"><span>Desa Nomor Belum Urut</span><b>{Object.keys(gaps).length}</b></li>{/if}
        </ul>
      </div>{/if}
      <div class="list-actions">
        {#if canPublish}<button type="button" class="btn-ghost list-actions__btn" disabled={exporting} aria-busy={exporting} onclick={exportPoints} title="Unduh alokasi resmi sesuai pencarian dan kabupaten terpilih, beserta foto survei (.xlsx)"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19h14"/></svg>{exporting ? 'Menyiapkan…' : 'Ekspor Excel'}</button>{/if}
        <button type="button" class="list-actions__btn list-actions__btn--primary" onclick={startCreate}><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Tambah Titik</button>
      </div>
      <div class="atlas-summary"><p><b>{total}</b> Titik Ditemukan</p></div>
      <div class="sidebar-scroll" use:stuckHeads>
        {#each sections as section (section.key)}
          <div class="atlas-group">
            <div class="atlas-section" role="heading" aria-level="3">{section.title}<span>{section.kabupaten}</span></div>
            {#each section.groups as group (group.key)}
              {@const prefix = desaPrefix(group.items[0].nomor)}
              {@const tidyKey = section.key + '|' + group.key}
              <div class="atlas-desa">
                <div class="atlas-desa__head"><span class="atlas-desa__title">{group.head.title}</span><span class="atlas-desa__side"><span class="atlas-desa__count">{group.items.filter(point => !point.cadangan).length} Titik</span>{#if canPublish && gaps[prefix] && tidying !== tidyKey}<button type="button" class="text-action" title="Urutkan ulang nomor unit desa ini menjadi 001, 002, … lalu terbitkan" onclick={() => tidying = tidyKey}>Rapikan Nomor</button>{/if}</span></div>
                {#if tidying === tidyKey}<form class="desa-tidy" onsubmit={event => tidy(event, prefix, group.head.title)}><p class="desa-tidy__note">Nomor aktif menjadi 001, 002, … dan langsung terbit.</p><button class="btn-primary" disabled={busy}>Rapikan</button><button type="button" class="btn-ghost" onclick={() => tidying = ''}>Batal</button></form>{/if}
                {#if gaps[prefix]}<p class="status-flag status-flag--urut atlas-desa__flag">Nomor Belum Urut ({gaps[prefix].map(n => String(n).padStart(3, '0')).join(', ')})</p>{/if}
                {#if group.head.line}<p class="atlas-desa__note">Rekapan: {group.head.line}</p>{/if}
                {#if group.shared}<p class="atlas-desa__note">{group.shared}</p>{/if}
                <div class="atlas-units">
                  {#each group.items as point, index (point.id)}
                    {@const stage = stageOf(point.nomor, point.cadangan)}
                    {@const waiting = pendingOf(point.nomor, point.cadangan)}
                    <button class="atlas-pt" type="button" aria-pressed={detail?.id === point.id} aria-label={[`Titik ${point.display.code}`, badgeOf(editorState(point)).label, point.drafts ? 'Ada Draf Menunggu' : '', point.display.primary, stage ? stageSummary(stage) : '', waiting ? pendingSummary(waiting) : ''].filter(Boolean).join('. ')} onclick={() => select(point.id)}>
                      <span class="atlas-unit" class:is-active={detail?.id === point.id} class:is-cadangan={point.cadangan} class:is-duplikat={point.duplikat} class:is-belum={point.belum} class:is-arsip={point.archived}>{point.display.code}</span>
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
          <div class="panel-empty"><p>{q || status || region ? 'Tidak ada titik yang cocok dengan filter ini.' : 'Belum ada titik untuk ditampilkan.'}</p>{#if q || status || region}<div class="panel-empty__actions"><button type="button" onclick={() => { q = ''; status = ''; region = ''; refresh(); }}>Reset Filter</button></div>{/if}</div>
        {/each}
      </div>
      <div class="list-pager">
        <button type="button" class="text-action" disabled={busy || listPage <= 1} onclick={() => { listPage--; loadPoints(); }}><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>Sebelumnya</button>
        <span class="list-pager__count" title="Halaman {listPage} dari {pages}"><b>{listPage}</b> dari {pages}</span>
        <button type="button" class="text-action" disabled={busy || listPage >= pages} onclick={() => { listPage++; loadPoints(); }}>Berikutnya<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>
      </div>
    </aside>
    <aside class="wing wing-r" aria-label="Foto dan Lokasi" in:fold={{ side: 'right', delay: 460 }} out:foldAway={{ side: 'right' }}>
      <div class="wing-scroll">
        {#if editor}{#key editor}<EditorWing {editor} canRevoke={account?.role === 'owner'}/>{/key}
        {:else if creating}<section class="wing-section"><h3>Lokasi</h3><CoordinateMap bind:lat={newPoint.lat} bind:lon={newPoint.lon}/></section>
        {:else}<div class="wing-empty"><h3>Foto & Lokasi</h3><p>Foto survei, peta koordinat, dan riwayat titik tampil di sini setelah titik dipilih.</p></div>{/if}
      </div>
    </aside>
  {/if}
</div>
