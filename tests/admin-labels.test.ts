import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AUDIT_ACTION_LABELS, auditActionLabel, formatPointFieldValue, POINT_FIELD_LABELS, pointFieldLabel } from '../admin/src/labels';
import { emptyState } from '../admin/src/api';

it('maps every PointState key and formats values consistently', () => {
  const keys = Object.keys(emptyState());
  expect(Object.keys(POINT_FIELD_LABELS).sort()).toEqual(keys.sort());
  for (const key of keys) expect(pointFieldLabel(key)).not.toBe(key);
  expect(formatPointFieldValue('duplikat', true)).toBe('Ya');
  expect(formatPointFieldValue('archived', false)).toBe('Tidak');
  expect(formatPointFieldValue('status', '')).toBe('Alokasi Utama');
  expect(formatPointFieldValue('keterangan', '')).toBe('—');
  expect(formatPointFieldValue('lat', -1.6)).toBe('-1.600000');
  expect(formatPointFieldValue('photo_id', '12345678-1234-1234-1234-1234567890ab')).toBe('12345678');
});

it('covers every backend audit action with a readable Title Case label', () => {
  const sources = ['server/survey/services.py', 'server/survey/views.py'].map(path => readFileSync(path, 'utf8')).join('\n');
  const actions = new Set([...sources.matchAll(/audit\([^,]+,\s*'([^']+)'/g)].map(match => match[1]));
  expect(actions.size).toBeGreaterThan(10);
  for (const action of actions) {
    expect(AUDIT_ACTION_LABELS[action]).toBeTruthy();
    expect(auditActionLabel(action)).toBe(AUDIT_ACTION_LABELS[action]);
  }
  expect(auditActionLabel('unknown.event')).toBe('unknown.event');
});
