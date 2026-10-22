import { describe, expect, it } from 'vitest';
import { pasteCoordinates } from '../admin/src/api';

function paste(text: string) {
  let prevented = false;
  const event = { clipboardData: { getData: () => text }, preventDefault: () => { prevented = true; } } as unknown as ClipboardEvent;
  const target = { lat: 1, lon: 2 };
  pasteCoordinates(event, target);
  return { prevented, ...target };
}

describe('admin coordinate paste', () => {
  it('fills both fields from a pasted lat, long pair', () => {
    expect(paste('-1.4913, 102.4619')).toEqual({ prevented: true, lat: -1.4913, lon: 102.4619 });
    expect(paste('(-1.584248, 103.586442)')).toEqual({ prevented: true, lat: -1.584248, lon: 103.586442 });
    expect(paste('103.586442, -1.584248')).toEqual({ prevented: true, lat: -1.584248, lon: 103.586442 });
  });
  it('leaves a single number or other text to the browser', () => {
    expect(paste('-1.4913')).toEqual({ prevented: false, lat: 1, lon: 2 });
    expect(paste('Desa Mangun Jayo')).toEqual({ prevented: false, lat: 1, lon: 2 });
  });
});
