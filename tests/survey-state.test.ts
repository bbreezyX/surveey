import { expect, it, vi } from 'vitest';
import { createSurveyState } from '../src/public/state/survey.svelte';
import { parseSurveyCollection } from '../src/public/data/parse';
const dataset = () => ({ points: parseSurveyCollection({ type: 'FeatureCollection', features: [
  { type: 'Feature', geometry: { type: 'Point', coordinates: [103.5, -1.5] }, properties: { Nomor: 'KOTA JAMBI-DANAU TELUK-TANJUNG RADEN-001', Duplikat: true } },
  { type: 'Feature', geometry: { type: 'Point', coordinates: [103.6, -1.5] }, properties: { Nomor: 'KOTA JAMBI-DANAU TELUK-TANJUNG RADEN-002' } },
] }), boundaries: [], dissolved: { type: 'FeatureCollection' as const, features: [] } });
it('keeps map point identities when a progress refresh does not change verification flags', () => {
  const state = createSurveyState(dataset()), initial = state.points;
  state.progress = new Map();
  expect(state.points).toBe(initial);
  state.progress = new Map([[initial[0].nomor, 1]]);
  const verified = state.points;
  expect(verified[0].duplikat).toBe(false);
  expect(verified[1]).toBe(initial[1]);
  state.progress = new Map([[initial[0].nomor, 4]]);
  expect(state.points).toBe(verified);
  state.progress = new Map();
  expect(state.points[0].duplikat).toBe(true);
});

it('uses fresh coordinates and labels when the published dataset changes', () => {
  const initial = dataset(), state = createSurveyState(initial);
  state.progress = new Map([[initial.points[0].nomor, 1]]);
  const previous = state.points;
  const next = dataset();
  next.points[0] = { ...next.points[0], lonNum: 104, alamat: 'Lokasi diperbarui' };
  state.replaceDataset(next);
  expect(state.points).not.toBe(previous);
  expect(state.points[0]).toMatchObject({ lonNum: 104, alamat: 'Lokasi diperbarui', duplikat: false });
  state.progress = null;
  expect(state.points[0]).toBe(next.points[0]);
});

it('starts on Sebaran and drops a status filter the progress view cannot show', () => {
  const state = createSurveyState(dataset(), { lastReport: null });
  expect(state.listMode).toBe('sebaran');
  state.openRegion('Kota Jambi', 'duplikat');
  state.listMode = 'progres';
  expect(state.statusFilter).toBeNull();
});

it('opens on the basemap this phone chose, Esri by default', () => {
  expect(createSurveyState(dataset()).layers).toMatchObject({ google: false, esri: true });
  expect(createSurveyState(dataset(), { basemap: 'google' }).layers).toMatchObject({ google: true, esri: false });
});

it('keeps the report a crew just sent as this phone\'s last report', () => {
  const state = createSurveyState(dataset());
  state.markReported('KOTA JAMBI-DANAU TELUK-TANJUNG RADEN-002', 3);
  expect(state.lastReport).toMatchObject({ nomor: 'KOTA JAMBI-DANAU TELUK-TANJUNG RADEN-002', stage: 3 });
});

it('marks the progress feed as failed only until stages are shown', () => {
  const state = createSurveyState(dataset());
  state.progressFailed = true;
  expect(state.progressFailed).toBe(true);
  state.progress = new Map([['KOTA JAMBI-DANAU TELUK-TANJUNG RADEN-002', 2]]);
  expect(state.progressFailed).toBe(false);
  // A later miss keeps the stages already shown instead of the message.
  state.progressFailed = true;
  expect(state.progressFailed).toBe(false);
});

it('opens the waiting group first only for the kabupaten the waiting-reports line opened', () => {
  const state = createSurveyState(dataset());
  state.listMode = 'progres';
  state.openRegion('Kota Jambi');
  state.showWaitingFirst();
  expect(state.waitingFirst).toBe(true);
  state.openRegion(null);
  expect(state.waitingFirst).toBe(false);
});

it('reopens the list at half-height on close and reveals the closed point regardless of how detail opened', () => {
  const data = dataset();
  data.points[0] = { ...data.points[0], kabupaten: 'Kota Jambi' };
  data.points[1] = { ...data.points[1], kabupaten: 'Kab. Batanghari' };
  const state = createSurveyState(data), nomor = state.points[0].nomor;
  state.sheetSnap = 'full';
  state.select(nomor);
  expect(state.sheetSnap).toBe('closed');
  state.closeDetail();
  expect(state.sheetSnap).toBe('half');
  expect(state.activeRegion).toBe('Kota Jambi');
  expect(state.recentNomor).toBe(nomor);

  // Opening directly from the map while in another region or on province view returns to half-height at that point's kabupaten.
  state.openRegion('Kab. Batanghari');
  state.sheetSnap = 'closed';
  state.select(nomor);
  state.closeDetail();
  expect(state.sheetSnap).toBe('half');
  expect(state.activeRegion).toBe('Kota Jambi');
  expect(state.recentNomor).toBe(nomor);

  state.openRegion(null);
  state.sheetSnap = 'closed';
  state.select(nomor);
  state.closeDetail();
  expect(state.sheetSnap).toBe('half');
  expect(state.activeRegion).toBe('Kota Jambi');
  expect(state.recentNomor).toBe(nomor);

  state.openLinked(nomor);
  state.closeDetail();
  expect(state.sheetSnap).toBe('half');
  expect(state.activeRegion).toBe('Kota Jambi');
  expect(state.recentNomor).toBe(nomor);
});

it('dismisses detail directly into the requested sheet height while marking recent', () => {
  vi.useFakeTimers();
  try {
    const state = createSurveyState(dataset()), nomor = state.points[1].nomor;
    state.select(nomor);
    state.dismissDetailToSheet('half');
    expect(state.selectedNomor).toBeNull();
    expect(state.sheetSnap).toBe('half');
    expect(state.recentNomor).toBe(nomor);

    // Recent highlight clears automatically after its cue fades.
    vi.advanceTimersByTime(2250);
    expect(state.recentNomor).toBeNull();

    // Selecting another unit also clears an active recent mark immediately.
    state.select(nomor);
    state.closeDetail();
    expect(state.recentNomor).toBe(nomor);
    state.select(state.points[0].nomor);
    expect(state.recentNomor).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it('keeps desktop closeDetail quiet without marking recent or opening the mobile sheet', () => {
  const original = globalThis.window;
  Object.defineProperty(globalThis, 'window', { value: { innerWidth: 1280 }, configurable: true });
  try {
    const state = createSurveyState(dataset()), nomor = state.points[0].nomor;
    state.select(nomor);
    state.closeDetail();
    expect(state.sheetSnap).toBe('closed');
    expect(state.recentNomor).toBeNull();
  } finally {
    if (original === undefined) delete (globalThis as { window?: Window }).window;
    else Object.defineProperty(globalThis, 'window', { value: original, configurable: true });
  }
});
