import { describe, expect, it } from 'vitest';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import Polygon from 'ol/geom/Polygon';
import { thumbnailDotPaths } from '../src/public/map/shapes';
import { boundaryBadgeStyle, boundaryStyle, completedRegions, setOfflineBasemap } from '../src/public/map/styles';

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

describe('completed kabupaten boundaries', () => {
  const units = [
    { nomor: 'B-001', kabupaten: 'Kab. Bungo', cadangan: false },
    { nomor: 'B-002', kabupaten: 'Kab. Bungo', cadangan: false },
    { nomor: 'B-003', kabupaten: 'Kab. Bungo', cadangan: true },
    { nomor: 'T-001', kabupaten: 'Kab. Tebo', cadangan: false },
    { nomor: 'T-002', kabupaten: 'Kab. Tebo', cadangan: false },
    { nomor: 'M-001', kabupaten: 'Kab. Merangin', cadangan: false },
    { nomor: 'M-002', kabupaten: 'Kab. Merangin', cadangan: true },
    { nomor: 'J-001', kabupaten: 'Kota Jambi', cadangan: false },
  ];

  it('marks only kabupaten whose official units are 100% terpasang', () => {
    const progress = new Map([
      ['B-001', 4], ['B-002', 4], // all official Bungo units done; B-003 is cadangan and excluded
      ['T-001', 4], ['T-002', 3], // partially installed -> stays unmarked
      ['M-001', 3], ['M-002', 4], // only cadangan M-002 is stage 4 -> stays unmarked
      ['J-001', 4],               // Kota Jambi 100% done
    ]);
    expect([...completedRegions(units, progress)]).toEqual(['BUNGO', 'KOTA JAMBI']);
    expect(completedRegions(units, new Map()).size).toBe(0);
  });

  it('highlights only 100% completed boundaries, keeps badges inside curved polygons and fades on zoom', () => {
    const poly = (name: string, size = 100_000) => {
      const feature = new Feature(new Polygon([[[0, 0], [size, 0], [size, size], [0, size], [0, 0]]]));
      feature.set('KABUPATEN_', name);
      return feature;
    };
    const completed = new Set(['BUNGO', 'KOTA JAMBI']);
    const bungo = poly('KAB. BUNGO');
    const tebo = poly('KAB. TEBO');
    const kotaJambi = poly('KOTA JAMBI', 16_000);
    const doneFar = boundaryStyle(bungo, 300, completed);
    const unfinishedFar = boundaryStyle(tebo, 300, completed);

    // At province zoom: only 100% completed kabupaten carries dark shading; unfinished stays plain.
    expect(doneFar.some(style => style.getFill() && style.getZIndex() === 0)).toBe(true);
    expect(unfinishedFar.some(style => style.getFill())).toBe(false);

    // Finished borders sit at higher zIndex so they draw cleanly on top of adjacent unfinished borders.
    const maxStrokeZ = (styles: ReturnType<typeof boundaryStyle>) => Math.max(...styles.filter(s => s.getStroke() && !s.getText()).map(s => s.getZIndex() ?? 0));
    expect(maxStrokeZ(doneFar)).toBeGreaterThan(maxStrokeZ(unfinishedFar));

    // Completed regions draw their label + big checkmark on the top overlay layer (boundaryBadgeStyle) above pins,
    // anchored directly at the polygon's deepest interior point (zero pixel displacement) so curved borders
    // like Tanjung Jabung Timur never push the checkmark into an adjacent kabupaten on mobile.
    expect(doneFar.some(style => style.getText() || style.getImage())).toBe(false);
    const doneDesk = boundaryBadgeStyle(bungo, 300, completed)!;
    const doneMob = boundaryBadgeStyle(bungo, 900, completed)!;
    const doneCompact = boundaryBadgeStyle(kotaJambi, 900, completed)!;
    expect(doneDesk.find(style => style.getText())?.getText()?.getText()).toBe('Kab. Bungo');
    expect(doneDesk.find(style => style.getText())?.getText()?.getOffsetY()).toBeGreaterThan(0);
    expect(doneDesk.find(style => style.getImage())?.getImage()?.getDisplacement()).toEqual([0, 0]);
    expect(doneMob.find(style => style.getImage())?.getImage()?.getScale()).toBeLessThan(Number(doneDesk.find(style => style.getImage())?.getImage()?.getScale()));
    expect(doneCompact.find(style => style.getImage())?.getImage()?.getScale()).toBeLessThan(Number(doneMob.find(style => style.getImage())?.getImage()?.getScale()));
    expect(boundaryBadgeStyle(tebo, 300, completed)).toBeUndefined();

    // Concave arch (like Tanjung Jabung Timur): badge center stays strictly inside the thick upper arch,
    // not near the concave notch where a horizontal midline scan lands.
    const archGeom = new Polygon([[[0, 0], [30_000, 0], [30_000, 45_000], [90_000, 45_000], [90_000, 0], [120_000, 0], [120_000, 100_000], [0, 100_000], [0, 0]]]);
    const arch = new Feature(archGeom);
    arch.set('KABUPATEN_', 'KAB. TANJUNG JABUNG TIMUR');
    const archBadge = boundaryBadgeStyle(arch, 900, new Set(['TANJUNG JABUNG TIMUR']))!;
    const badgePoint = archBadge.find(style => style.getImage())?.getGeometry() as Point;
    const [bx, by] = badgePoint.getCoordinates();
    expect(archGeom.intersectsCoordinate([bx, by])).toBe(true);
    expect(by).toBeGreaterThan(55_000);

    // Zoomed in close: dark fills, checkmark badges and labels drop away so satellite detail stays unobstructed.
    const doneNear = boundaryStyle(bungo, 40, completed);
    expect(doneNear.some(style => style.getFill() || style.getText() || style.getImage())).toBe(false);
    expect(boundaryBadgeStyle(bungo, 40, completed)).toBeUndefined();
    expect(doneNear.some(style => style.getStroke())).toBe(true);

    // Offline pale basemap switches to muted deep jade (#196e52 -> rgb(25,110,82)).
    setOfflineBasemap(true);
    try {
      const offlineDone = boundaryStyle(bungo, 300, completed);
      expect(offlineDone.some(style => String(style.getStroke()?.getColor()).includes('25,110,82'))).toBe(true);
    } finally {
      setOfflineBasemap(false);
    }
  });
});
