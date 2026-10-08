/** Optional evidence dates cannot prevent unrelated map records from loading. */
export function latestDocumentationDate(dates: readonly string[]): Date | null {
  let latest: Date | null = null;
  for (const text of dates) {
    const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) continue;
    const [, day, month, year] = match;
    const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) continue;
    if (!latest || date > latest) latest = date;
  }
  return latest;
}
