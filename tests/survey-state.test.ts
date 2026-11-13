import { expect, it } from 'vitest';
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

it('starts from what this phone remembered and drops a status filter the progress view cannot show', () => {
  const state = createSurveyState(dataset(), { listMode: 'sebaran', lastReport: null });
  state.openRegion('Kota Jambi', 'duplikat');
  state.listMode = 'progres';
  expect(state.statusFilter).toBeNull();
});

it('keeps the report a crew just sent as this phone\'s last report', () => {
  const state = createSurveyState(dataset());
  state.markReported('KOTA JAMBI-DANAU TELUK-TANJUNG RADEN-002', 3);
  expect(state.lastReport).toMatchObject({ nomor: 'KOTA JAMBI-DANAU TELUK-TANJUNG RADEN-002', stage: 3 });
});

it('opens the waiting group first only for the kabupaten the waiting-reports line opened', () => {
  const state = createSurveyState(dataset(), { listMode: 'progres', lastReport: null });
  state.openRegion('Kota Jambi');
  state.showWaitingFirst();
  expect(state.waitingFirst).toBe(true);
  state.openRegion(null);
  expect(state.waitingFirst).toBe(false);
});
