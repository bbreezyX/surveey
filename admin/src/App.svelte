<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { api, setCsrf, emptyState, type Account, type PointRow, type Detail, type PointState, type Counts } from './api';
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
  let account = $state<Account>(); let csrf = $state(''); let error = $state(''); let message = $state(''); let busy = $state(false);
  let page = $state<'points' | 'drafts' | 'publications' | 'accounts' | 'audit' | 'password' | 'evidence'>('points');
  let points = $state<PointRow[]>([]); let detail = $state<Detail>(); let q = $state(''); let status = $state(''); let archived = $state(false);
  let listPage = $state(1); let pages = $state(1); let total = $state(0); let counts = $state<Counts>();
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
  // badgeOf reads only these fields; the list point carries them under public names.
  function editorState(point: ListPoint) { return { archived: point.archived, status: point.cadangan ? 'Cadangan' : point.belum ? 'Belum Ditetapkan' : '', duplikat: point.duplikat } as PointState; }
  // Search runs as the user types, like the public map's; the server does the matching.
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  function refresh() { clearTimeout(searchTimer); listPage = 1; loadPoints(); }
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
  function kabupaten(nomor: string) { return nomor.split('-')[0].toLowerCase().replace(/\b\w/g, c => c.toUpperCase()); }
  async function loadPoints() {
    error = ''; busy = true;
    try { const result = await api<{items: PointRow[]; total: number; pages: number; counts: Counts}>(`points?${new URLSearchParams({ q, status, page: String(listPage), archived: archived ? '1' : '0' })}`);
      points = result.items; total = result.total; pages = result.pages; counts = result.counts;
    } catch(e) { failed(e); } finally { busy = false; }
  }
  async function loadMap() {
    try { backdrop?.setPoints((await api<{items: MapPoint[]}>('points/map')).items); } catch { /* the backdrop is scenery */ }
  }
  async function select(id: string) {
    busy = true; error = ''; creating = false; pane = 'edit';
    try { detail = await api<Detail>(`points/${id}`); editor = new PointEditor(detail, { onSaved: text => { announce(text); loadPoints(); select(id); } }); backdrop?.setSelected(id); }
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
    (async () => {
      try {
        const result = await api<{account: Account; csrf: string}>('session'); account = result.account; csrf = result.csrf; setCsrf(csrf);
        if (phase === 'login') {
          // Commit the login card's height with a forced reflow, then grow.
          // Not requestAnimationFrame: browsers pause it in background tabs,
          // which left the dashboard stuck at the card's size.
          allowMotion(); await tick();
          void sheetEl.offsetHeight;
          phase = 'open';
        } else { await tick(); allowMotion(); }
        await Promise.all([loadPoints(), loadMap()]);
      } catch(e) { failed(e); phase = 'open'; }
    })();
    return () => backdrop?.dispose();
  });
</script>

<div class="backdrop" bind:this={backdropEl} aria-hidden="true"></div>
<div class="sheet app-sheet" bind:this={sheetEl} class:is-wide={page !== 'points'} data-phase={phase} data-pane={pane} style:--login-h={`${unfoldFrom || 540}px`}>
  <header class="sheet-head">
    <span class="emblem" aria-hidden="true"></span>
    <div class="sheet-title"><h1>Administrasi survei</h1><p>{account ? `Peran: ${ROLE[account.role] ?? account.role}` : 'Data titik & dokumentasi PUTS'}</p></div>
    {#if account}<div class="account-menu"><span class="who"><strong>{account.username}</strong><button type="button" class="link-button" aria-current={page === 'password' ? 'page' : undefined} onclick={() => navigate('password')}>Ubah kata sandi</button></span><form method="post" action="/admin/logout" onsubmit={leave}><input type="hidden" name="csrfmiddlewaretoken" value={csrf}><button class="btn-ghost">Keluar</button></form></div>{/if}
  </header>
  {#if account}<nav class="tabs" aria-label="Navigasi administrasi">
    <button aria-current={page === 'points' ? 'page' : undefined} onclick={() => navigate('points')}>Titik</button><button aria-current={page === 'drafts' ? 'page' : undefined} onclick={() => navigate('drafts')}>Draf</button>
    {#if canPublish}<button aria-current={page === 'publications' ? 'page' : undefined} onclick={() => navigate('publications')}>Penerbitan</button><button aria-current={page === 'audit' ? 'page' : undefined} onclick={() => navigate('audit')}>Audit</button><button aria-current={page === 'evidence' ? 'page' : undefined} onclick={() => navigate('evidence')}>Bukti lama</button>{/if}
    {#if account.role === 'owner'}<button aria-current={page === 'accounts' ? 'page' : undefined} onclick={() => navigate('accounts')}>Akun</button>{/if}
  </nav>{/if}
  {#if account && page === 'points'}<div class="panes" role="group" aria-label="Tampilan">
    <button type="button" aria-pressed={pane === 'list'} onclick={() => pane = 'list'}>Daftar</button>
    <button type="button" aria-pressed={pane === 'edit'} onclick={() => pane = 'edit'}>Sunting</button>
    <button type="button" aria-pressed={pane === 'photo'} onclick={() => pane = 'photo'} disabled={!editor && !creating}>Foto & lokasi</button>
  </div>{/if}
  {#if message || error}<div class="notices">{#if message}<p class="notice-success" role="status">{message}</p>{/if}{#if error}<p class="notice-error" role="alert">{error}</p>{/if}</div>{/if}

  {#if !account}<p class="sheet-body loading">Memuat sesi…</p>
  {:else if page === 'points'}
    <section class="editor sheet-body">
      {#if editor}{#key editor}<EditorSheet {editor} onReload={() => select(editor!.detail.id)}/>{/key}
      {:else if creating}<div class="edit-head"><div class="edit-title"><h2>Titik baru</h2><p class="edit-id">Titik baru dimulai sebagai arsip. Setelah data dan bukti lengkap, aktivasi diajukan melalui draf.</p></div></div>
        <form class="edit-form" onsubmit={create}><div class="edit-scroll"><fieldset disabled={busy}><legend>Identitas & lokasi</legend>
          <label class="field">Nomor<input bind:value={newPoint.nomor} placeholder="KABUPATEN-KECAMATAN-DESA-001" required maxlength="250"></label>
          <AddressPicker bind:value={newPoint.alamat}/>
          <label class="field">Alamat lengkap<textarea bind:value={newPoint.alamat} rows="2" maxlength="3000" required></textarea></label>
          <div class="pair"><label class="field">Latitude<input type="number" bind:value={newPoint.lat} min="-90" max="90" step="any" required></label><label class="field">Longitude<input type="number" bind:value={newPoint.lon} min="-180" max="180" step="any" required></label></div>
          <p class="hint">Lokasi dapat ditentukan lewat peta di panel Foto & lokasi atau diketik sebagai koordinat.</p>
          <label class="field">Alasan penambahan<textarea bind:value={newReason} rows="2" maxlength="3000" required></textarea></label>
        </fieldset></div><div class="edit-foot"><p>Titik baru belum tampil di peta publik.</p><button class="btn-primary" disabled={busy}>Buat titik</button></div></form>
      {:else}<div class="editor-empty"><h2>Belum ada titik terpilih</h2><p>Titik dari daftar atau pin di peta terbuka di sini. Setiap perubahan tersimpan sebagai draf dan ditinjau sebelum diterbitkan.</p></div>{/if}
    </section>
  {:else}<section class="page sheet-body">
    {#if page === 'drafts'}{#key page}<Drafts {canPublish} onMessage={announce}/>{/key}
    {:else if page === 'accounts'}{#key page}<Accounts onMessage={announce}/>{/key}
    {:else if page === 'publications'}
      <header class="page-head">
        <div><h2>Riwayat penerbitan</h2><p>{active ? 'Peta publik memuat versi yang bertanda Aktif. Versi lain tersimpan sebagai riwayat.' : 'Belum ada versi aktif.'}</p></div>
        <div class="page-head__actions"><a class="btn-ghost" href="/admin/api/export">Ekspor GeoJSON</a><a class="btn-ghost" href="/admin/api/export.csv">Ekspor CSV</a></div>
      </header>
      {#if !active}<div class="atlas-section" role="heading" aria-level="3">Baseline hasil impor</div><form class="page-row" onsubmit={baseline}><label class="field">Alasan penerbitan baseline<textarea bind:value={baselineReason} rows="2" required maxlength="3000"></textarea></label><div class="page-row__actions"><button class="btn-primary" disabled={busy}>Terbitkan baseline hasil impor</button></div></form>{/if}
      <div class="atlas-section" role="heading" aria-level="3">Versi<span>{publications.length} penerbitan</span></div>
      {#each publications as publication}
        <div class="page-row page-row--compact">
          <div class="page-row__head">
            <div><h3>{new Date(publication.at).toLocaleString('id-ID')}</h3><p class="page-row__meta">Versi {publication.id}</p></div>
            <div class="page-row__aside"><span class="page-row__figure"><b>{publication.points}</b> titik</span>{#if publication.id === active}<span class="badge badge--sk">Aktif</span>{:else}<span class="badge badge--arsip">Riwayat</span>{/if}</div>
          </div>
        </div>
      {:else}<div class="panel-empty"><p>Belum ada penerbitan.</p></div>{/each}
    {:else if page === 'audit'}
      <header class="page-head"><div><h2>Jejak audit</h2><p>200 peristiwa terbaru. Peristiwa sebelumnya tetap tersimpan di database.</p></div></header>
      {#each auditRows as row, i}
        {@const day = new Date(row.at).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        {#if i === 0 || day !== new Date(auditRows[i - 1].at).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}<div class="atlas-section" role="heading" aria-level="3">{day}</div>{/if}
        <details class="page-row page-row--compact disclosure-row">
          <summary><span class="page-row__time">{new Date(row.at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span><span class="page-row__title">{row.action}</span><span class="page-row__meta">{row.actor || 'Sistem'}</span></summary>
          {#if row.target || row.reason}<p class="page-row__text">{[row.target, row.reason].filter(Boolean).join('. ')}</p>{/if}
          <pre>{JSON.stringify({before: row.before, after: row.after}, null, 2)}</pre>
        </details>
      {:else}<div class="panel-empty"><p>Belum ada peristiwa tercatat.</p></div>{/each}
    {:else if page === 'evidence'}
      <header class="page-head"><div><h2>Bukti lama tanpa titik terkait</h2><p>Berkas ini dipertahankan sebagai bukti sumber dan tidak dianggap sebagai kunjungan survei baru.</p></div></header>
      <div class="atlas-section" role="heading" aria-level="3">Berkas<span>{evidence.length} berkas</span></div>
      {#each evidence as item}
        <details class="page-row page-row--compact disclosure-row">
          <summary><span class="page-row__title">{item.name}</span><span class="status-flag" class:status-flag--ready={item.ready} class:status-flag--belum={!item.ready}>{item.ready ? 'Dapat ditampilkan' : 'Hanya bukti asli'}</span></summary>
          {#if item.ready}<img class="evidence-image" src={`/admin/api/photos/${item.id}/display`} alt="Bukti lama" loading="lazy">{:else}<p class="page-row__text">Format berkas tidak dapat dipublikasikan; berkas asli tetap tersimpan.</p>{/if}
          <p class="page-row__meta">SHA-256 {item.checksum}</p>
          <div class="page-row__actions"><a class="btn-ghost" href={`/admin/api/photos/${item.id}/original`}>Unduh bukti asli</a></div>
        </details>
      {:else}<div class="panel-empty"><p>Tidak ada bukti lama tanpa titik terkait.</p></div>{/each}
    {:else if page === 'password'}
      <header class="page-head"><div><h2>Kata sandi akun</h2><p>Minimal 15 karakter. Kata sandi yang terlalu umum ditolak. Sesi lain dicabut setelah kata sandi diganti.</p></div></header>
      <div class="atlas-section" role="heading" aria-level="3">Ganti kata sandi</div>
      <form class="page-row" onsubmit={changePassword}><fieldset disabled={busy}><div class="form-grid">
        <label class="field">Kata sandi lama<input type="password" bind:value={oldPassword} autocomplete="current-password" required maxlength="1024"></label>
        <label class="field">Kata sandi baru<input type="password" bind:value={newPassword} autocomplete="new-password" minlength="15" maxlength="1024" required></label>
      </div><div class="page-row__actions"><button class="btn-primary">Perbarui kata sandi</button></div></fieldset></form>{/if}
  </section>{/if}

  {#if showWings}
    <aside class="wing wing-l" aria-label="Daftar titik" in:fold={{ side: 'left', delay: 380 }} out:foldAway={{ side: 'left' }}>
      <form class="list-filter" onsubmit={event => { event.preventDefault(); refresh(); }}>
        <label class="panel-search"><span class="visually-hidden">Cari titik</span>
          <svg class="panel-search__icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input type="search" bind:value={q} oninput={queueSearch} placeholder="Cari nomor, alamat, pengusul…">
          <button type="button" class="panel-search__clear" aria-label="Hapus pencarian" onclick={() => { q = ''; refresh(); }}><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        </label>
        <div class="filter-row">
          <Select variant="pill" label="Status" bind:value={status} onchange={refresh} options={[{ value: '', label: 'Semua status' }, { value: 'Cadangan', label: 'Cadangan' }, { value: 'Belum Ditetapkan', label: 'Belum ditetapkan' }, { value: 'duplikat', label: 'Perlu verifikasi' }]}/>
          <label class="switch-row"><span class="ctl-switch"><input type="checkbox" bind:checked={archived} onchange={refresh}><span class="ctl-switch__track" aria-hidden="true"><span class="ctl-switch__thumb"></span></span></span>Sertakan arsip</label>
        </div>
      </form>
      {#if counts}<div class="atlas-summary atlas-summary--total">
        <div class="atlas-total"><span class="atlas-total__num">{counts.official}</span><span class="atlas-total__label"><span>alokasi resmi</span><span>{counts.cadangan} cadangan tidak dihitung</span></span></div>
        <div class="atlas-flags"><span class="status-flag status-flag--duplikat">{counts.duplikat} perlu verifikasi</span><span class="status-flag status-flag--belum">{counts.belum} belum ditetapkan</span></div>
      </div>{/if}
      <div class="atlas-summary"><p><b>{total}</b> titik ditemukan</p><button type="button" class="text-action" onclick={startCreate}><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Tambah titik</button></div>
      <div class="sidebar-scroll" use:stuckHeads>
        {#each sections as section (section.key)}
          <div class="atlas-group">
            <div class="atlas-section" role="heading" aria-level="3">{section.title}<span>{section.kabupaten}</span></div>
            {#each section.groups as group (group.key)}
              <div class="atlas-desa">
                <div class="atlas-desa__head"><span class="atlas-desa__title">{group.head.title}</span><span class="atlas-desa__count">{group.items.filter(point => !point.cadangan).length} titik</span></div>
                {#if group.head.line}<p class="atlas-desa__note">Rekapan: {group.head.line}</p>{/if}
                {#if group.shared}<p class="atlas-desa__note">{group.shared}</p>{/if}
                <div class="atlas-units">
                  {#each group.items as point, index (point.id)}
                    <button class="atlas-pt" type="button" aria-pressed={detail?.id === point.id} aria-label={[`Titik ${point.display.code}`, badgeOf(editorState(point)).label, point.drafts ? 'Ada draf menunggu' : '', point.display.primary].filter(Boolean).join('. ')} onclick={() => select(point.id)}>
                      <span class="atlas-unit" class:is-active={detail?.id === point.id} class:is-cadangan={point.cadangan} class:is-duplikat={point.duplikat} class:is-belum={point.belum} class:is-arsip={point.archived}>{point.display.code}</span>
                      <span class="atlas-pt__info">
                        {#if !group.shared && group.landmarks[index]}<span class="atlas-pt__note">{group.landmarks[index]}</span>{/if}
                        {#if point.archived}<span class="atlas-pt__coord atlas-pt__coord--none">Arsip</span>
                        {:else if point.belum || !point.koordinat}<span class="atlas-pt__coord atlas-pt__coord--none">Belum ada koordinat</span>
                        {:else}<span class="atlas-pt__coord">{point.koordinat.split(', ')[0]}<br/>{point.koordinat.split(', ')[1]}</span>{/if}
                        {#if point.drafts}<span class="atlas-pt__draft">{point.drafts > 1 ? `${point.drafts} draf` : 'Ada draf'}</span>{/if}
                      </span>
                    </button>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <div class="panel-empty"><p>{q || status ? 'Tidak ada titik yang cocok dengan pencarian ini.' : 'Belum ada titik untuk ditampilkan.'}</p>{#if q || status}<div class="panel-empty__actions"><button type="button" onclick={() => { q = ''; status = ''; refresh(); }}>Hapus pencarian</button></div>{/if}</div>
        {/each}
      </div>
      <div class="list-pager">
        <button type="button" class="text-action" disabled={busy || listPage <= 1} onclick={() => { listPage--; loadPoints(); }}><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>Sebelumnya</button>
        <span class="list-pager__count" title="Halaman {listPage} dari {pages}"><b>{listPage}</b> dari {pages}</span>
        <button type="button" class="text-action" disabled={busy || listPage >= pages} onclick={() => { listPage++; loadPoints(); }}>Berikutnya<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>
      </div>
    </aside>
    <aside class="wing wing-r" aria-label="Foto dan lokasi" in:fold={{ side: 'right', delay: 460 }} out:foldAway={{ side: 'right' }}>
      <div class="wing-scroll">
        {#if editor}{#key editor}<EditorWing {editor} canRevoke={account?.role === 'owner'}/>{/key}
        {:else if creating}<section class="wing-section"><h3>Lokasi</h3><CoordinateMap bind:lat={newPoint.lat} bind:lon={newPoint.lon}/></section>
        {:else}<div class="wing-empty"><h3>Foto & lokasi</h3><p>Foto survei, peta koordinat, dan riwayat titik tampil di sini setelah titik dipilih.</p></div>{/if}
      </div>
    </aside>
  {/if}
</div>
