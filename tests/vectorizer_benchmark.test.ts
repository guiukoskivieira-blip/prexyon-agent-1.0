import { describe, it, expect } from 'vitest';
import {
  VECTOR_BENCHMARK_CORPUS,
  extractGeometricMetrics,
  extractColorMetrics,
  extractTopologyMetrics,
  extractEditabilityMetrics,
  runVectorizationBenchmarkSuite,
  formatBenchmarkSuiteHumanReport,
  VectorBenchmarkCase,
} from '../src/core/vectorizer/benchmark';

describe('Vectorization Benchmark V2 — Hardened Metrics & Infrastructure (Etapa V2.2C)', () => {
  it('1. expectedHoleCount = 1 / true hole correto -> preservation = 1.0 (100%), unexpectedHoles = 0', () => {
    // Letra O: Círculo externo (raio 40 centrado em 50,50) + Círculo interno (raio 20 centrado em 50,50)
    const letterOSvg = `
      <svg viewBox="0 0 100 100">
        <path d="M 50 10 C 72 10 90 28 90 50 C 90 72 72 90 50 90 C 28 90 10 72 10 50 C 10 28 28 10 50 10 Z M 50 30 C 61 30 70 39 70 50 C 70 61 61 70 50 70 C 39 70 30 61 30 50 C 30 39 39 30 50 30 Z" fill="#000000" fill-rule="evenodd" />
      </svg>
    `;

    const topo = extractTopologyMetrics(letterOSvg);
    expect(topo.compoundPathCount).toBe(1);
    expect(topo.trueHoleCount).toBe(1);
    expect(topo.disconnectedIslandCount).toBe(1);
    expect(topo.stackedOcclusionCount).toBe(0);
    expect(topo.fillRuleExplicit).toBe(true);

    const testCase: VectorBenchmarkCase = {
      ...VECTOR_BENCHMARK_CORPUS[0],
      expectedHoleCount: 1,
    };
    const edit = extractEditabilityMetrics(topo, testCase);
    expect(edit.holePreservationRate).toBe(1.0);
    expect(edit.unexpectedHoleCount).toBe(0);
  });

  it('2. expectedHoleCount = 1 / trueHoleCount = 0 (ex: stacked paths) -> preservation = 0.0 (0%), unexpectedHoles = 0', () => {
    // Stacked paths (comportamento típico do VTracer V1)
    const stackedSvg = `
      <svg viewBox="0 0 100 100">
        <path d="M 50 10 C 72 10 90 28 90 50 C 90 72 72 90 50 90 C 28 90 10 72 10 50 C 10 28 28 10 50 10 Z" fill="#000000" />
        <path d="M 50 30 C 61 30 70 39 70 50 C 70 61 61 70 50 70 C 39 70 30 61 30 50 C 30 39 39 30 50 30 Z" fill="#FFFFFF" />
      </svg>
    `;

    const topo = extractTopologyMetrics(stackedSvg);
    expect(topo.compoundPathCount).toBe(0);
    expect(topo.trueHoleCount).toBe(0);
    expect(topo.stackedOcclusionCount).toBe(1);

    const testCase: VectorBenchmarkCase = {
      ...VECTOR_BENCHMARK_CORPUS[0],
      expectedHoleCount: 1,
    };
    const edit = extractEditabilityMetrics(topo, testCase);
    expect(edit.holePreservationRate).toBe(0.0);
    expect(edit.unexpectedHoleCount).toBe(0);
  });

  it('3. expectedHoleCount = 0 / trueHoleCount = 0 -> preservation = NOT_APPLICABLE, unexpectedHoles = 0', () => {
    // Retângulo simples
    const solidRectSvg = `<svg><path d="M 10 10 L 90 10 L 90 90 L 10 90 Z" fill="#000000" /></svg>`;
    const topo = extractTopologyMetrics(solidRectSvg);
    expect(topo.trueHoleCount).toBe(0);

    const testCase: VectorBenchmarkCase = {
      ...VECTOR_BENCHMARK_CORPUS[1],
      expectedHoleCount: 0,
    };
    const edit = extractEditabilityMetrics(topo, testCase);
    expect(edit.holePreservationRate).toBe('NOT_APPLICABLE');
    expect(edit.unexpectedHoleCount).toBe(0);
  });

  it('4. expectedHoleCount = 0 / trueHoleCount > 0 -> preservation = NOT_APPLICABLE + unexpectedHoleCount registrado', () => {
    // Path com furo inesperado
    const letterOSvg = `
      <svg viewBox="0 0 100 100">
        <path d="M 50 10 C 72 10 90 28 90 50 C 90 72 72 90 50 90 C 28 90 10 72 10 50 C 10 28 28 10 50 10 Z M 50 30 C 61 30 70 39 70 50 C 70 61 61 70 50 70 C 39 70 30 61 30 50 C 30 39 39 30 50 30 Z" fill="#000000" fill-rule="evenodd" />
      </svg>
    `;
    const topo = extractTopologyMetrics(letterOSvg);
    expect(topo.trueHoleCount).toBe(1);

    const testCase: VectorBenchmarkCase = {
      ...VECTOR_BENCHMARK_CORPUS[1],
      expectedHoleCount: 0,
    };
    const edit = extractEditabilityMetrics(topo, testCase);
    expect(edit.holePreservationRate).toBe('NOT_APPLICABLE');
    expect(edit.unexpectedHoleCount).toBe(1);
  });

  it('5. expectedHoleCount ausente (undefined/null) -> preservation = NOT_AVAILABLE, unexpectedHoles = NOT_AVAILABLE', () => {
    const letterOSvg = `
      <svg viewBox="0 0 100 100">
        <path d="M 50 10 C 72 10 90 28 90 50 C 90 72 72 90 50 90 C 28 90 10 72 10 50 C 10 28 28 10 50 10 Z M 50 30 C 61 30 70 39 70 50 C 70 61 61 70 50 70 C 39 70 30 61 30 50 C 30 39 39 30 50 30 Z" fill="#000000" fill-rule="evenodd" />
      </svg>
    `;
    const topo = extractTopologyMetrics(letterOSvg);

    const testCase: VectorBenchmarkCase = {
      ...VECTOR_BENCHMARK_CORPUS[0],
      expectedHoleCount: null,
    };
    const edit = extractEditabilityMetrics(topo, testCase);
    expect(edit.holePreservationRate).toBe('NOT_AVAILABLE');
    expect(edit.unexpectedHoleCount).toBe('NOT_AVAILABLE');
  });

  it('6. Cores únicas vs semanticColorGroupCount (NOT_AVAILABLE no V1)', () => {
    const multiColorSvg = `
      <svg viewBox="0 0 100 100">
        <path d="M 10 10 L 40 10 L 40 40 Z" fill="#E11D48" />
        <path d="M 50 10 L 80 10 L 80 40 Z" fill="#2563EB" />
        <path d="M 30 50 L 60 50 L 60 80 Z" fill="#F59E0B" />
      </svg>
    `;

    const colors = extractColorMetrics(multiColorSvg);
    expect(colors.uniqueFillColorCount).toBe(3);
    expect(colors.semanticColorGroupCount).toBe('NOT_AVAILABLE');
  });

  it('7. Execução completa da suite de benchmark com métricas hardened no baseline V1', async () => {
    const report = await runVectorizationBenchmarkSuite();

    expect(report.totalCases).toBe(8);
    expect(report.results).toHaveLength(8);

    // Valida que o CASE_01 (letra O) no Baseline V1 registra honestamente 0 true holes e holePreservationRate = 0%
    const case1 = report.results.find((r) => r.caseId === 'CASE_01_LOGO_MONO_TYPOGRAPHY');
    expect(case1).toBeDefined();
    if (case1) {
      expect(case1.current.topologyMetrics.trueHoleCount).toBe(0);
      expect(case1.current.topologyMetrics.stackedOcclusionCount).toBeGreaterThanOrEqual(1);
      expect(case1.current.editabilityMetrics.holePreservationRate).toBe(0.0);
      expect(case1.current.editabilityMetrics.unexpectedHoleCount).toBe(0);
    }

    // Valida que o CASE_02 (sem furos esperados) tem holePreservationRate = 'NOT_APPLICABLE'
    const case2 = report.results.find((r) => r.caseId === 'CASE_02_LOGO_GEOMETRIC');
    expect(case2).toBeDefined();
    if (case2) {
      expect(case2.current.editabilityMetrics.holePreservationRate).toBe('NOT_APPLICABLE');
      expect(case2.current.editabilityMetrics.unexpectedHoleCount).toBe(0);
    }

    // Valida que o CASE_04 (JPEG ruidoso) registra 5 cores únicas e classificação MODERATE
    const case4 = report.results.find((r) => r.caseId === 'CASE_04_LOGO_JPEG_NOISY');
    expect(case4).toBeDefined();
    if (case4) {
      expect(case4.current.colorMetrics.uniqueFillColorCount).toBeGreaterThanOrEqual(3);
      expect(case4.current.geometricMetrics.geometricCleanliness).toBe('MODERATE');
    }

    const humanReport = formatBenchmarkSuiteHumanReport(report);
    expect(humanReport).toContain('HARDENED BENCHMARK BASELINE');
    expect(humanReport).toContain('[GEOMETRY]');
    expect(humanReport).toContain('[COLOR]');
    expect(humanReport).toContain('[TOPOLOGY]');
    expect(humanReport).toContain('[EDIT]');
    expect(humanReport).toContain('[PERF]');
  }, 60000);
});
