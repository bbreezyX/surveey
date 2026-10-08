export function legacyPhotoUrl(path: string | null | undefined): string | null {
  if (/^\/media\/[0-9a-f]{32}$/.test(path ?? '')) return path!;
  const name = (path ?? '').replace(/[\\/:]/g, '_').trim();
  return name ? `/images/${encodeURIComponent(name)}` : null;
}
