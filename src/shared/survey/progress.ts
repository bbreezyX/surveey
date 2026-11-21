import { PROGRESS_REPORT_ORIGIN } from './report';
// esdm.cloud publishes how far each unit got, by Nomor, so a pin here can say a stage is done without the
// reader opening the progress list there. Only stages esdm.cloud has accepted count; open reports do not.
export const BUILD_STAGES = ['Galian', 'Cor', 'Tiang', 'Lampu'] as const;
export const PROGRESS_URL = `${PROGRESS_REPORT_ORIGIN}/api/public/survey-progress`;
export type SurveyProgress = ReadonlyMap<string, number>;
export function parseProgress(value: unknown): SurveyProgress {
  const progress = new Map<string, number>();
  const stages = value && typeof value === 'object' ? (value as { stages?: unknown }).stages : null;
  if (!stages || typeof stages !== 'object') return progress;
  for (const [nomor, stage] of Object.entries(stages)) if (Number.isInteger(stage) && stage >= 1 && stage <= 4) progress.set(nomor, stage);
  return progress;
}
// Stages whose /lapangan report esdm.cloud has received and not yet accepted, ascending; a point whose
// report has been reviewed drops out. Shown in the list only, beside the accepted stage, never on the pins.
export type SurveyPending = ReadonlyMap<string, readonly number[]>;
export function parsePending(value: unknown): SurveyPending {
  const pending = new Map<string, number[]>();
  const raw = value && typeof value === 'object' ? (value as { pending?: unknown }).pending : null;
  if (!raw || typeof raw !== 'object') return pending;
  for (const [nomor, stages] of Object.entries(raw)) {
    const valid = Array.isArray(stages) ? [...new Set(stages.filter((stage): stage is number => Number.isInteger(stage) && stage >= 1 && stage <= 4))].sort((a, b) => a - b) : [];
    if (valid.length) pending.set(nomor, valid);
  }
  return pending;
}
// Steps esdm.cloud recorded since midnight WIB, one row per action (ms since epoch), as its field history counts
// reports: a point dug and poured on one day is two rows, so "hari ini" matches the "6 laporan" staff see there.
// `todayStages` lists them; a feed from before it has only `today`, one furthest stage per unit, read as one row each.
// The day is cut on esdm.cloud, so every reader shares one calendar; a feed with neither reads empty.
export interface SurveyTodayEntry { nomor: string; stage: number; at: number }
export type SurveyToday = readonly SurveyTodayEntry[];
export function parseToday(value: unknown): SurveyToday {
  const today: SurveyTodayEntry[] = [];
  const feed = (value && typeof value === 'object' ? value : {}) as { today?: unknown; todayStages?: unknown };
  const read = (nomor: unknown, entry: unknown) => {
    const { stage, at } = (entry && typeof entry === 'object' ? entry : {}) as { stage?: unknown; at?: unknown };
    const time = typeof at === 'string' ? Date.parse(at) : NaN;
    if (typeof nomor === 'string' && nomor && Number.isInteger(stage) && (stage as number) >= 1 && (stage as number) <= 4 && Number.isFinite(time)) today.push({ nomor, stage: stage as number, at: time });
  };
  if (Array.isArray(feed.todayStages)) for (const entry of feed.todayStages) read((entry as { nomor?: unknown } | null)?.nomor, entry);
  else if (feed.today && typeof feed.today === 'object') for (const [nomor, entry] of Object.entries(feed.today)) read(nomor, entry);
  return today;
}
// The same words /lapangan shows a crew for its own open report, so both sides name it alike. Read aloud
// and in the tooltip; the pill itself is pendingLabel.
export function pendingSummary(stages: readonly number[]): string {
  return `${stages.map(stage => BUILD_STAGES[stage - 1]).join(', ')} menunggu diperiksa`;
}
// The pill sits in a two-column card about 117px wide, as wide as "Galian Selesai": only the furthest open
// stage and one word fit. That stage is the one worth chasing; an earlier open one is settled with it.
export function pendingLabel(stages: readonly number[]): string {
  return `${BUILD_STAGES[stages[stages.length - 1] - 1]} Menunggu`;
}
// A clock beside either wording: an open report is a wait, not a problem. One drawing for the public lists and
// the admin's (raw SVG).
export const PENDING_CLOCK_SVG = '<svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 4.2V7l1.9 1.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// A crew back from esdm.cloud/lapangan names the stage it reported; the address alone proves nothing, so the
// tick is drawn only once the feed holds that report: waiting for review, or already accepted.
export type ReportReceipt = 'pending' | 'accepted';
export function reportReceipt(stage: number, accepted: number, pending: readonly number[] | undefined): ReportReceipt | null {
  return accepted >= stage ? 'accepted' : pending?.includes(stage) ? 'pending' : null;
}
// The stages run in order, so the badge counts rather than colour-codes: a blue pie fills a quarter per
// finished stage (Galian, Cor, Tiang) and reads without the legend or telling hues apart, which a 14px
// mark on satellite imagery, colour-blind readers and the yellow/orange pin statuses all argue against.
// Only Lampu, the unit standing and lit, turns into a green check, so green on the map means terpasang
// and nothing else. One drawing serves the pin, the list and the legend (raw SVG).
const PIE = ['', 'M7 7V3.4A3.6 3.6 0 0 1 10.6 7Z', 'M7 7V3.4A3.6 3.6 0 0 1 7 10.6Z', 'M7 7V3.4A3.6 3.6 0 1 1 3.4 7Z'];
export const stageDone = (stage: number) => stage >= BUILD_STAGES.length;
// Lampu half done, as on esdm.cloud/lapangan: crews visit by day and the lamp head usually goes up with the
// pole, but its proof is the lamp lit at night. Drawn as a dashed ring; display only, the stage stays Tiang.
export const lampAwaitsNight = (stage: number) => stage === BUILD_STAGES.length - 1;
export function stageBadgeSvg(stage: number): string {
  if (stageDone(stage)) return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6" fill="#1f8f4e" stroke="#fff" stroke-width="1.6"/><path d="M4.3 7.2 6.2 9 9.8 5.3" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const dash = lampAwaitsNight(stage) ? ' stroke-dasharray="2.2 1.5"' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6" fill="#fff" stroke="#0072bc" stroke-width="1.6"${dash}/><path d="${PIE[Math.max(1, Math.min(3, stage))]}" fill="#0072bc"/></svg>`;
}
// "Lampu selesai" is the unit standing and lit, which the field calls terpasang.
export function stageSummary(stage: number): string {
  return stage >= 4 ? 'Terpasang' : stage >= 1 ? `${BUILD_STAGES[stage - 1]} Selesai` : 'Belum Dimulai';
}
// The progress view tracks every build stage from esdm.cloud, including stage 3 (Tiang standing, awaiting a
// night photo for Lampu), so pins, popups, legends and the work list always agree on what counts as terpasang.
export const WORK_DONE = BUILD_STAGES.length;
export const workStep = (stage: number) => Math.max(0, Math.min(stage, WORK_DONE));
// Its counts sit beside the badges, so they read as a sentence would: "81 galian selesai".
export const STAGE_COUNT_LABEL = ['Belum dimulai', 'Galian selesai', 'Cor selesai', 'Tiang selesai', 'Terpasang'] as const;
// Only the progress view needs a mark for "nothing accepted yet": a hollow grey ring, so it reads as empty
// beside the blue pies without claiming any stage. Never drawn on a pin.
export const NOT_STARTED_BADGE = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.4" fill="#fff" stroke="#8a99a9" stroke-width="1.4"/></svg>';
// A step's badge: the hollow ring when untouched, the pin's pie for Galian/Cor/Tiang, and its green check for terpasang.
export const workBadgeSvg = (step: number) => step > 0 ? stageBadgeSvg(step) : NOT_STARTED_BADGE;
// Open reports still ahead of the unit's accepted stage; an already-accepted stage left in the feed is ignored.
export function openPendingStages(stage: number, pending: readonly number[] | undefined | null): readonly number[] {
  if (!pending?.length || stage >= WORK_DONE) return [];
  const open = pending.filter(item => item > stage);
  return open.length === pending.length ? pending : open;
}
interface ProgressUnit { nomor: string; cadangan: boolean }
// Units per step (stages[0]: none yet, stages[WORK_DONE]: terpasang) plus those with an open report waiting for
// review. Official units only: Cadangan sits outside the allocation and every other count leaves it out.
export interface StageTally { total: number; stages: number[]; waiting: number }
export function tallyStages(units: readonly ProgressUnit[], progress: SurveyProgress, pending: SurveyPending | null): StageTally {
  const stages = [0, 0, 0, 0, 0]; let total = 0, waiting = 0;
  for (const unit of units) {
    if (unit.cadangan) continue;
    const step = workStep(progress.get(unit.nomor) ?? 0);
    total++; stages[step]++;
    if (openPendingStages(step, pending?.get(unit.nomor)).length) waiting++;
  }
  return { total, stages, waiting };
}
export const doneShare = (tally: StageTally) => tally.total ? Math.round((tally.stages[WORK_DONE] / tally.total) * 100) : 0;
// A crew's work list, by the report each unit needs next. A unit whose next report is still waiting for review
// sits apart: sending that stage again does not help, the office has to look first.
export const NEXT_REPORT = [
  { title: 'Lapor Galian', note: 'Belum ada tahap diterima' },
  { title: 'Lapor Cor', note: 'Galian sudah diterima' },
  { title: 'Lapor Tiang', note: 'Cor sudah diterima' },
  { title: 'Lapor Lampu', note: 'Tiang berdiri, menunggu foto malam' },
] as const;
export function workGroups<T extends ProgressUnit>(units: readonly T[], progress: SurveyProgress, pending: SurveyPending | null) {
  const due: T[][] = [[], [], [], []], waiting: T[] = [], done: T[] = [];
  for (const unit of units) {
    if (unit.cadangan) continue;
    const step = workStep(progress.get(unit.nomor) ?? 0);
    if (step === WORK_DONE) done.push(unit);
    else if (openPendingStages(step, pending?.get(unit.nomor)).length) waiting.push(unit);
    else due[step].push(unit);
  }
  return { due, waiting, done };
}
// Stage filter values match tallyStages indices (0..WORK_DONE), so clicking a legend entry filters the map
// and lists to the exact count shown on that entry.
export type StageFilter = 0 | 1 | 2 | 3 | 4;
export function matchesStageFilter(unit: ProgressUnit, filter: StageFilter, progress: SurveyProgress): boolean {
  return !unit.cadangan && workStep(progress.get(unit.nomor) ?? 0) === filter;
}
// Official units with open reports waiting for review, counted per kabupaten in the caller's region order.
export interface WaitingRegion { kabupaten: string; count: number }
export function waitingByRegion(units: readonly (ProgressUnit & { kabupaten: string })[], progress: SurveyProgress, pending: SurveyPending | null, regionOrder?: readonly string[]): WaitingRegion[] {
  const counts = new Map<string, number>();
  for (const unit of units) {
    if (unit.cadangan) continue;
    const step = workStep(progress.get(unit.nomor) ?? 0);
    if (!openPendingStages(step, pending?.get(unit.nomor)).length) continue;
    counts.set(unit.kabupaten, (counts.get(unit.kabupaten) ?? 0) + 1);
  }
  if (!counts.size) return [];
  const names = regionOrder ? regionOrder.filter(name => counts.has(name)) : [...counts.keys()];
  for (const name of counts.keys()) if (!names.includes(name)) names.push(name);
  return names.map(kabupaten => ({ kabupaten, count: counts.get(kabupaten)! }));
}
// "Hari ini" in the progress view: every step recorded today on an official unit, newest first, with counts per step
// and per kabupaten. While a stage filter is on, the kabupaten counts keep that stage's steps only, as the cells do.
export interface TodayUnit<T> { unit: T; step: number; at: number }
export function todayTally<T extends ProgressUnit & { kabupaten: string }>(units: readonly T[], today: SurveyToday | null, filter: StageFilter | null = null) {
  const list: TodayUnit<T>[] = [], steps = [0, 0, 0, 0, 0], byRegion = new Map<string, number>();
  if (!today?.length) return { list, steps, byRegion };
  const byNomor = new Map(units.map(unit => [unit.nomor, unit]));
  for (const entry of today) {
    const unit = byNomor.get(entry.nomor);
    if (!unit || unit.cadangan) continue;
    const step = workStep(entry.stage);
    list.push({ unit, step, at: entry.at }); steps[step]++;
    if (filter === null || filter === step) byRegion.set(unit.kabupaten, (byRegion.get(unit.kabupaten) ?? 0) + 1);
  }
  list.sort((a, b) => b.at - a.at);
  return { list, steps, byRegion };
}
// "Moved today", whatever the stage: ink-blue with an up arrow, since green on this map means terpasang.
export const TODAY_ARROW = '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M6 10V2.5M2.6 5.6 6 2.2l3.4 3.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
