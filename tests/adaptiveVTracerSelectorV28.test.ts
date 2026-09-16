import { describe, expect, it } from 'vitest';
import { analyzeArtwork } from '../src/core/vectorizer/v2/adaptivePreprocess';
import { VECTOR_BENCHMARK_CORPUS } from '../src/core/vectorizer/benchmark/corpus';
import {
  selectAdaptiveVTracerStrategy,
  selectAdaptiveVTracerStrategyFromAnalysis,
} from '../src/core/vectorizer/v2/adaptiveVTracerSelector';
import { runAdaptiveVTracerBenchmark } from '../src/core/vectorizer/benchmark/adaptiveVTracerBenchmark';

describe('V2.8 adaptive VTracer selector', () => {
  it('exposes deterministic analyzer signals for the benchmark corpus', () => {
    const first = VECTOR_BENCHMARK_CORPUS.map((benchmarkCase) => ({
      category: benchmarkCase.category,
      signals: analyzeArtwork(benchmarkCase.getBitmap()),
    }));
    const second = VECTOR_BENCHMARK_CORPUS.map((benchmarkCase) => ({
      category: benchmarkCase.category,
      signals: analyzeArtwork(benchmarkCase.getBitmap()),
    }));
    expect(first).toEqual(second);
    console.log(`V2_8_SIGNALS=${JSON.stringify(first)}`);
  });

  it('selects baseline for clean, multicolor and fine-detail rasters', () => {
    for (const category of ['LOGO_GEOMETRIC', 'LOGO_MULTICOLOR', 'LOGO_FINE_DETAILS']) {
      const benchmarkCase = VECTOR_BENCHMARK_CORPUS.find((item) => item.category === category)!;
      expect(selectAdaptiveVTracerStrategy(benchmarkCase.getBitmap()).strategy).toBe('BASELINE_LOGO');
    }
  });

  it('selects NOISY_LOGO only when JPEG-like evidence is jointly present', () => {
    const noisyCase = VECTOR_BENCHMARK_CORPUS.find((item) => item.category === 'LOGO_JPEG_NOISY')!;
    const decision = selectAdaptiveVTracerStrategy(noisyCase.getBitmap());
    expect(decision.strategy).toBe('NOISY_LOGO');
    expect(decision.evidence).toMatchObject({
      sustainedNoise: true,
      elevatedColorPressure: true,
      denseEdges: true,
      opaqueRaster: true,
    });
  });

  it('uses baseline for alpha rasters even when their RGB data resembles JPEG noise', () => {
    const noisyCase = VECTOR_BENCHMARK_CORPUS.find((item) => item.category === 'LOGO_JPEG_NOISY')!;
    const bitmap = noisyCase.getBitmap();
    bitmap.data[3] = 128;
    expect(selectAdaptiveVTracerStrategy(bitmap).strategy).toBe('BASELINE_LOGO');
  });

  it('falls back to baseline for inconclusive or invalid signals', () => {
    expect(selectAdaptiveVTracerStrategyFromAnalysis({
      width: 128,
      height: 128,
      pixelCount: 16_384,
      alphaPresence: false,
      approximateColorPressure: 13,
      edgeDensity: 0.12,
      noiseIndicator: 0,
    }).strategy).toBe('BASELINE_LOGO');
    expect(selectAdaptiveVTracerStrategyFromAnalysis({
      width: 0,
      height: 0,
      pixelCount: 0,
      alphaPresence: false,
      approximateColorPressure: 0,
      edgeDensity: Number.NaN,
      noiseIndicator: Number.NaN,
    }).reason).toBe('INCONCLUSIVE_SIGNALS');
  });

  it('is deterministic', () => {
    const noisyCase = VECTOR_BENCHMARK_CORPUS.find((item) => item.category === 'LOGO_JPEG_NOISY')!;
    expect(selectAdaptiveVTracerStrategy(noisyCase.getBitmap())).toEqual(selectAdaptiveVTracerStrategy(noisyCase.getBitmap()));
  });

  it('benchmarks baseline, always-noisy and adaptive strategies on all eight cases', async () => {
    const report = await runAdaptiveVTracerBenchmark(VECTOR_BENCHMARK_CORPUS);
    expect(report).toHaveLength(8);
    expect(report.find((row) => row.category === 'LOGO_JPEG_NOISY')?.selectedStrategy).toBe('NOISY_LOGO');
    expect(report.filter((row) => row.category !== 'LOGO_JPEG_NOISY').every((row) => row.selectedStrategy === 'BASELINE_LOGO')).toBe(true);
    for (const row of report) {
      expect(row.adaptive.totalPaths).toBeLessThanOrEqual(row.baseline.totalPaths);
      expect(row.adaptive.microObjectCount).toBeLessThanOrEqual(row.baseline.microObjectCount);
      expect(row.adaptive.trueHoleCount).toBe(row.baseline.trueHoleCount);
      expect(row.adaptive.unexpectedHoleCount).toBe(row.baseline.unexpectedHoleCount);
      expect(row.adaptive.uniqueFillColorCount).toBeLessThanOrEqual(row.baseline.uniqueFillColorCount);
    }
    const multicolor = report.find((row) => row.category === 'LOGO_MULTICOLOR')!;
    const fineDetails = report.find((row) => row.category === 'LOGO_FINE_DETAILS')!;
    expect(multicolor.adaptive.uniqueFillColorCount).toBe(multicolor.baseline.uniqueFillColorCount);
    expect(fineDetails.adaptive).toMatchObject({
      totalPaths: fineDetails.baseline.totalPaths,
      totalNodes: fineDetails.baseline.totalNodes,
      subpathCount: fineDetails.baseline.subpathCount,
    });
    console.log(`V2_8_BENCHMARK=${JSON.stringify(report)}`);
  }, 60_000);
});
