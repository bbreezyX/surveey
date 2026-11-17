// What a crew's phone keeps for the progress view, in localStorage beside the open detail (detail-memory.ts):
// the last report this phone sent from esdm.cloud/lapangan. The list view is not kept: every visit opens on
// Sebaran, the map's main view, since a Progres view coming back on its own surprised readers. The progress feed carries no reporter names, so "mine" can only mean
// "from this phone". Storage can be blocked or wiped; every read falls back to a fresh start.
// The basemap chosen in the layer panel is kept in sessionStorage instead of localStorage, so a Google
// pick survives a reload in the same tab while every new visit starts back on free Esri tiles.
export type ListMode = 'sebaran' | 'progres';
export type Basemap = 'google' | 'esri';
export interface LastReport { at: number; nomor: string; stage: number }
export interface WorkMemory { lastReport?: LastReport | null; basemap?: Basemap }
const REPORT_KEY = 'puts.last-report', BASEMAP_KEY = 'puts.basemap';
// Esri unless Google was picked by hand in this tab: every Google tile is billed past the free tier, Esri's are not.
export function readBasemap(raw: string | null): Basemap {
  return raw === 'google' ? 'google' : 'esri';
}
// A week covers a crew's round of reports; an older one says nothing about today's work.
export const REPORT_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
export function readLastReport(raw: string | null, now: number): LastReport | null {
  let saved: { at?: unknown; nomor?: unknown; stage?: unknown } | null;
  try { saved = JSON.parse(raw ?? 'null'); } catch { return null; }
  if (!saved || typeof saved.at !== 'number' || saved.at > now || now - saved.at > REPORT_MAX_AGE_MS) return null;
  if (typeof saved.nomor !== 'string' || !saved.nomor || !Number.isInteger(saved.stage) || (saved.stage as number) < 1 || (saved.stage as number) > 4) return null;
  return { at: saved.at, nomor: saved.nomor, stage: saved.stage as number };
}
function read(storage: Storage | undefined, key: string): string | null {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}
function write(storage: Storage | undefined, key: string, value: string) {
  try { storage?.setItem(key, value); } catch { /* Storage blocked: the next visit starts fresh. */ }
}
export function recallWorkMemory(): WorkMemory {
  return {
    lastReport: readLastReport(read(globalThis.localStorage, REPORT_KEY), Date.now()),
    basemap: readBasemap(read(globalThis.sessionStorage, BASEMAP_KEY)),
  };
}
export const rememberLastReport = (report: LastReport) => write(globalThis.localStorage, REPORT_KEY, JSON.stringify(report));
export const rememberBasemap = (basemap: Basemap) => write(globalThis.sessionStorage, BASEMAP_KEY, basemap);
