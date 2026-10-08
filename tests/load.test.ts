import { it, expect, vi } from 'vitest';
import { loadSurveyDataset } from '../src/public/data/load';
it('turns a stalled request into a retryable error and cancels its other requests', async () => {
  vi.useFakeTimers(); const parent = new AbortController(); let failure: unknown; let aborted = 0;
  vi.stubGlobal('fetch', vi.fn((_url: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => { options.signal.addEventListener('abort', () => { aborted++; reject(options.signal.reason); }, { once: true }); })));
  const pending = loadSurveyDataset(parent.signal).catch(error => { failure = error; });
  try { await vi.advanceTimersByTimeAsync(20_001); expect(failure).toBeInstanceOf(Error); expect(String(failure)).toMatch(/terlalu lama/); expect(aborted).toBe(3); }
  finally { parent.abort(); await pending; vi.unstubAllGlobals(); vi.useRealTimers(); }
});
