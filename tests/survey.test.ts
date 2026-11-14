import { describe, expect, it } from 'vitest';
import { getPointFlags, countOfficialPoints } from '../src/shared/survey/status';
import { parseCoordinateQuery, formatCoordPair } from '../src/shared/survey/coordinates';
import { legacyPhotoUrl } from '../src/shared/survey/media';
import { latestDocumentationDate } from '../src/shared/survey/dates';
import { linkedNomor, linkedReport, progressReportUrl } from '../src/shared/survey/report';
import { parsePending, parseProgress, parseToday, todayTally, reportReceipt, pendingLabel, pendingSummary, stageBadgeSvg, stageDone, stageSummary, tallyStages, doneShare, workGroups, workBadgeSvg, NEXT_REPORT, NOT_STARTED_BADGE, WORK_DONE } from '../src/shared/survey/progress';
describe('survey evidence and counting', () => {
  it('ignores malformed and impossible optional dates without normalizing them', () => {
    expect(latestDocumentationDate(['32/13/2026', '31/02/9999', '29/02/2025', ''])).toBeNull();
    expect(latestDocumentationDate(['06/10/2026', '31/02/9999', '29/02/2024'])?.toISOString()).toBe('2026-10-06T00:00:00.000Z');
  });
  it('counts allocated unplaced and verification records but excludes reserves', () => {
    expect(countOfficialPoints([{ cadangan: false }, { cadangan: true }, { cadangan: false }])).toBe(2);
    expect(getPointFlags({ Status: 'Belum Ditetapkan', Duplikat: 'ya' })).toEqual({ cadangan: false, belum: true, duplikat: true });
    expect(getPointFlags({ Status: ' CADANGAN ', Duplikat: '1' }).cadangan).toBe(true);
  });
  it('accepts either coordinate order and preserves photo-stamp precision', () => {
    expect(parseCoordinateQuery('103.586442, -1.584248')).toEqual({ lat: -1.584248, lon: 103.586442 });
    expect(parseCoordinateQuery('-1.584248; 103.586442')).toEqual({ lat: -1.584248, lon: 103.586442 });
    expect(parseCoordinateQuery('200, 300')).toBeNull();
    expect(formatCoordPair(-1.584248, 103.586442)).toBe('-1.584248, 103.586442');
  });
  it('handles legacy media paths and legitimately absent photos', () => {
    expect(legacyPhotoUrl('')).toBeNull();
    expect(legacyPhotoUrl('D:/Survey/X.jpg')).toBe('/images/D__Survey_X.jpg');
    expect(legacyPhotoUrl('A #1.jpg')).toBe('/images/A%20%231.jpg');
  });
});

describe('progress report link', () => {
  it('names the point by its Nomor, spaces and all', () => {
    expect(progressReportUrl('KERINCI-SIULAK-DUSUN DALAM-001')).toBe('https://www.esdm.cloud/lapangan?nomor=KERINCI-SIULAK-DUSUN%20DALAM-001');
  });
  it('reads back the Nomor esdm.cloud links here with', () => {
    expect(linkedNomor('?nomor=KERINCI-SIULAK-DUSUN%20DALAM-001')).toBe('KERINCI-SIULAK-DUSUN DALAM-001');
    expect(linkedNomor('?nomor=MUARO+JAMBI-JAMBI+LUAR+KOTA-MENDALO+DARAT-012&x=1')).toBe('MUARO JAMBI-JAMBI LUAR KOTA-MENDALO DARAT-012');
    expect(linkedNomor('?nomor=%20%20')).toBeNull();
    expect(linkedNomor('')).toBeNull();
  });
  it('reads the stage a crew reported on the way back, and only a real one', () => {
    expect(linkedReport('?nomor=KERINCI-SIULAK-DUSUN%20DALAM-001&lapor=1')).toBe(1);
    expect(linkedReport('?lapor=4')).toBe(4);
    expect(['?lapor=0', '?lapor=5', '?lapor=2.5', '?lapor=galian', '?nomor=x', ''].map(linkedReport)).toEqual([null, null, null, null, null, null]);
  });
  it('draws the tick only for a report the feed holds', () => {
    expect(reportReceipt(2, 1, [2])).toBe('pending');
    expect(reportReceipt(2, 2, undefined)).toBe('accepted');
    expect(reportReceipt(1, 3, [4])).toBe('accepted');
    expect(reportReceipt(2, 1, [3])).toBeNull();
    expect(reportReceipt(1, 0, undefined)).toBeNull();
  });
});
describe('build progress from esdm.cloud', () => {
  it('keeps whole stages one to four by Nomor and drops the rest', () => {
    const progress = parseProgress({ stages: { 'A-001': 1, 'A-002': 4, 'A-003': 0, 'A-004': 2.5, 'A-005': '3' } });
    expect([...progress]).toEqual([['A-001', 1], ['A-002', 4]]);
    expect(parseProgress(null).size).toBe(0);
  });
  it('reads open report stages per Nomor and names them as /lapangan does', () => {
    const pending = parsePending({ stages: {}, pending: { 'A-001': [3, 2, 3], 'A-002': [], 'A-003': [0, 5, 1.5], 'A-004': '2', 'A-005': [4] } });
    expect([...pending]).toEqual([['A-001', [2, 3]], ['A-005', [4]]]);
    expect(parsePending({ stages: {} }).size).toBe(0);
    expect(pendingSummary([2, 3])).toBe('Cor, Tiang menunggu diperiksa');
    expect(pendingLabel([2, 3])).toBe('Tiang Menunggu');
  });
  it('draws every stage apart and keeps the green check for a lit lamp', () => {
    expect([1, 2, 3, 4].map(stage => stageBadgeSvg(stage).includes('#1f8f4e'))).toEqual([false, false, false, true]);
    expect(new Set([1, 2, 3, 4].map(stageBadgeSvg)).size).toBe(4);
    // Only Tiang's badge draws the dashed ring of a Lampu still to be seen lit at night.
    expect([1, 2, 3, 4].map(stage => stageBadgeSvg(stage).includes('stroke-dasharray'))).toEqual([false, false, true, false]);
    expect([0, 1, 2, 3, 4].map(stageDone)).toEqual([false, false, false, false, true]);
  });
  it('names the last finished stage, and a lit lamp as terpasang', () => {
    expect([0, 1, 2, 3, 4].map(stageSummary)).toEqual(['Belum Dimulai', 'Galian Selesai', 'Cor Selesai', 'Tiang Selesai', 'Terpasang']);
  });
});

describe('progress summary and work list', () => {
  const units = [
    { nomor: 'A-001', cadangan: false }, { nomor: 'A-002', cadangan: false }, { nomor: 'A-003', cadangan: false },
    { nomor: 'A-004', cadangan: false }, { nomor: 'A-005', cadangan: false }, { nomor: 'A-006', cadangan: true },
    { nomor: 'A-007', cadangan: false },
  ];
  const progress = new Map([['A-002', 1], ['A-003', 2], ['A-004', 4], ['A-005', 1], ['A-006', 4], ['A-007', 3]]);
  const pending = new Map([['A-005', [2]], ['A-006', [1]]]);
  it('counts official units by step, a pole accepted at Tiang as terpasang, and the ones waiting for review', () => {
    const tally = tallyStages(units, progress, pending);
    expect(tally).toEqual({ total: 6, stages: [1, 2, 1, 2], waiting: 1 });
    expect(doneShare(tally)).toBe(33);
    expect(doneShare(tallyStages([], progress, null))).toBe(0);
  });
  it('sorts units by the report they need next and keeps open reports apart', () => {
    const groups = workGroups(units, progress, pending);
    expect(groups.due.map(list => list.map(unit => unit.nomor))).toEqual([['A-001'], ['A-002'], ['A-003']]);
    expect(groups.waiting.map(unit => unit.nomor)).toEqual(['A-005']);
    expect(groups.done.map(unit => unit.nomor)).toEqual(['A-004', 'A-007']);
    expect(NEXT_REPORT.map(step => step.title)).toEqual(['Lapor Galian', 'Lapor Cor', 'Lapor Tiang']);
  });
  it('draws a not-started badge apart from every stage badge', () => {
    expect([1, 2, 3, 4].map(stageBadgeSvg)).not.toContain(NOT_STARTED_BADGE);
    expect(NOT_STARTED_BADGE).not.toContain('#0072bc');
    expect(workBadgeSvg(0)).toBe(NOT_STARTED_BADGE);
    expect(workBadgeSvg(WORK_DONE)).toBe(stageBadgeSvg(4));
  });
  it('reads today\'s stages from the feed and drops anything malformed', () => {
    const today = parseToday({ today: {
      'A-001': { stage: 4, at: '2026-11-14T02:10:00.000Z' },
      'A-002': { stage: 7, at: '2026-11-14T02:10:00.000Z' },
      'A-003': { stage: 2, at: 'kemarin' },
      'A-004': null,
    } });
    expect([...today]).toEqual([['A-001', { stage: 4, at: Date.parse('2026-11-14T02:10:00.000Z') }]]);
    expect(parseToday({ stages: {} }).size).toBe(0);
  });
  it('counts today\'s official units per step and kabupaten, newest first', () => {
    const units = [
      { nomor: 'A-001', cadangan: false, kabupaten: 'Bungo' }, { nomor: 'A-002', cadangan: false, kabupaten: 'Bungo' },
      { nomor: 'A-003', cadangan: false, kabupaten: 'Kerinci' }, { nomor: 'A-004', cadangan: true, kabupaten: 'Kerinci' },
    ];
    const today = new Map([['A-001', { stage: 1, at: 100 }], ['A-002', { stage: 3, at: 300 }], ['A-003', { stage: 4, at: 200 }], ['A-004', { stage: 2, at: 400 }]]);
    const tally = todayTally(units, today);
    expect(tally.list.map(item => [item.unit.nomor, item.step])).toEqual([['A-002', WORK_DONE], ['A-003', WORK_DONE], ['A-001', 1]]);
    expect(tally.steps).toEqual([0, 1, 0, 2]);
    expect([...tally.byRegion]).toEqual([['Bungo', 2], ['Kerinci', 1]]);
    expect(todayTally(units, null).list).toEqual([]);
  });
});
