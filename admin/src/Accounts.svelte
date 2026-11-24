<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type Account } from './api';
  import Select from './Select.svelte';
  const ROLES = [{ value: 'editor', label: 'Editor' }, { value: 'publisher', label: 'Penerbit' }, { value: 'owner', label: 'Pemilik' }];
  let { currentUsername = '', onMessage }: { currentUsername?: string; onMessage: (text: string) => void } = $props();
  let accounts = $state<Account[]>([]);
  let originals = $state<Record<number, { enabled: boolean; role: Account['role'] }>>({});
  let username = $state(''); let name = $state(''); let role = $state('editor'); let password = $state('');
  let reasons = $state<Record<number, string>>({}); let passwords = $state<Record<number, string>>({}); let error = $state(''); let busy = $state(false);
  const moment = (iso: string | null) => iso ? new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Belum pernah masuk';
  function isDirty(account: Account) {
    const base = originals[account.id];
    return !base || base.enabled !== account.enabled || base.role !== account.role || Boolean(passwords[account.id]);
  }
  async function load() {
    busy = true; error = '';
    try {
      accounts = (await api<{items: Account[]}>('accounts')).items;
      originals = Object.fromEntries(accounts.map(a => [a.id, { enabled: a.enabled, role: a.role }]));
    } catch(e) { error = e instanceof Error ? e.message : 'Gagal memuat akun.'; }
    finally { busy = false; }
  }
  onMount(load);
  async function create(event: SubmitEvent) { event.preventDefault(); busy = true; error = ''; try {
    await api('accounts', 'POST', { username, name, role, password }); username = ''; name = ''; password = ''; await load(); onMessage('Akun yang disetujui telah dibuat.');
  } catch(e) { error = e instanceof Error ? e.message : 'Akun tidak dapat dibuat.'; } finally { busy = false; } }
  async function update(event: SubmitEvent, account: Account) {
    event.preventDefault();
    if (!isDirty(account)) return;
    busy = true; error = '';
    try {
      await api(`accounts/${account.id}`, 'PATCH', { enabled: account.enabled, role: account.role, password: passwords[account.id] || '', reason: reasons[account.id] || '' });
      passwords[account.id] = ''; reasons[account.id] = '';
      await load();
      onMessage(account.username === currentUsername ? 'Akses Anda diperbarui dan sesi perangkat lain dicabut.' : 'Akses diperbarui dan sesi akun tersebut dicabut.');
    } catch(e) {
      // Restore the persisted values so a rejected change (e.g. last owner) does not stay toggled on screen.
      const base = originals[account.id];
      if (base) { account.enabled = base.enabled; account.role = base.role; }
      error = e instanceof Error ? e.message : 'Akses tidak dapat diperbarui.';
    } finally { busy = false; }
  }
</script>
<header class="page-head">
  <div><h2>Akses Akun</h2><p>Editor menyimpan draf. Penerbit meninjau dan menerbitkan. Pemilik juga mengatur akun. Tidak ada pendaftaran publik.</p></div>
</header>
{#if error}<p class="notice-error page-notice" role="alert">{error}</p>{/if}
<div class="atlas-section" role="heading" aria-level="3">Akun Baru</div>
<form class="page-row" onsubmit={create}><fieldset disabled={busy}>
  <div class="form-grid">
    <label class="field">Nama Akun<input bind:value={username} maxlength="150" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" required></label>
    <label class="field">Nama Lengkap<input bind:value={name} maxlength="150" autocomplete="name"></label>
    <label class="field">Peran<Select label="Peran" bind:value={role} options={ROLES}/></label>
    <label class="field">Kata Sandi Awal<input type="password" bind:value={password} minlength="15" maxlength="1024" autocomplete="new-password" required></label>
  </div>
  <div class="page-row__actions"><button type="submit" class="btn-primary">Buat Akun</button></div>
</fieldset></form>
<div class="atlas-section" role="heading" aria-level="3">Akun Terdaftar<span>{accounts.length} Akun</span></div>
{#each accounts as account (account.id)}
  {@const dirty = isDirty(account)}
  <form class="page-row" onsubmit={event => update(event, account)}><fieldset disabled={busy}>
    <div class="page-row__head">
      <div><h3>{account.username}{#if account.username === currentUsername} <span class="badge badge--draf">Anda</span>{/if}</h3><p class="page-row__meta">{account.name || 'Tanpa Nama Lengkap'} · Terakhir masuk: {moment(account.last_login)}</p></div>
      <label class="switch-row"><span class="ctl-switch"><input type="checkbox" bind:checked={account.enabled}><span class="ctl-switch__track" aria-hidden="true"><span class="ctl-switch__thumb"></span></span></span>Akses Aktif</label>
    </div>
    <div class="form-grid">
      <label class="field">Peran<Select label="Peran" bind:value={account.role} options={ROLES}/></label>
      <label class="field">Kata Sandi Baru (Opsional)<input type="password" bind:value={passwords[account.id]} minlength="15" maxlength="1024" autocomplete="new-password"></label>
      <label class="field wide">Alasan Perubahan<input bind:value={reasons[account.id]} maxlength="3000" required={dirty}></label>
    </div>
    <div class="page-row__actions"><p class="hint">Perubahan akses mencabut sesi akun ini. Pemilik aktif terakhir harus tetap tersedia.</p><button type="submit" class="btn-ghost" disabled={!dirty}>Simpan Perubahan</button></div>
  </fieldset></form>
{/each}
