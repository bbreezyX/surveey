<script lang="ts">
  import type { SurveyPoint, SurveyDataset } from '../../shared/survey/types';
  import { legacyPhotoUrl } from '../../shared/survey/media';
  import { directionsUrl } from '../../shared/survey/coordinates';
  import { STATUS_LABEL } from '../../shared/survey/status';
  import { regionKey } from '../data/regions';
  import Shape from './Shape.svelte';
  import Icon from './Icon.svelte';
  let { point, dataset }: { point: SurveyPoint; dataset: SurveyDataset } = $props();
  const photo = $derived(legacyPhotoUrl(point.photo));
  const kind = $derived(point.belum ? 'belum' : point.duplikat ? 'duplikat' : point.cadangan ? 'cadangan' : null);
  const sharedCoordinateCount = $derived(dataset.points.filter(p => p.latNum.toFixed(6) === point.latNum.toFixed(6) && p.lonNum.toFixed(6) === point.lonNum.toFixed(6)).length);
  const note = $derived(point.catatan && (point.belum || point.duplikat) ? point.catatan : point.belum ? 'Pin perkiraan. Lokasi pasti ditentukan di lapangan bersama RT.' : point.duplikat ? sharedCoordinateCount > 1 ? `${sharedCoordinateCount} unit di satu koordinat. Cek posisi tiap tiang di lapangan.` : 'Cek posisi tiang di lapangan.' : point.cadangan ? 'Di luar jatah. Dipasang hanya jika ada titik lain yang batal.' : '');
  const region = $derived(dataset.boundaries.find(region => regionKey(String(region.properties.KABUPATEN_)) === regionKey(point.kabupaten)));
</script>
<div class="feature-popup" class:is-cadangan={point.cadangan} class:is-duplikat={point.duplikat} class:is-belum={point.belum}>
  {#if photo}
    <a class="feature-popup__media" href={photo} target="_blank" rel="noopener" aria-label={`Buka foto lokasi ${point.nomor} di tab baru`}>
      <img src={photo} alt={`Foto lokasi ${point.nomor}`} decoding="async"/>
      <span class="feature-popup__media-badge"><Icon name="external" size={16}/><span>Lihat foto</span></span>
      <span class="popup-inset"><Shape {region} points={dataset.points.filter(p => p.kabupaten === point.kabupaten)} width={70} height={52} selected={point.nomor} inset/></span>
    </a>
  {/if}
  {#if kind}<div class={`feature-popup__note feature-popup__note--${kind}`} role="note"><span class="feature-popup__note-mark" aria-hidden="true">{kind === 'belum' ? '?' : kind === 'duplikat' ? '!' : ''}</span><p><strong class="feature-popup__note-title">{STATUS_LABEL[kind].legend}</strong> {note}</p></div>{/if}
  <div class="feature-popup__body">
    <p class="feature-popup__eyebrow">Titik {point.display.code} · {point.kabupaten}</p>
    <h3 class="feature-popup__title">{point.display.primary}</h3>
    <dl class="feature-popup__meta">
      {#each [{ label: 'Alamat', value: point.alamat }, { label: point.belum ? 'Koordinat perkiraan' : 'Koordinat', value: point.koordinat }, { label: 'Dokumentasi', value: point.tanggal }, { label: 'Keterangan', value: point.display.showsKeterangan ? '' : point.keterangan }] as row (row.label)}
        {#if row.value}<div class="feature-popup__meta-row"><div class="meta-icon" aria-hidden="true"><Icon name={row.label === 'Alamat' ? 'location' : row.label.startsWith('Koordinat') ? 'coordinate' : row.label === 'Dokumentasi' ? 'calendar' : 'info'} size={16}/></div><div><dt>{row.label}</dt><dd>{row.value}</dd></div></div>{/if}
      {/each}
    </dl>
    <div class="feature-popup__rule"></div>
    {#if !point.belum}<div class="feature-popup__actions"><a class="feature-popup__route" href={directionsUrl(point)} target="_blank" rel="noopener noreferrer" title="Buka Google Maps: rute dari posisi Anda ke titik ini"><span class="feature-popup__route-icon"><Icon name="route" size={18}/></span><span class="feature-popup__route-text"><strong>Rute ke titik ini</strong><small>Buka di Google Maps</small></span><span class="feature-popup__route-ext"><Icon name="external" size={12}/></span></a></div>{/if}
  </div>
</div>
