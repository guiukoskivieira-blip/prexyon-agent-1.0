import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { reconstructCanonicalSvg816c } from '../src/core/vector-engine/canonicalSharedBoundary816c';

describe('PRYX — ETAPA 8.16C: Logo Dificil Canonical Correction Audit', () => {
  it('generates v816c candidate and audit artifacts with canonical shared boundaries, periodic closed loops and transition absorption', () => {
    let inputSvgPath = path.resolve('scratch/v816a-human-gate-correction/logo-dificil-v816a.svg');
    if (!fs.existsSync(inputSvgPath)) {
      inputSvgPath = path.resolve('scratch/v816-evidence-constrained-reconstruction/logo-dificil-v816.svg');
    }
    const svgContent = fs.readFileSync(inputSvgPath, 'utf-8');

    const outDir = path.resolve('scratch/v816c-root-cause-correction');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // Copy v816a for reference
    if (fs.existsSync(inputSvgPath)) {
      fs.copyFileSync(inputSvgPath, path.join(outDir, 'logo-dificil-v816a.svg'));
    }

    const result = reconstructCanonicalSvg816c(svgContent, null, {
      cornerAngleDeg: 42,
    });

    const candidatePath = path.join(outDir, 'logo-dificil-v816c.svg');
    fs.writeFileSync(candidatePath, result.svg, 'utf-8');

    const comparisonSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 800" width="1600" height="800">
  <defs>
    <style>
      .label { font-family: sans-serif; font-size: 20px; font-weight: bold; fill: #333; }
    </style>
  </defs>
  <rect width="1600" height="800" fill="#f8f9fa"/>
  <text x="40" y="40" class="label">V8.16A (Before Root-Cause Correction - Has Gaps & Island Artifacts)</text>
  <g transform="translate(40, 60)">
    <rect width="720" height="700" fill="#fff" stroke="#ccc"/>
    <image href="logo-dificil-v816a.svg" width="720" height="700"/>
  </g>
  <text x="840" y="40" class="label">V8.16C (Candidate with Canonical Shared Boundaries + Periodic Loops)</text>
  <g transform="translate(840, 60)">
    <rect width="720" height="700" fill="#fff" stroke="#ccc"/>
    <image href="logo-dificil-v816c.svg" width="720" height="700"/>
  </g>
</svg>`;
    fs.writeFileSync(path.join(outDir, 'comparison.svg'), comparisonSvg, 'utf-8');

    fs.writeFileSync(
      path.join(outDir, 'shared-boundary-evidence.json'),
      JSON.stringify(result.sharedBoundaries, null, 2),
      'utf-8'
    );

    fs.writeFileSync(
      path.join(outDir, 'transition-region-decisions.json'),
      JSON.stringify(result.transitionDecisions, null, 2),
      'utf-8'
    );

    fs.writeFileSync(
      path.join(outDir, 'periodic-loop-validation.json'),
      JSON.stringify(result.loopValidations, null, 2),
      'utf-8'
    );

    console.log('\n======================================================');
    console.log('PRYX 8.16C LOGO DIFICIL CANONICAL CORRECTION AUDIT');
    console.log('======================================================');
    console.log(`Candidate SVG saved to: ${candidatePath}`);
    console.log(`Shared Interfaces Audit: ${result.metrics.sharedInterfaces}`);
    console.log(`Canonical Boundaries Created: ${result.metrics.canonicalBoundariesCreated}`);
    console.log(`Gaps Before: ${result.metrics.gapsBefore} (Max: ${result.metrics.maxGapBefore.toFixed(3)} px)`);
    console.log(`Gaps After: ${result.metrics.gapsAfter} (Max: ${result.metrics.maxGapAfter.toFixed(3)} px)`);
    console.log(`Overlaps After: ${result.metrics.overlapsAfter}`);
    console.log(`Transition Regions Analyzed: ${result.metrics.transitionRegionsAnalyzed}`);
    console.log(`Transition Artifacts Absorbed: ${result.metrics.transitionArtifactsAbsorbed}`);
    console.log(`Ambiguous Regions Preserved: ${result.metrics.ambiguousRegionsPreserved}`);
    console.log(`Legitimate Regions Preserved: ${result.metrics.legitimateRegionsPreserved}`);
    console.log(`Loops Analyzed: ${result.metrics.loopsAnalyzed}`);
    console.log(`Smooth Periodic Loops: ${result.metrics.smoothPeriodicLoops}`);
    console.log(`Start-Index Invariant Loops: ${result.metrics.startIndexInvariantLoops}`);
    console.log(`Seam Failures: ${result.metrics.seamFailures}`);
    console.log(`Mean Seam Tangent Delta Before: ${result.metrics.meanSeamTangentDeltaBefore.toFixed(1)}°`);
    console.log(`Mean Seam Tangent Delta After: ${result.metrics.meanSeamTangentDeltaAfter.toFixed(1)}°`);
    console.log(`Holes: ${result.metrics.holes}`);
    console.log(`Components: ${result.metrics.components}`);
    console.log(`Total Anchors: ${result.metrics.anchors}`);
    console.log(`Verdict: ${result.verdict}`);
    console.log('======================================================\n');

    expect(result.verdict).toBe('V816C_READY_FOR_HUMAN_GATE');
    expect(result.metrics.gapsAfter).toBe(0);
    expect(result.metrics.maxGapAfter).toBe(0.0);
    expect(result.metrics.canonicalBoundariesCreated).toBeGreaterThanOrEqual(1);
    expect(result.metrics.transitionArtifactsAbsorbed).toBeGreaterThan(0);
    expect(fs.existsSync(candidatePath)).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'shared-boundary-evidence.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'transition-region-decisions.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'periodic-loop-validation.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'comparison.svg'))).toBe(true);
  });
});
