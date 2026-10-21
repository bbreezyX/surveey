<script lang="ts">
  import type { SurveyPoint, SurveyDataset } from '../../shared/survey/types';
  import { legacyPhotoUrl } from '../../shared/survey/media';
  import { directionsUrl } from '../../shared/survey/coordinates';
  import { progressReportUrl } from '../../shared/survey/report';
  import { BUILD_STAGES, stageDone, stageSummary } from '../../shared/survey/progress';
  import { STATUS_LABEL } from '../../shared/survey/status';
  import { regionKey } from '../data/regions';
  import Shape from './Shape.svelte';
  import Icon from './Icon.svelte';
  // stage is null until esdm.cloud has answered, so a slow or failed fetch shows nothing rather than "Belum dimulai".
  let { point, dataset, stage = null }: { point: SurveyPoint; dataset: SurveyDataset; stage?: number | null } = $props();
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
    <!-- Code and region read as one line; the coordinate moves out of the meta list into a compact badge that wraps under them when the region name is long. -->
    <p class="feature-popup__eyebrow"><span class="feature-popup__id">Titik {point.display.code} · {point.kabupaten}</span><span class="feature-popup__coord" title={point.belum ? 'Koordinat perkiraan' : 'Koordinat'}>{#if point.belum}<span aria-hidden="true">≈ </span><span class="visually-hidden">Koordinat perkiraan </span>{:else}<span class="visually-hidden">Koordinat </span>{/if}{point.koordinat}</span></p>
    <h3 class="feature-popup__title">{point.display.primary}</h3>
    <dl class="feature-popup__meta">
      {#each [{ label: 'Alamat', value: point.alamat }, { label: 'Dokumentasi', value: point.tanggal }, { label: 'Keterangan', value: point.display.showsKeterangan ? '' : point.keterangan }] as row (row.label)}
        {#if row.value}<div class="feature-popup__meta-row"><div class="meta-icon" aria-hidden="true"><Icon name={row.label === 'Alamat' ? 'location' : row.label.startsWith('Koordinat') ? 'coordinate' : row.label === 'Dokumentasi' ? 'calendar' : 'info'} size={16}/></div><div><dt>{row.label}</dt><dd>{row.value}</dd></div></div>{/if}
      {/each}
    </dl>
    {#if stage !== null && !point.cadangan}
      <!-- The whole block opens the point on esdm.cloud/lapangan, which lists its stages and every report
           behind them, so a reader who wonders "since when?" reaches the evidence in one tap. -->
      <a class="feature-popup__progress" class:is-started={stage > 0} class:is-complete={stageDone(stage)} href={progressReportUrl(point.nomor)} target="_blank" rel="noopener" title="Buka riwayat tahap titik ini di esdm.cloud">
        <p class="feature-popup__progress-head"><span>Progres pembangunan</span><strong>{stageSummary(stage)}<span class="feature-popup__progress-count" aria-hidden="true">{Math.min(stage, BUILD_STAGES.length)}/{BUILD_STAGES.length}</span><span class="feature-popup__progress-go" aria-hidden="true"></span></strong></p>
        <!-- One bar segment per stage with its name beneath: the fill reads at a glance, the label says which step it is. -->
        <ol class="feature-popup__stages">
          {#each BUILD_STAGES as name, index (name)}
            <li class:is-done={index < stage} class:is-next={index === stage}>{name}<span class="visually-hidden">{index < stage ? ' selesai' : ' belum'}</span></li>
          {/each}
        </ol>
      </a>
    {/if}
    <div class="feature-popup__rule"></div>
  </div>
  <!-- Cadangan points are outside the allocation, so they have no construction to report. The row sits outside the body so it can stay pinned to the foot of the whole card on phones. -->
  {#if !point.belum || !point.cadangan}<div class="feature-popup__actions">{#if !point.belum}<a class="feature-popup__route" href={directionsUrl(point)} target="_blank" rel="noopener noreferrer" title="Buka Google Maps: rute dari posisi Anda ke titik ini"><span class="feature-popup__route-icon"><Icon name="route" size={18}/></span><span class="feature-popup__route-text"><strong>{point.cadangan ? 'Buka di Google Maps' : 'Google Maps'}</strong></span><span class="feature-popup__route-ext"><Icon name="external" size={12}/></span></a>{/if}{#if !point.cadangan}<a class="feature-popup__report" href={progressReportUrl(point.nomor)} target="_blank" rel="noopener" title="Lapor progres galian, cor, tiang, atau lampu untuk titik ini" aria-label="Lapor progres titik ini"><Icon name="camera" size={16}/><span>Lapor</span></a>{/if}</div>{/if}
</div>
