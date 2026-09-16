import { describe, expect, it } from 'vitest';
import { convertPixels } from '@visioncortex/vtracer';
import { getVTracerOptionsForPreset } from '../src/core/vectorizer/presets';
import { resolveAdaptiveVTracerOptions } from '../src/core/vectorizer/v2/adaptiveVTracerSelector';
import { compareVTracerWithRegionFirst } from '../src/core/vectorizer/v3/regionFirstBenchmark';
import type { RgbaBitmap } from '../src/core/vectorizer/v3/regionFirst';

type Rgba = readonly [number, number, number, number];

const CLEAR: Rgba = [0, 0, 0, 0];
const BLACK: Rgba = [12, 12, 12, 255];
const WHITE: Rgba = [248, 248, 246, 255];
const RED: Rgba = [220, 30, 30, 255];
const GREEN: Rgba = [30, 180, 70, 255];
const BLUE: Rgba = [30, 80, 220, 255];

function makeBitmap(width: number, height: number, pixel: (x: number, y: number) => Rgba): RgbaBitmap {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = pixel(x, y);
    const offset = (y * width + x) * 4;
    data.set(color, offset);
  }
  return { width, height, data };
}

function scaledAscii(lines: readonly string[], scale = 8, colors: Record<string, Rgba> = { '#': BLACK, '.': CLEAR }): RgbaBitmap {
  const width = (lines[0]?.length ?? 0) * scale;
  const height = lines.length * scale;
  return makeBitmap(width, height, (x, y) => colors[lines[Math.floor(y / scale)][Math.floor(x / scale)]]);
}

function traceCurrent(bitmap: RgbaBitmap): { svg: string; durationMs: number; strategy: string } {
  const base = getVTracerOptionsForPreset('logo');
  const resolution = resolveAdaptiveVTracerOptions('logo', bitmap, base);
  const startedAt = performance.now();
  const svg = convertPixels(bitmap.data, bitmap.width, bitmap.height, resolution.options);
  return { svg, durationMs: performance.now() - startedAt, strategy: resolution.effectiveStrategy };
}

describe('Region-First V3.1 synthetic comparison benchmark', () => {
  it('compares current adaptive VTracer with region-first on controlled structural cases', () => {
    const cases: Array<{ name: string; bitmap: RgbaBitmap; holes?: number }> = [
      { name: 'MONO_SIMPLE', bitmap: scaledAscii(['.....', '.###.', '.###.', '.###.', '.....']) },
      { name: 'LETTER_O', bitmap: scaledAscii(['#####', '#...#', '#...#', '#####']), holes: 1 },
      { name: 'LETTER_A', bitmap: scaledAscii(['.###.', '#####', '#...#', '#####', '#...#', '#...#']), holes: 1 },
      { name: 'SAME_COLOR_DISCONNECTED', bitmap: scaledAscii(['##..##', '##..##']) },
      { name: 'TWO_ADJACENT_COLORS', bitmap: scaledAscii(['RRBB', 'RRBB'], 12, { R: RED, B: BLUE }) },
      { name: 'THREE_SOLID_COLORS', bitmap: scaledAscii(['RRGGBB', 'RRGGBB'], 10, { R: RED, G: GREEN, B: BLUE }) },
      {
        name: 'ANTIALIAS_SYNTHETIC',
        bitmap: makeBitmap(96, 48, (x) => {
          if (x < 46) return RED;
          if (x === 46) return [226, 57, 57, 255];
          if (x === 47) return [235, 112, 112, 255];
          if (x === 48) return [242, 178, 177, 255];
          return WHITE;
        }),
      },
      {
        name: 'JPEG_LIKE',
        bitmap: makeBitmap(128, 64, (x, y) => {
          const base = x < 64 ? RED : WHITE;
          const blockNoise = ((((x >> 3) * 17 + (y >> 3) * 31) % 7) - 3) * 3;
          const fineNoise = ((x * 13 + y * 19) % 5) - 2;
          const noise = blockNoise + fineNoise;
          return [
            Math.max(0, Math.min(255, base[0] + noise)),
            Math.max(0, Math.min(255, base[1] + noise)),
            Math.max(0, Math.min(255, base[2] + noise)),
            255,
          ];
        }),
      },
      {
        name: 'NOISY_LOGO_COMPLEX',
        bitmap: makeBitmap(256, 256, (x, y) => {
          let color: Rgba = WHITE;
          if (x >= 28 && x <= 112 && y >= 44 && y <= 188) color = RED;
          const circleDistance = Math.hypot(x - 168, y - 128) - 58;
          if (circleDistance <= 0) color = BLUE;
          if (circleDistance > -2 && circleDistance < 2) {
            const blend = Math.max(0, Math.min(1, (2 - circleDistance) / 4));
            color = [
              Math.round(WHITE[0] * (1 - blend) + BLUE[0] * blend),
              Math.round(WHITE[1] * (1 - blend) + BLUE[1] * blend),
              Math.round(WHITE[2] * (1 - blend) + BLUE[2] * blend),
              255,
            ];
          }
          const blockNoise = ((((x >> 3) * 17 + (y >> 3) * 31) % 7) - 3) * 3;
          const fineNoise = ((x * 13 + y * 19) % 5) - 2;
          const noise = blockNoise + fineNoise;
          return [
            Math.max(0, Math.min(255, color[0] + noise)),
            Math.max(0, Math.min(255, color[1] + noise)),
            Math.max(0, Math.min(255, color[2] + noise)),
            255,
          ];
        }),
      },
      {
        name: 'SMALL_LEGITIMATE_DETAIL',
        bitmap: makeBitmap(64, 64, (x, y) => {
          if (x >= 8 && x < 48 && y >= 8 && y < 48) return RED;
          if (x === 56 && y === 56) return BLACK;
          return CLEAR;
        }),
      },
      { name: 'TRANSPARENCY', bitmap: scaledAscii(['.....', '.###.', '.###.', '.....'], 10) },
      {
        name: 'SEMI_TRANSPARENCY',
        bitmap: makeBitmap(48, 48, (x, y) => x >= 8 && x < 40 && y >= 8 && y < 40 ? [30, 80, 220, 128] : CLEAR),
      },
      {
        name: 'MULTIPLE_HOLES',
        bitmap: scaledAscii(['#########', '#..#...##', '#..#...##', '#########'], 8),
        holes: 2,
      },
    ];

    const rows = cases.map((benchmarkCase) => {
      const traced = traceCurrent(benchmarkCase.bitmap);
      const report = compareVTracerWithRegionFirst(
        benchmarkCase.bitmap,
        traced.svg,
        traced.durationMs,
        undefined,
        benchmarkCase.holes,
      );
      return {
        case: benchmarkCase.name,
        strategy: traced.strategy,
        vPaths: report.vtracer.rawPathCount,
        rObjects: report.regionFirst.experimentalObjectCount,
        vSubpaths: report.vtracer.subpathCount,
        rSubpaths: report.regionFirst.subpathCount,
        vNodes: report.vtracer.nodeCount,
        rNodes: report.regionFirst.nodeCount,
        vColors: report.vtracer.uniqueColors,
        rColors: report.regionFirst.uniqueColors,
        vMicro: report.vtracer.microObjectCount,
        rMicro: report.regionFirst.microObjectCount,
        vHoles: report.vtracer.preservedHoles,
        rHoles: report.regionFirst.preservedHoles,
        vBytes: report.vtracer.svgBytes,
        rBytes: report.regionFirst.svgBytes,
        vMs: Number(traced.durationMs.toFixed(3)),
        rMs: report.regionFirst.executionTimeMs,
        fragmentationRatio: report.fragmentationRatio,
        silhouetteAreaDiff: Number(report.fidelity.silhouetteAreaDifferenceRatio.toFixed(6)),
      };
    });

    console.log(`V31_BENCHMARK=${JSON.stringify(rows)}`);
    expect(rows.every((row) => row.fragmentationRatio === 1)).toBe(true);
    expect(rows.find((row) => row.case === 'LETTER_O')?.rHoles).toBe(1);
    expect(rows.find((row) => row.case === 'LETTER_A')?.rHoles).toBe(1);
    expect(rows.find((row) => row.case === 'MULTIPLE_HOLES')?.rHoles).toBe(2);
    expect(rows.find((row) => row.case === 'SMALL_LEGITIMATE_DETAIL')?.rObjects).toBe(2);
    expect(rows.find((row) => row.case === 'JPEG_LIKE')!.rObjects).toBeLessThan(
      rows.find((row) => row.case === 'JPEG_LIKE')!.vPaths,
    );
    const complexNoisy = rows.find((row) => row.case === 'NOISY_LOGO_COMPLEX')!;
    expect(complexNoisy.rObjects / complexNoisy.vPaths).toBeLessThanOrEqual(0.2);
  });
});
