// The progress reporting app on esdm.cloud takes a point by its Nomor and opens that point's
// stage report, so a crew looking at a pin here reaches the right form without searching again.
export const PROGRESS_REPORT_ORIGIN = 'https://www.esdm.cloud';
export function progressReportUrl(nomor: string): string {
  return `${PROGRESS_REPORT_ORIGIN}/lapangan?nomor=${encodeURIComponent(nomor)}`;
}
// esdm.cloud/lapangan links back here by the same Nomor (?nomor=), so the crew can compare the survey's
// photo of the spot with what they see before reporting.
// After a report there, esdm.cloud/lapangan sends the crew back with the stage it took (?lapor=1..4, counted
// as the progress feed counts them). It only asks for the tick: the feed decides whether one is drawn.
export function linkedReport(search: string): number | null {
  const stage = Number(new URLSearchParams(search).get('lapor'));
  return Number.isInteger(stage) && stage >= 1 && stage <= 4 ? stage : null;
}
export function linkedNomor(search: string): string | null {
  return new URLSearchParams(search).get('nomor')?.trim() || null;
}
