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
