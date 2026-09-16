import { describe, expect, it } from 'vitest';
import { postprocessVTracerSvg } from '../src/core/vectorizer/v2/geometricPostprocessor';
import { runVectorizationBenchmarkSuite } from '../src/core/vectorizer/benchmark';
import { VECTOR_BENCHMARK_CORPUS } from '../src/core/vectorizer/benchmark/corpus';

describe('V2.6 conservative geometric postprocessor', () => {
  it('removes duplicate and nearly-collinear line nodes without changing corners or topology', () => {
    const input = '<svg viewBox="0 0 100 100"><path fill="#123456" fill-rule="evenodd" d="M0 0 L10 0 L10 0 L20 0.001 L20 10 Z M30 30 L40 30 L40 40 Z"/></svg>';
    const result = postprocessVTracerSvg(input);

    expect(result.removedNodeCount).toBe(2);
    expect(result.svg).toContain('fill="#123456"');
    expect(result.svg).toContain('fill-rule="evenodd"');
    expect(result.svg.match(/M/g)).toHaveLength(2);
    expect(result.svg.match(/Z/g)).toHaveLength(2);
    expect(result.svg).toContain('L20 10');
  });

  it('preserves hairlines and leaves unsupported curve geometry byte-for-byte intact', () => {
    const hairline = '<svg width="100" height="100"><path stroke="#000" d="M0 0 L0.01 0 L0.01 10"/><path d="M1 1 C2 2 3 3 4 4 Z"/></svg>';
    const result = postprocessVTracerSvg(hairline);

    expect(result.svg).toBe(hairline);
    expect(result.removedNodeCount).toBe(0);
  });
});

it('compara V1 e V2.6 no gate reduzido sem alterar o pipeline produtivo', async () => {
  const selectedCases = [0, 1, 3, 4, 7].map((index) => VECTOR_BENCHMARK_CORPUS[index]);
  const report = await runVectorizationBenchmarkSuite({ cases: selectedCases, includeV26: true });
  expect(report.results).toHaveLength(5);
  expect(report.results.every((result) => result.v26 !== 'NOT_AVAILABLE')).toBe(true);
  const rows = report.results.map((result) => {
    const v26 = result.v26 === 'NOT_AVAILABLE' ? result.current : result.v26;
    const pick = (value: typeof result.current) => ({
      paths: value.geometricMetrics.totalPaths,
      nodes: value.geometricMetrics.totalNodes,
      micro: value.geometricMetrics.microObjectCount,
      trueHoles: value.topologyMetrics.trueHoleCount,
      unexpectedHoles: value.editabilityMetrics.unexpectedHoleCount,
      cleanliness: value.geometricMetrics.geometricCleanliness,
      bytes: value.geometricMetrics.svgSizeBytes,
      ms: value.geometricMetrics.executionTimeMs,
      subpaths: value.geometricMetrics.totalSubpaths,
      colors: value.colorMetrics.uniqueFillColorCount,
    });
    return { id: result.caseId, category: result.category, v1: pick(result.current), v26: pick(v26) };
  });
  console.log(`V2_6_REDUCED=${JSON.stringify(rows)}`);
}, 60000);
