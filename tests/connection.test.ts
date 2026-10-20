import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConnection, reachable } from '../src/public/state/connection.svelte';

let stop: (() => void) | undefined;
let documentEvents: EventTarget & { visibilityState: string };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] });
  const events = new EventTarget();
  documentEvents = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('document', documentEvents);
  vi.stubGlobal('navigator', { onLine: true, connection: { effectiveType: '2g', downlink: 0.05, rtt: 2000 } });
  vi.stubGlobal('addEventListener', events.addEventListener.bind(events));
  vi.stubGlobal('removeEventListener', events.removeEventListener.bind(events));
});
afterEach(() => { stop?.(); stop = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
function connected(probe: () => Promise<boolean>) {
  const connection = createConnection(probe); stop = connection.start(); return connection;
}

describe('connection warning', () => {
  it('never blames fast connectivity for imagery that remains pending for a minute, even with a stale 2g estimate', async () => {
    const probe = vi.fn(async () => { await delay(30); return true; });
    const connection = connected(probe); connection.tilesSlow = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(probe.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(connection.slow).toBe(false); expect(connection.offline).toBe(false);
  });
  it('requires repeated independent slow responses before reporting a genuinely high-latency connection', async () => {
    const probe = vi.fn(async () => { await delay(3200); return true; });
    const connection = connected(probe); connection.tilesSlow = true;
    await vi.advanceTimersByTimeAsync(11_401); expect(connection.slow).toBe(false);
    await vi.advanceTimersByTimeAsync(8200); expect(connection.slow).toBe(true);
    expect(probe).toHaveBeenCalledTimes(3); expect(connection.offline).toBe(false);
  });
  it('clears a confirmed warning after one quick response while imagery is still pending', async () => {
    let latency = 3200;
    const connection = connected(async () => { await delay(latency); return true; }); connection.tilesSlow = true;
    await vi.advanceTimersByTimeAsync(19_601); expect(connection.slow).toBe(true);
    latency = 30; await vi.advanceTimersByTimeAsync(5030);
    expect(connection.tilesSlow).toBe(true); expect(connection.slow).toBe(false);
  });
  it('does not retain an in-flight slow sample after the old imagery is no longer needed', async () => {
    const connection = connected(async () => { await delay(3200); return true; }); connection.tilesSlow = true;
    await vi.advanceTimersByTimeAsync(1000); connection.tilesSlow = false;
    await vi.advanceTimersByTimeAsync(2500);
    expect(connection.slow).toBe(false); expect(connection.offline).toBe(false);
    connection.tilesSlow = true; await vi.advanceTimersByTimeAsync(11_401);
    expect(connection.slow).toBe(false);
  });
  it('does not turn an unsuccessful quality sample into an offline verdict', async () => {
    const connection = connected(async () => { await delay(8000); return false; }); connection.tilesSlow = true;
    await vi.advanceTimersByTimeAsync(40_000);
    expect(connection.slow).toBe(false); expect(connection.offline).toBe(false);
  });
  it('stops quality probes when the pending resources settle', async () => {
    const probe = vi.fn(async () => true);
    const connection = connected(probe); connection.tilesSlow = true;
    await vi.advanceTimersByTimeAsync(1); connection.tilesSlow = false;
    const calls = probe.mock.calls.length; await vi.advanceTimersByTimeAsync(60_000);
    expect(probe).toHaveBeenCalledTimes(calls); expect(connection.slow).toBe(false);
  });
  it('resumes a pending connection check after the tab becomes visible', async () => {
    documentEvents.visibilityState = 'hidden';
    const probe = vi.fn(async () => { await delay(3200); return true; });
    const connection = connected(probe); connection.tilesSlow = true;
    await vi.advanceTimersByTimeAsync(25_000); expect(probe).not.toHaveBeenCalled();
    documentEvents.visibilityState = 'visible'; documentEvents.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(19_601); expect(connection.slow).toBe(true);
  });
  it('still detects a real loss of reachability after failed resource requests', async () => {
    const connection = connected(async () => false); connection.suspect();
    await vi.advanceTimersByTimeAsync(1); expect(connection.offline).toBe(true); expect(connection.slow).toBe(false);
  });
});

describe('low bandwidth with fast response headers', () => {
  it('keeps a fast actual transfer healthy, regardless of a stale browser connection estimate', async () => {
    const fetch = vi.fn(async () => { await delay(30); return new Response(new Uint8Array(9351)); });
    vi.stubGlobal('fetch', fetch);
    const sample = reachable(); await vi.advanceTimersByTimeAsync(100);
    expect(await sample).toEqual({ reachable: true, slow: false });
    expect(fetch.mock.calls.length).toBe(1);
  });
  it('detects slow transfers even when tiny HEAD requests would respond quickly', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
      await delay(30);
      if (options.method === 'HEAD') return new Response(null);
      // About 9 KB at 4.5 KB/s. Response headers arrive quickly, while map-sized files take much longer.
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        for (let index = 0; index < 5; index++) setTimeout(() => {
          controller.enqueue(new Uint8Array(1870)); if (index === 4) controller.close();
        }, 400 * (index + 1));
      } }));
    }));
    const connection = createConnection(); stop = connection.start(); connection.tilesSlow = true;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(connection.offline).toBe(false); expect(connection.slow).toBe(true);
  });
  it('waits for the response body so bandwidth is part of the sample', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
      await delay(30);
      return new Response(options.method === 'HEAD' ? null : new ReadableStream<Uint8Array>({ start(controller) {
        setTimeout(() => { controller.enqueue(new Uint8Array(9351)); controller.close(); }, 2000);
      } }));
    }));
    let completed = false;
    const sample = reachable().then(result => { completed = true; return result; });
    await vi.advanceTimersByTimeAsync(100); expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(2000); expect(await sample).toMatchObject({ reachable: true, slow: true });
  });
  it('still detects an extremely slow body that cannot finish the bounded sample before its timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
      await delay(30);
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        options.signal!.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
      } }));
    }));
    const connection = createConnection(); stop = connection.start(); connection.tilesSlow = true;
    await vi.advanceTimersByTimeAsync(35_000);
    expect(connection.offline).toBe(false); expect(connection.slow).toBe(true);
  });
});
