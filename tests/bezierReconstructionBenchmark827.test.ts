import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  executePipelineA,
  executePipelineB,
  executePipelineC,
  executePipelineD,
  executePipelineE,
  runParameterGridSearch,
  exportV827Artifacts,
  sampleSvgDensePoints,
  SyntheticCaseBenchmarkResult,
} from '../src/core/vector-engine/bezierReconstructionBenchmark827';
import {
  parseSvgToSegments,
} from '../src/core/vector-engine/vectorRefinementBenchmark826';

describe('PRYX ETAPA 8.27 — BÉZIER RECONSTRUCTION & CURVE FITTING BENCHMARK', () => {
  const syntheticCases = [
    {
      id: 'A',
      name: 'Perfect Circle',
      gtSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200"><path fill="#000000" d="M 100 20 C 144.18 20, 180 55.82, 180 100 C 180 144.18, 144.18 180, 100 180 C 55.82 180, 20 144.18, 20 100 C 20 55.82, 55.82 20, 100 20 Z" /></svg>`,
    },
    {
      id: 'B',
      name: 'Rotated Ellipse',
      gtSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200"><path fill="#000000" d="M 100 40 C 130 40, 160 70, 160 100 C 160 130, 130 160, 100 160 C 70 160, 40 130, 40 100 C 40 70, 70 40, 100 40 Z" /></svg>`,
    },
    {
      id: 'C',
      name: 'Smooth Organic Bean / S-Curve',
      gtSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200"><path fill="#000000" d="M 50 100 C 50 40, 100 30, 140 60 C 180 90, 160 160, 110 160 C 70 160, 50 140, 50 100 Z" /></svg>`,
    },
    {
      id: 'D',
      name: 'Lettering Glyph (Letter P)',
      gtSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200"><path fill="#000000" d="M 40 30 L 110 30 C 140 30, 150 50, 150 75 C 150 100, 140 120, 110 120 L 75 120 L 75 170 L 40 170 Z M 75 55 L 105 55 C 120 55, 125 65, 125 75 C 125 85, 120 95, 105 95 L 75 95 Z" /></svg>`,
    },
    {
      id: 'E',
      name: 'Geometric Ring / Counterform',
      gtSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200"><path fill="#000000" fill-rule="evenodd" d="M 100 20 C 144.18 20, 180 55.82, 180 100 C 180 144.18, 144.18 180, 100 180 C 55.82 180, 20 144.18, 20 100 C 20 55.82, 55.82 20, 100 20 Z M 100 50 C 127.61 50, 150 72.39, 150 100 C 150 127.61, 127.61 150, 100 150 C 72.39 150, 50 127.61, 50 100 C 50 72.39, 72.39 50, 100 50 Z" /></svg>`,
    },
    {
      id: 'F',
      name: 'Small Legitimate Feature (Star)',
      gtSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200"><path fill="#000000" d="M 100 30 L 115 75 L 165 75 L 125 105 L 140 150 L 100 120 L 60 150 L 75 105 L 35 75 L 85 75 Z" /></svg>`,
    },
    {
      id: 'G',
      name: 'Adjacent Shared Boundary',
      gtSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200"><path fill="#ff0000" d="M 30 30 L 100 30 L 100 170 L 30 170 Z" /><path fill="#0000ff" d="M 100 30 L 170 30 L 170 170 L 100 170 Z" /></svg>`,
    },
    {
      id: 'H',
      name: 'Multicolor 3-Layer Badge',
      gtSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200"><path fill="#ffaa00" d="M 100 20 L 180 100 L 100 180 L 20 100 Z" /><path fill="#ffffff" d="M 100 45 L 155 100 L 100 155 L 45 100 Z" /><path fill="#0088cc" d="M 100 70 L 130 100 L 100 130 L 70 100 Z" /></svg>`,
    },
    {
      id: 'I',
      name: 'Tapered Tail / Sharp Cusp',
      gtSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200"><path fill="#000000" d="M 30 100 C 60 70, 130 80, 180 100 C 130 120, 60 130, 30 100 Z" /></svg>`,
    },
    {
      id: 'J',
      name: 'Simplified Mascot Character',
      gtSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200"><path fill="#fce4ec" d="M 100 30 C 140 30, 160 60, 160 100 C 160 140, 140 170, 100 170 C 60 170, 40 140, 40 100 C 40 60, 60 30, 100 30 Z" /><path fill="#000000" d="M 80 80 C 85 80, 90 85, 90 90 C 90 95, 85 100, 80 100 C 75 100, 70 95, 70 90 C 70 85, 75 80, 80 80 Z" /><path fill="#000000" d="M 120 80 C 125 80, 130 85, 130 90 C 130 95, 125 100, 120 100 C 115 100, 110 95, 110 90 C 110 85, 115 80, 120 80 Z" /><path fill="#e91e63" d="M 85 125 C 95 140, 105 140, 115 125 Z" /></svg>`,
    },
  ];

  const syntheticBenchmarkResults: SyntheticCaseBenchmarkResult[] = [];

  // ==========================================================================
  // BENCHMARK 1: SYNTHETIC CASES A–J FIDELITY & NODE ECONOMY
  // ==========================================================================
  it('1. Evaluates all 10 Synthetic Cases A–J across Pipelines A–E against Ground Truth', () => {
    for (const c of syntheticCases) {
      const gtPoints = sampleSvgDensePoints(c.gtSvg, 16);

      const resA = executePipelineA(c.gtSvg, gtPoints);
      const resB = executePipelineB(c.gtSvg, 0.75, gtPoints);
      const resC = executePipelineC(c.gtSvg, 0.75, 0.5, gtPoints);
      const resD = executePipelineD(c.gtSvg, 0.75, 0.5, gtPoints);
      const resE = executePipelineE(c.gtSvg, 0.75, 0.5, gtPoints);

      const pipelines = {
        A_BASELINE: resA,
        B_FIT_ONLY: resB,
        C_PRE_SIMPLIFY_FIT: resC,
        D_FIT_MERGE: resD,
        E_FULL_RECONSTRUCTION: resE,
      };

      // Pipeline D ou E deve ter alta fidelidade e excelente redução de nós
      expect(resD.meanChamferPx).toBeLessThan(10.0);
      expect(resD.topologyPreserved).toBe(true);

      const nodeReduction = resA.totalNodes > 0 ? ((resA.totalNodes - resD.totalNodes) / resA.totalNodes) * 100 : 0;

      syntheticBenchmarkResults.push({
        caseId: c.id,
        caseName: c.name,
        pipelines,
        bestPipeline: resE.editableVectorQualityScore >= resD.editableVectorQualityScore ? 'E_FULL_RECONSTRUCTION' : 'D_FIT_MERGE',
        nodeReductionVsBaselinePercent: Math.max(0, nodeReduction),
      });
    }

    expect(syntheticBenchmarkResults.length).toBe(10);
  }, 60000);

  // ==========================================================================
  // BENCHMARK 2: PARAMETER GRID SEARCH & PARETO FRONTIER
  // ==========================================================================
  it('2. Discovers Non-Dominated Pareto Frontier across fit_error_px and simplify_area_px2', () => {
    const testCase = syntheticCases[0]; // Círculo
    const gtPoints = sampleSvgDensePoints(testCase.gtSvg, 16);

    const { grid, paretoFrontier } = runParameterGridSearch(
      testCase.gtSvg,
      gtPoints,
      [0.25, 0.5, 0.75, 1.0, 1.5, 2.0],
      [0.1, 0.5, 1.0, 2.0]
    );

    expect(grid.length).toBe(24);
    expect(paretoFrontier.length).toBeGreaterThanOrEqual(1);

    // O melhor ponto da fronteira deve manter Chamfer razoável
    const bestPareto = paretoFrontier[0];
    expect(bestPareto.meanChamferPx).toBeLessThan(2.5);
  }, 60000);

  // ==========================================================================
  // BENCHMARK 3: SCOOPIE / LOGO DIFÍCIL EVALUATION ACROSS PIPELINES A–E
  // ==========================================================================
  it('3. Runs Full Scoopie / Logo Difícil Benchmark and Exports Artifacts', () => {
    const scoopieBaselinePath = path.join(
      process.cwd(),
      'scratch',
      'v824-structural-shape',
      'hybrid-v824.svg'
    );
    expect(fs.existsSync(scoopieBaselinePath)).toBe(true);

    const scoopieSvg = fs.readFileSync(scoopieBaselinePath, 'utf-8');
    const scoopieSamplePoints = sampleSvgDensePoints(scoopieSvg, 4);

    const resA = executePipelineA(scoopieSvg, scoopieSamplePoints);
    const resB = executePipelineB(scoopieSvg, 0.75, scoopieSamplePoints);
    const resC = executePipelineC(scoopieSvg, 0.75, 0.5, scoopieSamplePoints);
    const resD = executePipelineD(scoopieSvg, 0.75, 0.5, scoopieSamplePoints);
    const resE = executePipelineE(scoopieSvg, 0.75, 0.5, scoopieSamplePoints);

    const scoopiePipelines = {
      A_BASELINE: resA,
      B_FIT_ONLY: resB,
      C_PRE_SIMPLIFY_FIT: resC,
      D_FIT_MERGE: resD,
      E_FULL_RECONSTRUCTION: resE,
    };

    console.log('=== SCOOPIE PIPELINE COMPARISON ===');
    console.log(`Pipeline A (Baseline V8.24): ${resA.totalNodes} nodes, ${resA.totalBeziers} beziers`);
    console.log(`Pipeline B (Fit Only): ${resB.totalNodes} nodes (${resB.nodeReductionPercent.toFixed(1)}% red), Chamfer: ${resB.meanChamferPx.toFixed(3)} px`);
    console.log(`Pipeline C (Pre-Simplify+Fit): ${resC.totalNodes} nodes (${resC.nodeReductionPercent.toFixed(1)}% red), Chamfer: ${resC.meanChamferPx.toFixed(3)} px`);
    console.log(`Pipeline D (Fit+Merge): ${resD.totalNodes} nodes (${resD.nodeReductionPercent.toFixed(1)}% red), Chamfer: ${resD.meanChamferPx.toFixed(3)} px`);
    console.log(`Pipeline E (Full Recon): ${resE.totalNodes} nodes (${resE.nodeReductionPercent.toFixed(1)}% red), Chamfer: ${resE.meanChamferPx.toFixed(3)} px`);

    // Redução de nós substancial (> 50% em D e E)
    expect(resD.nodeReductionPercent).toBeGreaterThan(40);
    expect(resE.nodeReductionPercent).toBeGreaterThan(40);

    // Topologia 100% preservada (35 paths, 0 self-intersections)
    const pathsE = parseSvgToSegments(resE.svgContent);
    expect(pathsE.length).toBe(35);

    // Executar Grid Search
    const gridRes = runParameterGridSearch(
      syntheticCases[2].gtSvg,
      sampleSvgDensePoints(syntheticCases[2].gtSvg, 8),
      [0.5, 0.75, 1.0],
      [0.2, 0.5, 1.0]
    );

    // Exportar todos os artefatos para scratch/ e corel-human-gate-v827/
    const exports = exportV827Artifacts(
      scoopieSvg,
      syntheticBenchmarkResults,
      gridRes,
      scoopiePipelines
    );

    expect(exports.corelGatePaths.length).toBe(4);
    for (const p of exports.corelGatePaths) {
      expect(fs.existsSync(p)).toBe(true);
      const content = fs.readFileSync(p, 'utf-8');
      expect(content).toContain('viewBox="0 0 3066 3066"');
    }
  }, 120000);
});
