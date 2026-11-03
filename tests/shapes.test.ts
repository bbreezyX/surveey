import { expect, it } from 'vitest';
import { thumbnailDotPaths } from '../src/public/map/shapes';

it('keeps every thumbnail point and the status paint order in a few SVG paths', () => {
  const dots = [
    { id: 'A', x: 10, y: 20, kind: 'sk' },
    { id: 'B', x: 10, y: 20, kind: 'sk' },
    { id: 'C', x: 15, y: 20, kind: 'duplikat' },
    { id: 'D', x: 16, y: 20, kind: 'belum' },
    { id: 'E', x: 17, y: 20, kind: 'duplikat' },
  ];
  const paths = thumbnailDotPaths(dots, 2);
  expect(paths.map(path => path.kind)).toEqual(['sk', 'duplikat', 'belum', 'duplikat']);
  // Coincident units stay represented; only DOM nodes are batched.
  expect(paths[0].path).toBe('M12 20a2 2 0 1 1 -4 0a2 2 0 1 1 4 0ZM12 20a2 2 0 1 1 -4 0a2 2 0 1 1 4 0Z');
  expect(paths.reduce((count, item) => count + (item.path.match(/M/g)?.length ?? 0), 0)).toBe(5);
  expect(thumbnailDotPaths([], 2)).toEqual([]);
});
