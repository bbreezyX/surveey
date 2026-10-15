import { describe, expect, it } from 'vitest';
import { googleCredit, storedSession } from '../src/public/map/google-tiles';

describe('Google tile session reuse', () => {
  const now = Date.UTC(2026, 9, 15);
  const raw = (fields: object) => JSON.stringify({ key: 'k1', session: 's1', expiry: now + 86_400_000, ...fields });
  it('reuses a stored token for the same key while it has more than an hour left', () => {
    expect(storedSession(raw({}), 'k1', now)).toBe('s1');
  });
  it('asks for a new token when the key changed, it is about to expire, or storage is unreadable', () => {
    expect(storedSession(raw({}), 'k2', now)).toBeNull();
    expect(storedSession(raw({ expiry: now + 1_800_000 }), 'k1', now)).toBeNull();
    expect(storedSession('{not json', 'k1', now)).toBeNull();
    expect(storedSession(null, 'k1', now)).toBeNull();
  });
});

describe('Google attribution', () => {
  it('names Google Maps with the viewport providers, escaped for the attribution HTML', () => {
    expect(googleCredit('Imagery ©2026 Airbus, CNES / Airbus')).toBe('Google Maps &middot; Imagery ©2026 Airbus, CNES / Airbus');
    expect(googleCredit('<b>x</b> & y')).toBe('Google Maps &middot; &lt;b&gt;x&lt;/b&gt; &amp; y');
    expect(googleCredit(undefined)).toBe('Google Maps');
  });
});
