/**
 * Prexyon Vectorization Engine V2 — Benchmark Runner (Etapa V2.2B)
 *
 * Executa a suite completa de benchmark sobre os 8 casos do corpus
 * utilizando o pipeline atual (Baseline V1) e gera relatórios comparativos multidimensionais.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { VECTOR_BENCHMARK_CORPUS } from './corpus';
import { evaluateBenchmarkCase } from './metrics';
import {
  BenchmarkSuiteReport,
  ComparativeCaseResult,
  VectorBenchmarkCase,
} from './types';
import { VTracerWasmInstance, VTracerOptions } from '../vtracerWasmCore';
import { getVTracerOptionsForPreset } from '../presets';
import { preprocessLogo } from '../v2/adaptivePreprocess';
import { traceColorMasks } from '../v2/maskTracing';
import { postprocessVTracerSvg } from '../v2/geometricPostprocessor';

/**
 * Carrega a instância WASM do VTracer no ambiente Node / Vitest.
 */
export async function createNodeVTracerInstance(): Promise<VTracerWasmInstance> {
  const instance = new VTracerWasmInstance();
  const possiblePaths = [
    path.resolve(process.cwd(), 'node_modules/@visioncortex/vtracer/pkg/vtracer_wasm_bg.wasm'),
    path.resolve(__dirname, '../../../../node_modules/@visioncortex/vtracer/pkg/vtracer_wasm_bg.wasm'),
    path.resolve(__dirname, '../../../node_modules/@visioncortex/vtracer/pkg/vtracer_wasm_bg.wasm'),
  ];

  let wasmBuffer: Buffer | null = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      wasmBuffer = fs.readFileSync(p);
      break;
    }
  }

  if (!wasmBuffer) {
    throw new Error('Binário vtracer_wasm_bg.wasm não encontrado nos caminhos padrão.');
  }

  await instance.init(wasmBuffer.buffer.slice(wasmBuffer.byteOffset, wasmBuffer.byteOffset + wasmBuffer.byteLength));
  return instance;
}

export interface RunSuiteOptions {
  wasmInstance?: VTracerWasmInstance;
  preset?: 'logo' | 'detailed' | 'simple';
  customOptions?: VTracerOptions;
  cases?: VectorBenchmarkCase[];
  includeV26?: boolean;
}

/**
 * Executa a suite de benchmark completa e retorna o relatório estruturado.
 */
export async function runVectorizationBenchmarkSuite(
  options: RunSuiteOptions = {}
): Promise<BenchmarkSuiteReport> {
  const wasmInstance = options.wasmInstance || (await createNodeVTracerInstance());
  const cases = options.cases || VECTOR_BENCHMARK_CORPUS;
  const vtracerOptions = options.customOptions || getVTracerOptionsForPreset(options.preset || 'logo');

  const comparativeResults: ComparativeCaseResult[] = [];
  let totalExecutionTimeMs = 0;
  let totalPathsCurrent = 0;
  let totalNodesCurrent = 0;
  let sumMicroRatio = 0;

  for (const bCase of cases) {
    const bmp = bCase.getBitmap();

    const startTime = performance.now();
    let svgString = '';
    try {
      svgString = wasmInstance.vectorizeRgba(bmp.data, bmp.width, bmp.height, vtracerOptions);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      svgString = `<svg viewBox="0 0 ${bmp.width} ${bmp.height}"><!-- Error: ${errMsg} --></svg>`;
    }
    const durationMs = Math.max(1, Math.round(performance.now() - startTime));

    const currentResult = evaluateBenchmarkCase(bCase, svgString, durationMs, 'CURRENT_V1');

    let geometricResult: ReturnType<typeof evaluateBenchmarkCase> | 'NOT_AVAILABLE' = 'NOT_AVAILABLE';
    if (options.includeV26) {
      const geometricStartTime = performance.now();
      const geometricSvg = postprocessVTracerSvg(svgString).svg;
      const geometricDurationMs = durationMs + Math.max(0, Math.round(performance.now() - geometricStartTime));
      geometricResult = evaluateBenchmarkCase(bCase, geometricSvg, geometricDurationMs, 'V2_GEOMETRIC_POSTPROCESSING');
    }

    const preprocessed = preprocessLogo(bmp);
    const pocInput = preprocessed.bitmap;
    const pocStartTime = performance.now();
    let pocSvg = '';
    try {
      pocSvg = wasmInstance.vectorizeRgba(pocInput.data, pocInput.width, pocInput.height, vtracerOptions);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      pocSvg = `<svg viewBox="0 0 ${bmp.width} ${bmp.height}"><!-- Error: ${errMsg} --></svg>`;
    }
    const pocDurationMs = Math.max(1, Math.round(performance.now() - pocStartTime));
    const pocResult = evaluateBenchmarkCase(bCase, pocSvg, pocDurationMs, 'V2_CANDIDATE');

    const maskStartTime = performance.now();
    const maskTrace = traceColorMasks(bmp.width, bmp.height, preprocessed.masks, (rgba, width, height) =>
      wasmInstance.vectorizeRgba(rgba, width, height, vtracerOptions)
    );
    const maskDurationMs = Math.max(1, Math.round(performance.now() - maskStartTime));
    const maskResult = evaluateBenchmarkCase(bCase, maskTrace.svg, maskDurationMs, 'V2_MASK_TRACING');

    totalExecutionTimeMs += durationMs;
    totalPathsCurrent += currentResult.geometricMetrics.totalPaths;
    totalNodesCurrent += currentResult.geometricMetrics.totalNodes;
    sumMicroRatio += currentResult.geometricMetrics.microObjectRatio;

    comparativeResults.push({
      caseId: bCase.id,
      caseName: bCase.name,
      category: bCase.category,
      current: currentResult,
      v2: pocResult,
      v24: maskResult,
      v26: geometricResult,
      reference: 'NOT_AVAILABLE',
    });
  }

  const avgExecutionTimeMs = Number((totalExecutionTimeMs / cases.length).toFixed(1));
  const avgMicroObjectRatio = Number((sumMicroRatio / cases.length).toFixed(4));

  return {
    timestamp: new Date().toISOString(),
    engineVersion: 'Prexyon Vectorization Baseline (VTracer WASM v0.6.4)',
    totalCases: cases.length,
    results: comparativeResults,
    summary: {
      totalExecutionTimeMs,
      totalPathsCurrent,
      totalNodesCurrent,
      avgExecutionTimeMs,
      avgMicroObjectRatio,
    },
  };
}

/**
 * Formata o relatório para exibição humana clara e estruturada por dimensões.
 */
export function formatBenchmarkSuiteHumanReport(report: BenchmarkSuiteReport): string {
  const lines: string[] = [];
  lines.push('================================================================================');
  lines.push('       PREXYON VECTORIZATION ENGINE V2 — HARDENED BENCHMARK BASELINE');
  lines.push('================================================================================');
  lines.push(`Timestamp: ${report.timestamp}`);
  lines.push(`Engine:    ${report.engineVersion}`);
  lines.push(`Casos:     ${report.totalCases}`);
  lines.push('--------------------------------------------------------------------------------');

  for (const res of report.results) {
    const c = res.current;
    const g = c.geometricMetrics;
    const col = c.colorMetrics;
    const t = c.topologyMetrics;
    const e = c.editabilityMetrics;
    const p = c.multidimensionalReport.performance;

    lines.push(`CASE: [${res.caseId}] ${res.caseName}`);
    lines.push(`CATEGORY: ${res.category}`);
    lines.push('CURRENT (V1 Baseline):');
    lines.push(`  [GEOMETRY] paths: ${g.totalPaths} (subpaths: ${g.totalSubpaths}) | nodes: ${g.totalNodes} (${g.totalPaths > 0 ? (g.totalNodes / g.totalPaths).toFixed(1) : 0} n/p) | closed: ${(g.closedPathRatio * 100).toFixed(0)}% | speckles: ${g.microObjectCount} | cleanliness: ${g.geometricCleanliness}`);
    lines.push(`  [COLOR]    uniqueFillColors: ${col.uniqueFillColorCount} | semanticGroups: ${col.semanticColorGroupCount}`);
    lines.push(`  [TOPOLOGY] compoundPaths: ${t.compoundPathCount} | trueHoles: ${t.trueHoleCount} | islands: ${t.disconnectedIslandCount} | stackedOcclusions: ${t.stackedOcclusionCount} | fillRuleExplicit: ${t.fillRuleExplicit}`);
    lines.push(`  [EDIT]     semanticObjects: ${e.semanticObjectCount} | colorSeparation: ${e.colorLayerSeparation} | holePreservation: ${typeof e.holePreservationRate === 'number' ? (e.holePreservationRate * 100).toFixed(0) + '%' : e.holePreservationRate}${typeof e.unexpectedHoleCount === 'number' && e.unexpectedHoleCount > 0 ? ` | unexpectedHoles: ${e.unexpectedHoleCount}` : ''}`);
    lines.push(`  [PERF]     time: ${g.executionTimeMs} ms | svgSize: ${p.svgSizeKb} KB (${g.svgSizeBytes} bytes) | throughput: ${p.throughputKpixelsPerSec} kpx/s`);
    lines.push('V2 CANDIDATE:');
    lines.push('  - not_available');
    lines.push('REFERENCE:');
    lines.push('  - not_available');
    lines.push('--------------------------------------------------------------------------------');
  }

  lines.push('RESUMO GERAL DO BASELINE V1:');
  lines.push(`  - Tempo Total de Execução: ${report.summary.totalExecutionTimeMs} ms (média: ${report.summary.avgExecutionTimeMs} ms/caso)`);
  lines.push(`  - Total de Caminhos:       ${report.summary.totalPathsCurrent}`);
  lines.push(`  - Total de Nós:            ${report.summary.totalNodesCurrent}`);
  lines.push(`  - Proporção Média Speckle: ${(report.summary.avgMicroObjectRatio * 100).toFixed(2)}%`);
  lines.push('================================================================================');

  return lines.join('\n');
}
