import { describe, expect, it } from 'vitest';
import {
  reconstructRegionFirst,
  type RgbaBitmap,
} from '../src/core/vectorizer/v3/regionFirst';
import { compareVTracerWithRegionFirst } from '../src/core/vectorizer/v3/regionFirstBenchmark';

type Pixel = readonly [number, number, number, number?];

const COLORS = {
  clear: [0, 0, 0, 0] as Pixel,
  white: [255, 255, 255, 255] as Pixel,
  black: [0, 0, 0, 255] as Pixel,
  red: [220, 30, 30, 255] as Pixel,
  green: [30, 180, 70, 255] as Pixel,
  blue: [30, 80, 220, 255] as Pixel,
};

function bitmap(rows: readonly (readonly Pixel[])[]): RgbaBitmap {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const data = new Uint8Array(width * height * 4);
  rows.forEach((row, y) => row.forEach((pixel, x) => {
    const offset = (y * width + x) * 4;
    data[offset] = pixel[0];
    data[offset + 1] = pixel[1];
    data[offset + 2] = pixel[2];
    data[offset + 3] = pixel[3] ?? 255;
  }));
  return { width, height, data };
}

function fromAscii(lines: readonly string[], colors: Record<string, Pixel> = { '#': COLORS.black, '.': COLORS.clear }): RgbaBitmap {
  return bitmap(lines.map((line) => [...line].map((symbol) => colors[symbol])));
}

describe('Region-First V3.1', () => {
  it('reconstructs one monochrome component as one editable object', () => {
    const result = reconstructRegionFirst(fromAscii(['.###.', '.###.', '.###.']));
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0].holes).toHaveLength(0);
    expect(result.objects[0].compoundPath).toContain('Z');
  });

  it('preserves the hole in the letter O', () => {
    const result = reconstructRegionFirst(fromAscii(['#####', '#...#', '#...#', '#####']));
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0].holes).toHaveLength(1);
    expect(result.metrics.preservedHoles).toBe(1);
  });

  it('preserves the enclosed counter in the letter A', () => {
    const result = reconstructRegionFirst(fromAscii(['.###.', '#####', '#...#', '#####', '#...#', '#...#']));
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0].holes).toHaveLength(1);
  });

  it('keeps disconnected regions of the same color as separate objects', () => {
    const result = reconstructRegionFirst(fromAscii(['##..##', '##..##']));
    expect(result.objects).toHaveLength(2);
    expect(new Set(result.objects.map((object) => object.fillColor.key)).size).toBe(1);
  });

  it('keeps adjacent regions with different colors separate', () => {
    const result = reconstructRegionFirst(bitmap([[COLORS.red, COLORS.red, COLORS.blue, COLORS.blue]]));
    expect(result.objects).toHaveLength(2);
    expect(result.metrics.uniqueColors).toBe(2);
  });

  it('preserves three solid colors', () => {
    const result = reconstructRegionFirst(bitmap([
      [COLORS.red, COLORS.red, COLORS.green, COLORS.green, COLORS.blue, COLORS.blue],
      [COLORS.red, COLORS.red, COLORS.green, COLORS.green, COLORS.blue, COLORS.blue],
    ]));
    expect(result.objects).toHaveLength(3);
    expect(result.metrics.uniqueColors).toBe(3);
  });

  it('normalizes synthetic antialias transition colors to their endpoint regions', () => {
    const rows: Pixel[][] = [];
    for (let y = 0; y < 12; y++) {
      rows.push([
        ...Array<Pixel>(10).fill(COLORS.red),
        [232, 86, 86, 255], [244, 190, 190, 255],
        ...Array<Pixel>(10).fill(COLORS.white),
      ]);
    }
    const result = reconstructRegionFirst(bitmap(rows));
    expect(result.metrics.uniqueColors).toBe(2);
    expect(result.objects).toHaveLength(2);
  });

  it('collapses deterministic JPEG-like color noise without merging the two real colors', () => {
    const rows: Pixel[][] = [];
    for (let y = 0; y < 20; y++) {
      const row: Pixel[] = [];
      for (let x = 0; x < 30; x++) {
        const base = x < 15 ? COLORS.red : COLORS.white;
        const noise = ((x * 17 + y * 31) % 9) - 4;
        row.push([
          Math.max(0, Math.min(255, base[0] + noise)),
          Math.max(0, Math.min(255, base[1] + noise)),
          Math.max(0, Math.min(255, base[2] + noise)),
          255,
        ]);
      }
      rows.push(row);
    }
    const result = reconstructRegionFirst(bitmap(rows));
    expect(result.metrics.uniqueColors).toBe(2);
    expect(result.objects).toHaveLength(2);
  });

  it('preserves a coherent highlight instead of treating it as scattered color noise', () => {
    const base: Pixel = [30, 80, 220, 255];
    const highlight: Pixel = [42, 92, 232, 255];
    const rows = Array.from({ length: 12 }, (_, y) => Array.from(
      { length: 20 },
      (_, x) => x >= 7 && x < 13 && y >= 3 && y < 9 ? highlight : base,
    ));
    const result = reconstructRegionFirst(bitmap(rows));
    expect(result.metrics.uniqueColors).toBe(2);
    expect(result.objects).toHaveLength(2);
  });

  it('does not delete a one-pixel legitimate detail merely because it is small', () => {
    const rows = Array.from({ length: 7 }, () => Array<Pixel>(7).fill(COLORS.white));
    rows[3][3] = COLORS.black;
    const result = reconstructRegionFirst(bitmap(rows));
    expect(result.objects.some((object) => object.pixelCount === 1 && object.fillColor.key === '0,0,0,255')).toBe(true);
  });

  it('keeps fully transparent pixels outside the region model', () => {
    const result = reconstructRegionFirst(fromAscii(['.....', '.###.', '.###.', '.....']));
    expect(result.objects).toHaveLength(1);
    expect(result.metrics.opaqueOrVisiblePixels).toBe(6);
  });

  it('preserves meaningful uniform semi-transparency', () => {
    const semi: Pixel = [20, 90, 210, 128];
    const result = reconstructRegionFirst(bitmap([[semi, semi], [semi, semi]]));
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0].fillColor.a).toBe(128);
    expect(result.svg).toContain('fill-opacity="0.502"');
  });

  it('preserves multiple holes inside one compound object', () => {
    const result = reconstructRegionFirst(fromAscii([
      '#########',
      '#..#...##',
      '#..#...##',
      '#########',
    ]));
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0].holes).toHaveLength(2);
    expect(result.svg).toContain('fill-rule="evenodd"');
  });

  it('reports factual VTracer versus Region-First metrics and fragmentation ratio', () => {
    const source = fromAscii(['.###.', '.#.#.', '.###.']);
    const vtracerSvg = '<svg viewBox="0 0 5 3">' + Array.from(
      { length: 12 },
      (_, index) => `<path fill="#000" d="M${index} 0L${index + 1} 0Z"/>`,
    ).join('') + '</svg>';
    const report = compareVTracerWithRegionFirst(source, vtracerSvg);
    expect(report.vtracer.rawPathCount).toBe(12);
    expect(report.regionFirst.experimentalObjectCount).toBe(1);
    expect(report.regionFirst.preservedHoles).toBe(1);
    expect(report.fragmentationRatio).toBe(1);
    expect(report.fidelity.pixelDiff).toBe('NOT_AVAILABLE');
  });
});
