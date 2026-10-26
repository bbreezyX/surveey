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
