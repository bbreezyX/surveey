// What a crew's phone keeps for the progress view, in localStorage beside the open detail (detail-memory.ts):
// the last report this phone sent from esdm.cloud/lapangan. The list view is not kept: every visit opens on
// Sebaran, the map's main view, since a Progres view coming back on its own surprised readers. The progress feed carries no reporter names, so "mine" can only mean
// "from this phone". Storage can be blocked or wiped; every read falls back to a fresh start.
export type ListMode = 'sebaran' | 'progres';
export interface LastReport { at: number; nomor: string; stage: number }
export interface WorkMemory { lastReport?: LastReport | null }
const REPORT_KEY = 'puts.last-report';
// A week covers a crew's round of reports; an older one says nothing about today's work.
export const REPORT_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
export function readLastReport(raw: string | null, now: number): LastReport | null {
  let saved: { at?: unknown; nomor?: unknown; stage?: unknown } | null;
  try { saved = JSON.parse(raw ?? 'null'); } catch { return null; }
  if (!saved || typeof saved.at !== 'number' || saved.at > now || now - saved.at > REPORT_MAX_AGE_MS) return null;
  if (typeof saved.nomor !== 'string' || !saved.nomor || !Number.isInteger(saved.stage) || (saved.stage as number) < 1 || (saved.stage as number) > 4) return null;
  return { at: saved.at, nomor: saved.nomor, stage: saved.stage as number };
}
function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Storage blocked: the next visit starts fresh. */ }
}
export function recallWorkMemory(): WorkMemory {
  return { lastReport: readLastReport(read(REPORT_KEY), Date.now()) };
}
export const rememberLastReport = (report: LastReport) => write(REPORT_KEY, JSON.stringify(report));
