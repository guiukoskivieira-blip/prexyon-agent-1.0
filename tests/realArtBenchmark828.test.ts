/**
 * PRYX — ETAPA 8.28
 * REAL ART RANDOMIZED VECTOR QUALITY BENCHMARK — 10 ARTES
 *
 * Test suite to execute the 10-art benchmark, validate metrics, export CorelDRAW bundles and OVERVIEW.html.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  ELIGIBLE_REAL_ARTS,
  runRealArtBenchmark,
  exportHumanGateArtifacts,
  ArtBenchmarkResult,
} from '../src/core/vector-engine/realArtBenchmark828';

describe('PRYX ETAPA 8.28 — REAL ART RANDOMIZED VECTOR QUALITY BENCHMARK', () => {
  const root = path.resolve(__dirname, '..');
  const scratchDir = path.resolve(root, 'scratch/v828-real-art-benchmark');

  it('1. Confirms 10 deterministic randomly selected arts', () => {
    expect(ELIGIBLE_REAL_ARTS.length).toBe(10);
    const ids = ELIGIBLE_REAL_ARTS.map(a => a.id);
    expect(ids).toEqual([
      '04-neuza',
      'case-b',
      '07-urban-bite',
      '03-black-face',
      '06-velvette',
      '05-gela-tony',
      '01-berryvibe',
      'case-a',
      'logo-dificil',
      '10-logo-colorida',
    ]);
  });

  it('2. Executes benchmark across all 10 real arts and generates full comparison matrix', () => {
    if (!fs.existsSync(scratchDir)) {
      fs.mkdirSync(scratchDir, { recursive: true });
    }

    const results: ArtBenchmarkResult[] = [];

    console.log('\n======================================================');
    console.log('PRYX ETAPA 8.28: REAL ART QUALITY BENCHMARK (10 ARTS)');
    console.log('======================================================');

    for (const art of ELIGIBLE_REAL_ARTS) {
      const res = runRealArtBenchmark(art, root);
      results.push(res);

      console.log(`\n--- [${res.art.id}] ${res.art.name} (${res.art.category}) ---`);
      console.log(`  Historical Best: ${res.historicalBest.nodeCount} nodes | Mean Chamfer: ${res.historicalBest.meanChamferPx.toFixed(2)}px | G1: ${res.historicalBest.g1Discontinuities}`);
      console.log(`  New Best (${res.selectedNewBest.candidateLabel}): ${res.selectedNewBest.nodeCount} nodes (${res.nodeDeltaPercent > 0 ? '+' : ''}${res.nodeDeltaPercent.toFixed(1)}%) | Mean Chamfer: ${res.selectedNewBest.meanChamferPx.toFixed(2)}px | G1: ${res.selectedNewBest.g1Discontinuities}`);
      console.log(`  Verdict: ${res.verdict} | Corel Required: ${res.corelRequired}`);
      console.log(`  Rationale: ${res.verdictRationale}`);

      // Basic sanity checks
      expect(res.selectedNewBest.nodeCount).toBeGreaterThan(0);
      expect(res.selectedNewBest.meanChamferPx).toBeLessThan(50.0);
    }

    // Export JSON reports
    const metricsJsonPath = path.join(scratchDir, 'real-art-metrics.json');
    fs.writeFileSync(
      metricsJsonPath,
      JSON.stringify(
        results.map(r => ({
          id: r.art.id,
          name: r.art.name,
          category: r.art.category,
          historicalBest: {
            label: r.historicalBest.candidateLabel,
            nodes: r.historicalBest.nodeCount,
            beziers: r.historicalBest.bezierCount,
            meanChamferPx: r.historicalBest.meanChamferPx,
            g1Discontinuities: r.historicalBest.g1Discontinuities,
          },
          selectedNewBest: {
            label: r.selectedNewBest.candidateLabel,
            nodes: r.selectedNewBest.nodeCount,
            beziers: r.selectedNewBest.bezierCount,
            meanChamferPx: r.selectedNewBest.meanChamferPx,
            g1Discontinuities: r.selectedNewBest.g1Discontinuities,
          },
          nodeDeltaPercent: r.nodeDeltaPercent,
          fidelityDeltaPx: r.fidelityDeltaPx,
          verdict: r.verdict,
          corelRequired: r.corelRequired,
          verdictRationale: r.verdictRationale,
        })),
        null,
        2
      ),
      'utf-8'
    );

    // Export CorelDRAW Human Gate Artifacts & OVERVIEW.html
    const { overviewHtmlPath, exportedArtDirs } = exportHumanGateArtifacts(results, root);

    expect(fs.existsSync(overviewHtmlPath)).toBe(true);
    expect(exportedArtDirs.length).toBe(10);
    for (const d of exportedArtDirs) {
      expect(fs.existsSync(path.join(d, '02-BEST-HISTORICAL.svg'))).toBe(true);
      expect(fs.existsSync(path.join(d, '03-BEST-NEW-CANDIDATE.svg'))).toBe(true);
    }

    console.log('\n======================================================');
    console.log(`Exported OVERVIEW.html -> ${overviewHtmlPath}`);
    console.log(`Exported ${exportedArtDirs.length} Art folders to corel-human-gate-v828/`);
    console.log('======================================================\n');
  }, 120000);
});
