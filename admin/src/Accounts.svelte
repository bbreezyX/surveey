<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type Account } from './api';
  import Select from './Select.svelte';
  const ROLES = [{ value: 'editor', label: 'Editor' }, { value: 'publisher', label: 'Penerbit' }, { value: 'owner', label: 'Pemilik' }];
  let { onMessage }: { onMessage: (text: string) => void } = $props();
  let accounts = $state<Account[]>([]); let username = $state(''); let name = $state(''); let role = $state('editor'); let password = $state('');
  let reasons = $state<Record<number, string>>({}); let passwords = $state<Record<number, string>>({}); let error = $state(''); let busy = $state(false);
  async function load() { try { accounts = (await api<{items: Account[]}>('accounts')).items; } catch(e) { error = e instanceof Error ? e.message : 'Gagal memuat akun.'; } }
  onMount(load);
  async function create(event: SubmitEvent) { event.preventDefault(); busy = true; error = ''; try {
    await api('accounts', 'POST', { username, name, role, password }); username = ''; name = ''; password = ''; await load(); onMessage('Akun yang disetujui telah dibuat.');
  } catch(e) { error = e instanceof Error ? e.message : 'Akun tidak dapat dibuat.'; } finally { busy = false; } }
  async function update(event: SubmitEvent, account: Account) { event.preventDefault(); busy = true; error = ''; try {
    await api(`accounts/${account.id}`, 'PATCH', { enabled: account.enabled, role: account.role, password: passwords[account.id] || '', reason: reasons[account.id] || '' });
    passwords[account.id] = ''; reasons[account.id] = ''; await load(); onMessage('Akses diperbarui dan sesi akun tersebut dicabut.');
  } catch(e) { error = e instanceof Error ? e.message : 'Akses tidak dapat diperbarui.'; } finally { busy = false; } }
</script>
<header class="page-head">
  <div><h2>Akses akun</h2><p>Editor menyimpan draf. Penerbit meninjau dan menerbitkan. Pemilik juga mengatur akun. Tidak ada pendaftaran publik.</p></div>
</header>
{#if error}<p class="notice-error page-notice" role="alert">{error}</p>{/if}
<div class="atlas-section" role="heading" aria-level="3">Akun baru</div>
<form class="page-row" onsubmit={create}><fieldset disabled={busy}>
  <div class="form-grid">
    <label class="field">Nama akun<input bind:value={username} maxlength="150" autocomplete="off" required></label>
    <label class="field">Nama lengkap<input bind:value={name} maxlength="150"></label>
    <label class="field">Peran<Select label="Peran" bind:value={role} options={ROLES}/></label>
    <label class="field">Kata sandi awal<input type="password" bind:value={password} minlength="15" maxlength="1024" autocomplete="new-password" required></label>
  </div>
  <div class="page-row__actions"><button class="btn-primary">Buat akun</button></div>
</fieldset></form>
<div class="atlas-section" role="heading" aria-level="3">Akun terdaftar<span>{accounts.length} akun</span></div>
{#each accounts as account}
  <form class="page-row" onsubmit={event => update(event, account)}><fieldset disabled={busy}>
    <div class="page-row__head">
      <div><h3>{account.username}</h3><p class="page-row__meta">{account.name || 'Tanpa nama lengkap'}</p></div>
      <label class="switch-row"><span class="ctl-switch"><input type="checkbox" bind:checked={account.enabled}><span class="ctl-switch__track" aria-hidden="true"><span class="ctl-switch__thumb"></span></span></span>Akses aktif</label>
    </div>
    <div class="form-grid">
      <label class="field">Peran<Select label="Peran" bind:value={account.role} options={ROLES}/></label>
      <label class="field">Kata sandi baru (opsional)<input type="password" bind:value={passwords[account.id]} minlength="15" maxlength="1024" autocomplete="new-password"></label>
      <label class="field wide">Alasan perubahan<input bind:value={reasons[account.id]} maxlength="3000" required></label>
    </div>
    <div class="page-row__actions"><p class="hint">Perubahan akses mencabut semua sesi akun ini. Pemilik aktif terakhir harus tetap tersedia.</p><button class="btn-ghost">Simpan perubahan</button></div>
  </fieldset></form>
{/each}
