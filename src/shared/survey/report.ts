// The progress reporting app on esdm.cloud takes a point by its Nomor and opens that point's
// stage report, so a crew looking at a pin here reaches the right form without searching again.
export const PROGRESS_REPORT_ORIGIN = 'https://www.esdm.cloud';
export function progressReportUrl(nomor: string): string {
  return `${PROGRESS_REPORT_ORIGIN}/lapangan?nomor=${encodeURIComponent(nomor)}`;
}
