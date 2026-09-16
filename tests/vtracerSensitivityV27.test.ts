import { describe, expect, it } from 'vitest';
import { VECTOR_BENCHMARK_CORPUS } from '../src/core/vectorizer/benchmark/corpus';
import {
  VTRACER_SENSITIVITY_VARIANTS,
  runVTracerSensitivityBenchmark,
} from '../src/core/vectorizer/benchmark/vtracerSensitivity';

describe('V2.7 VTracer parameter sensitivity POC', () => {
  it('defines exactly three causal experimental variants without changing the baseline preset', () => {
    expect(Object.keys(VTRACER_SENSITIVITY_VARIANTS)).toEqual([
      'CLEAN_LOGO',
      'NOISY_LOGO',
      'DETAIL_PRESERVE',
    ]);
    expect(VTRACER_SENSITIVITY_VARIANTS.CLEAN_LOGO.options.filterSpeckle).toBeGreaterThan(8);
    expect(VTRACER_SENSITIVITY_VARIANTS.NOISY_LOGO.options.colorPrecision).toBeLessThan(7);
    expect(VTRACER_SENSITIVITY_VARIANTS.DETAIL_PRESERVE.options.filterSpeckle).toBeLessThan(8);
  });

  it('benchmarks baseline and all variants on the reduced corpus', async () => {
    const categories = new Set([
      'LOGO_GEOMETRIC',
      'LOGO_MULTICOLOR',
      'LOGO_JPEG_NOISY',
      'LOGO_FINE_DETAILS',
      'COMPLEX_BADGE',
    ]);
    const cases = VECTOR_BENCHMARK_CORPUS.filter((benchmarkCase) => categories.has(benchmarkCase.category));
    const report = await runVTracerSensitivityBenchmark(cases);

    expect(report).toHaveLength(5);
    expect(report.every((row) => Object.keys(row.variants).length === 3)).toBe(true);
    const byCategory = Object.fromEntries(report.map((row) => [row.category, row]));
    const noisy = byCategory.LOGO_JPEG_NOISY;
    const noisyVariant = noisy.variants.NOISY_LOGO;
    expect(noisyVariant.totalNodes < noisy.baseline.totalNodes || noisyVariant.totalPaths < noisy.baseline.totalPaths).toBe(true);
    expect(noisyVariant.unexpectedHoleCount).toBe(noisy.baseline.unexpectedHoleCount);
    expect(noisyVariant.microObjectCount).toBeLessThanOrEqual(noisy.baseline.microObjectCount);
    expect(noisyVariant.svgSizeBytes).toBeLessThan(noisy.baseline.svgSizeBytes);
    for (const category of ['LOGO_GEOMETRIC', 'LOGO_MULTICOLOR', 'LOGO_FINE_DETAILS'] as const) {
      const row = byCategory[category];
      const variant = row.variants.NOISY_LOGO;
      expect(variant.uniqueFillColorCount).toBe(row.baseline.uniqueFillColorCount);
      expect(variant.trueHoleCount).toBe(row.baseline.trueHoleCount);
      expect(variant.subpathCount).toBe(row.baseline.subpathCount);
    }
    console.log(`V2_7_REDUCED=${JSON.stringify(report)}`);
  }, 60_000);

  it('benchmarks the passing variant set on the complete eight-case corpus', async () => {
    const report = await runVTracerSensitivityBenchmark(VECTOR_BENCHMARK_CORPUS);
    expect(report).toHaveLength(8);
    console.log(`V2_7_COMPLETE=${JSON.stringify(report)}`);
  }, 60_000);
});
