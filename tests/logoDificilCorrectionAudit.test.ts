import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { reconstructEvidenceConstrainedCurves } from '../src/core/vector-engine/evidenceConstrainedCurveReconstruction';

describe('PRYX — ETAPA 8.16A: Logo Dificil Candidate Correction Audit', () => {
  it('generates v816a candidate and audit artifacts with false feature rejection and counterform morphology guard', () => {
    let inputSvgPath = path.resolve('scratch/v816-evidence-constrained-reconstruction/logo-dificil-v811e-reference.svg');
    if (!fs.existsSync(inputSvgPath)) {
      inputSvgPath = path.resolve('scratch/v811e-topology-first/corel-review/logo-dificil-v811e.svg');
    }
    const svgContent = fs.readFileSync(inputSvgPath, 'utf-8');

    const outDir = path.resolve('scratch/v816a-human-gate-correction');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const v816SourcePath = path.resolve('scratch/v816-evidence-constrained-reconstruction/logo-dificil-v816.svg');
    if (fs.existsSync(v816SourcePath)) {
      fs.copyFileSync(v816SourcePath, path.join(outDir, 'logo-dificil-v816.svg'));
    }

    const result = reconstructEvidenceConstrainedCurves(svgContent, {
      curveTolerance: 1.0,
      cornerAngleDeg: 42,
      smoothLoopOptimization: true,
      enableCoupledConstraints: true,
    });

    const candidatePath = path.join(outDir, 'logo-dificil-v816a.svg');
    fs.writeFileSync(candidatePath, result.svg, 'utf-8');

    const comparisonSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 800" width="1600" height="800">
  <defs>
    <style>
      .label { font-family: sans-serif; font-size: 20px; font-weight: bold; fill: #333; }
    </style>
  </defs>
  <rect width="1600" height="800" fill="#f8f9fa"/>
  <text x="40" y="40" class="label">V8.16 (Before Human Correction)</text>
  <g transform="translate(40, 60)">
    <rect width="720" height="700" fill="#fff" stroke="#ccc"/>
    <image href="logo-dificil-v816.svg" width="720" height="700"/>
  </g>
  <text x="840" y="40" class="label">V8.16A (Candidate with False Feature Rejection + Morphology Guard)</text>
  <g transform="translate(840, 60)">
    <rect width="720" height="700" fill="#fff" stroke="#ccc"/>
    <image href="logo-dificil-v816a.svg" width="720" height="700"/>
  </g>
</svg>`;
    fs.writeFileSync(path.join(outDir, 'comparison.svg'), comparisonSvg, 'utf-8');

    fs.writeFileSync(
      path.join(outDir, 'feature-decisions.json'),
      JSON.stringify(result.featureDecisions, null, 2),
      'utf-8'
    );

    fs.writeFileSync(
      path.join(outDir, 'morphology-guard.json'),
      JSON.stringify(result.morphologyDecisions, null, 2),
      'utf-8'
    );

    console.log('\n======================================================');
    console.log('PRYX 8.16A LOGO DIFICIL CORRECTION AUDIT');
    console.log('======================================================');
    console.log(`Candidate SVG saved to: ${candidatePath}`);
    console.log(`Original Anchors (Discrete Path): ${result.metrics.originalAnchors}`);
    console.log(`Reconstructed Anchors: ${result.metrics.reconstructedAnchors}`);
    console.log(`Anchor Reduction Ratio: ${result.metrics.anchorReductionRatio.toFixed(3)}`);
    console.log(`Total Breakpoint Decisions: ${result.featureDecisions.length}`);
    console.log(`False Features Rejected: ${result.metrics.falseCornersRejected}`);
    console.log(`True Features Retained: ${result.metrics.trueCornersRetained}`);
    console.log(`Morphology Guards Evaluated: ${result.morphologyDecisions.length}`);
    console.log(`Fallbacks Triggered: ${result.metrics.morphologyFallbacksTriggered}`);
    console.log(`P50 Boundary Drift: ${result.metrics.p50GeometricError.toFixed(3)} px`);
    console.log(`P95 Boundary Drift: ${result.metrics.p95GeometricError.toFixed(3)} px`);
    console.log(`Max Boundary Drift: ${result.metrics.maxGeometricError.toFixed(3)} px`);
    console.log(`Mean Area Drift: ${(result.metrics.counterformAreaDriftMax * 100).toFixed(2)}%`);
    console.log(`Verdict: ${result.verdict}`);
    console.log('======================================================\n');

    expect(result.verdict).toBe('V816A_READY_FOR_HUMAN_GATE');
    expect(result.metrics.falseCornersRejected).toBeGreaterThan(50);
    expect(result.metrics.maxGeometricError).toBeLessThanOrEqual(3.0);
    expect(fs.existsSync(candidatePath)).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'feature-decisions.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'morphology-guard.json'))).toBe(true);
  });
});