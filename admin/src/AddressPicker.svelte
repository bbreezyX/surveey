<script module lang="ts">
  import { api } from './api';
  type Wilayah = { nama: string; kecamatan: { nama: string; desa: string[] }[] }[];
  // One request per page load, shared by every picker; a failure is
  // forgotten so the next picker tries again.
  let request: Promise<Wilayah> | undefined;
  function load() {
    request ??= api<Wilayah>('wilayah').catch(error => { request = undefined; throw error; });
    return request;
  }
  // "Desa Tempino" still finds the official "Kel. Tempino": some imported
  // addresses carry the wrong prefix, and the picker should not go blank on them.
  const bare = (name: string) => name.replace(/^(Desa|Kel\.)\s+/, '');
</script>
<script lang="ts">
  import Select from './Select.svelte';
  // Cascading kab/kota → kecamatan → desa/kel picker that writes the address
  // in the form the existing data uses: "Desa X, Kecamatan Y, Kabupaten Z".
  // The text stays editable; the picker only overwrites it once a desa is chosen.
  let { value = $bindable() }: { value: string } = $props();
  let tree = $state<Wilayah>([]), failed = $state(false);
  let kab = $state(''), kec = $state(''), desa = $state('');
  // The address this picker last read or wrote. Picking only a kabupaten
  // leaves the text unchanged, so re-reading on every change would undo it.
  let seen: string | undefined;
  load().then(result => tree = result, () => failed = true);

  let kecamatan = $derived(tree.find(item => item.nama === kab)?.kecamatan ?? []);
  let villages = $derived(kecamatan.find(item => item.nama === kec)?.desa ?? []);

  $effect(() => {
    if (!tree.length || value === seen) return;
    seen = value;
    const [d = '', k = '', b = ''] = value.split(',').map(part => part.trim());
    const kabItem = tree.find(item => item.nama === b);
    const kecItem = kabItem?.kecamatan.find(item => `Kecamatan ${item.nama}` === k);
    kab = kabItem?.nama ?? ''; kec = kecItem?.nama ?? '';
    desa = kecItem?.desa.find(item => bare(item) === bare(d)) ?? '';
  });

  function chooseDesa(next: string) {
    if (!next) return;
    value = seen = `${next}, Kecamatan ${kec}, ${kab}`;
  }
</script>
{#if failed}<p class="hint">Daftar wilayah gagal dimuat. Alamat tetap dapat diketik.</p>
{:else}
  <div class="pair">
    <label class="field">Kabupaten/kota<Select label="Kabupaten/kota" bind:value={kab} onchange={() => { kec = ''; desa = ''; }}
      options={[{ value: '', label: 'Pilih kabupaten/kota' }, ...tree.map(item => ({ value: item.nama, label: item.nama }))]}/></label>
    <label class="field">Kecamatan<Select label="Kecamatan" bind:value={kec} onchange={() => desa = ''}
      options={[{ value: '', label: 'Pilih kecamatan' }, ...kecamatan.map(item => ({ value: item.nama, label: item.nama }))]}/></label>
  </div>
  <label class="field">Desa/kelurahan<Select label="Desa/kelurahan" bind:value={desa} onchange={chooseDesa}
    options={[{ value: '', label: 'Pilih desa/kelurahan' }, ...villages.map(item => ({ value: item, label: item }))]}/></label>
{/if}
<style>
  /* Long names ("Kabupaten Tanjung Jabung Timur") would otherwise widen the
     grid cell past the sheet on phones; the select already ellipsizes. */
  .pair > .field { min-width: 0; }
</style>
