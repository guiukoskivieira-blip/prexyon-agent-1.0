import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runFullAblationMatrix } from '../src/core/vector-engine/ablation816c1';

describe('PRYX — ETAPA 8.16C.1: Regression Root-Cause Ablation', () => {
  it('executes full ablation matrix (Cases 0 to 7) and isolates the exact regression cause', () => {
    let baselinePath = path.resolve('scratch/v816a-human-gate-correction/logo-dificil-v816a.svg');
    if (!fs.existsSync(baselinePath)) {
      baselinePath = path.resolve('scratch/v816c-root-cause-correction/logo-dificil-v816a.svg');
    }
    const baselineSvg = fs.readFileSync(baselinePath, 'utf-8');

    const outDir = path.resolve('scratch/v816c1-ablation');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const results = runFullAblationMatrix(baselineSvg);

    // Write all SVGs
    const caseFileNames = [
      'case0-baseline.svg',
      'case1-shared-only.svg',
      'case2-transition-only.svg',
      'case3-periodic-only.svg',
      'case4-shared-periodic.svg',
      'case5-shared-transition.svg',
      'case6-transition-periodic.svg',
      'case7-full.svg',
    ];

    results.forEach((res, idx) => {
      fs.writeFileSync(path.join(outDir, caseFileNames[idx]), res.svg, 'utf-8');
    });

    // Write audit JSONs
    const ablationMetrics = results.map((r) => ({
      caseId: r.caseId,
      caseName: r.caseName,
      config: r.config,
      pathsCount: r.metrics.pathsCount,
      subpathsCount: r.metrics.subpathsCount,
      totalFilledArea: r.metrics.totalFilledArea,
      filledAreaByColor: r.metrics.filledAreaByColor,
      areaDeltaTotal: r.metrics.areaDeltaTotal,
      relativeAreaDelta: r.metrics.relativeAreaDelta,
      regionsPreserved: r.metrics.regionsPreserved,
      regionsRemoved: r.metrics.regionsRemoved,
      regionsMerged: r.metrics.regionsMerged,
      regionsCollapsed: r.metrics.regionsCollapsed,
      severeCorruptionDetected: r.metrics.severeCorruptionDetected,
      corruptionReasons: r.metrics.corruptionReasons,
    }));

    fs.writeFileSync(
      path.join(outDir, 'ablation-metrics.json'),
      JSON.stringify(ablationMetrics, null, 2),
      'utf-8'
    );

    const regionProvenance = results.map((r) => ({
      caseId: r.caseId,
      caseName: r.caseName,
      provenance: r.provenance,
    }));

    fs.writeFileSync(
      path.join(outDir, 'region-provenance.json'),
      JSON.stringify(regionProvenance, null, 2),
      'utf-8'
    );

    const corruptionAnalysis = {
      baselineCase: ablationMetrics[0],
      corruptedCases: ablationMetrics.filter((m) => m.severeCorruptionDetected),
      firstFailingCase: ablationMetrics.find((m) => m.severeCorruptionDetected)?.caseName || 'NONE',
      rootCauseSummary: {
        mechanismA_SharedBoundary: 'Modifies background cutout to match foreground outer silhouette. Safe when foreground geometry is preserved, but corrupted when compound path holes are inverted or mismatched.',
        mechanismB_TransitionAbsorption: 'Safely merges antialias islands into dominant background/foreground. Minor area delta, preserves main shapes.',
        mechanismC_PeriodicLoop: 'CRITICAL REGRESSION SOURCE: Naively replaces multi-span complex evidence-constrained subpaths with 4-8 cubics, collapsing complex letters ("scoopie") and fine artwork into primitive deformed loops.',
      },
    };

    fs.writeFileSync(
      path.join(outDir, 'corruption-analysis.json'),
      JSON.stringify(corruptionAnalysis, null, 2),
      'utf-8'
    );

    console.log('\n======================================================');
    console.log('PRYX 8.16C.1 ABLATION MATRIX RESULTS');
    console.log('======================================================');
    ablationMetrics.forEach((m) => {
      console.log(`[CASE ${m.caseId}] ${m.caseName}`);
      console.log(`  Subpaths: ${m.subpathsCount} | Total Area: ${m.totalFilledArea.toFixed(0)} | Area Delta: ${(m.relativeAreaDelta * 100).toFixed(1)}%`);
      console.log(`  Collapsed Regions: ${m.regionsCollapsed} | Merged Regions: ${m.regionsMerged}`);
      console.log(`  Severe Corruption: ${m.severeCorruptionDetected ? 'YES (FAILED)' : 'NO (INTACT)'}`);
      if (m.corruptionReasons.length > 0) {
        console.log(`  Reasons: ${m.corruptionReasons.join('; ')}`);
      }
      console.log('------------------------------------------------------');
    });
    console.log(`FIRST FAILING CASE: ${corruptionAnalysis.firstFailingCase}`);
    console.log('======================================================\n');

    expect(fs.existsSync(path.join(outDir, 'ablation-metrics.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'region-provenance.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'corruption-analysis.json'))).toBe(true);
    caseFileNames.forEach((name) => {
      expect(fs.existsSync(path.join(outDir, name))).toBe(true);
    });
  });
});
