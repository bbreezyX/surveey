import { expect, it } from 'vitest';
import { readBasemap, readLastReport, recallWorkMemory, rememberBasemap, REPORT_MAX_AGE_MS } from '../src/public/state/work-memory';
it('starts on Esri unless this phone chose Google', () => {
  expect(readBasemap('google')).toBe('google');
  expect(readBasemap('esri')).toBe('esri');
  expect(readBasemap(null)).toBe('esri');
  expect(readBasemap('Google')).toBe('esri');
});
it('keeps the picked basemap in sessionStorage and ignores stale localStorage picks', () => {
  const prevLocal = globalThis.localStorage, prevSession = globalThis.sessionStorage;
  const makeStorage = (initial: Record<string, string> = {}) => {
    const map = new Map(Object.entries(initial));
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v); },
    } as Storage;
  };
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: makeStorage({ 'puts.basemap': 'google' }) });
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: makeStorage() });
    expect(recallWorkMemory().basemap).toBe('esri');
    rememberBasemap('google');
    expect(recallWorkMemory().basemap).toBe('google');
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: prevLocal });
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: prevSession });
  }
});
const saved = JSON.stringify({ at: 1_000, nomor: 'A-001', stage: 2 });
it('remembers the report this phone sent for a week', () => {
  expect(readLastReport(saved, 1_000 + REPORT_MAX_AGE_MS - 1)).toEqual({ at: 1_000, nomor: 'A-001', stage: 2 });
  expect(readLastReport(saved, 1_000 + REPORT_MAX_AGE_MS + 1)).toBeNull();
});
it('ignores missing, malformed or tampered reports', () => {
  expect(readLastReport(null, 2_000)).toBeNull();
  expect(readLastReport('{oops', 2_000)).toBeNull();
  expect(readLastReport(JSON.stringify({ at: 5_000, nomor: 'A-001', stage: 2 }), 2_000)).toBeNull();
  expect(readLastReport(JSON.stringify({ at: 1_000, nomor: '', stage: 2 }), 2_000)).toBeNull();
  expect(readLastReport(JSON.stringify({ at: 1_000, nomor: 'A-001', stage: 5 }), 2_000)).toBeNull();
  expect(readLastReport(JSON.stringify({ at: 1_000, nomor: 'A-001', stage: 1.5 }), 2_000)).toBeNull();
});
