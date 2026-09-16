import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { reconstructEvidenceConstrainedCurves } from '../src/core/vector-engine';
import { parseSvgString } from '../src/core/vectorizer/svgParser';

describe('PRYX — ETAPA 8.16: Logo Dificil Candidate Reconstruction Audit', () => {
  it('reconstructs Logo Dificil candidate SVG with evidence constraints and generates comparison artifacts', () => {
    const inputSvgPath = path.resolve('scratch/v811e-topology-first/corel-review/logo-dificil-v811e.svg');
    const svgContent = fs.readFileSync(inputSvgPath, 'utf-8');

    const outDir = path.resolve('scratch/v816-evidence-constrained-reconstruction');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // 1. Reconstruct candidate SVG
    const result = reconstructEvidenceConstrainedCurves(svgContent, {
      canvasScale: 1.0,
      fittingTolerance: 1.2,
      lineTolerance: 0.5,
    });

    // 2. Write logo-dificil-v816.svg
    const candidatePath = path.join(outDir, 'logo-dificil-v816.svg');
    fs.writeFileSync(candidatePath, result.svg, 'utf-8');

    // 3. Write logo-dificil-v811e-reference.svg
    const refPath = path.join(outDir, 'logo-dificil-v811e-reference.svg');
    fs.writeFileSync(refPath, svgContent, 'utf-8');

    // 4. Write reconstruction-evidence.json
    const evidencePath = path.join(outDir, 'reconstruction-evidence.json');
    fs.writeFileSync(
      evidencePath,
      JSON.stringify(
        {
          metrics: result.metrics,
          evidenceConsumed: result.evidenceConsumed,
          verdict: result.verdict,
        },
        null,
        2
      ),
      'utf-8'
    );

    // 5. Write comparison diagram SVG
    const viewBoxMatch = svgContent.match(/viewBox\s*=\s*["']([^"']+)["']/i);
    const vb = viewBoxMatch ? viewBoxMatch[1] : '0 0 500 500';

    const comparisonSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 650" width="1200" height="650" style="background:#181824; font-family:sans-serif;">
  <rect width="1200" height="650" fill="#181824" />
  <text x="20" y="35" fill="#ffffff" font-size="18" font-weight="bold">PRYX 8.16 — Evidence-Constrained Curve Reconstruction Comparison</text>
  <text x="20" y="55" fill="#9999aa" font-size="12">V8.11E Topology Baseline vs. V8.16 Evidence-Constrained Professional Curves</text>

  <!-- Left: Reference V8.11E -->
  <g transform="translate(40, 80)">
    <rect width="520" height="520" fill="#222233" rx="8" />
    <text x="20" y="30" fill="#ffffff" font-size="14" font-weight="bold">Reference Baseline (V8.11E)</text>
    <text x="20" y="50" fill="#aaaaaa" font-size="11">Anchors: ${result.metrics.originalAnchors} | Segments: ${result.metrics.originalSegments}</text>
    <g transform="translate(10, 60)">
      <svg viewBox="${vb}" width="500" height="440">
        ${svgContent.replace(/<svg[^>]*>|<\/svg>/gi, '')}
      </svg>
    </g>
  </g>

  <!-- Right: Candidate V8.16 -->
  <g transform="translate(620, 80)">
    <rect width="520" height="520" fill="#222233" rx="8" />
    <text x="20" y="30" fill="#00ff88" font-size="14" font-weight="bold">Candidate Reconstructed (V8.16)</text>
    <text x="20" y="50" fill="#aaaaaa" font-size="11">Anchors: ${result.metrics.reconstructedAnchors} (Ratio: ${(result.metrics.anchorReductionRatio * 100).toFixed(1)}%) | Cubics: ${result.metrics.cubicSegments}, Lines: ${result.metrics.lineSegments}</text>
    <g transform="translate(10, 60)">
      <svg viewBox="${vb}" width="500" height="440">
        ${result.svg.replace(/<svg[^>]*>|<\/svg>/gi, '')}
      </svg>
    </g>
  </g>
</svg>`;

    fs.writeFileSync(path.join(outDir, 'logo-dificil-v816-comparison.svg'), comparisonSvg, 'utf-8');

    console.log('\n======================================================');
    console.log('PRYX 8.16 LOGO DIFÍCIL RECONSTRUCTION METRICS');
    console.log('======================================================');
    console.log(`Original Anchors: ${result.metrics.originalAnchors}`);
    console.log(`Reconstructed Anchors: ${result.metrics.reconstructedAnchors} (Reduction: ${(100 - result.metrics.anchorReductionRatio * 100).toFixed(1)}%)`);
    console.log(`Cubic Segments: ${result.metrics.cubicSegments}, Line Segments: ${result.metrics.lineSegments}`);
    console.log(`High-Freq Curvature Energy: ${result.metrics.highFrequencyCurvatureEnergyBefore} -> ${result.metrics.highFrequencyCurvatureEnergyAfter}`);
    console.log(`Components: ${result.metrics.componentsBefore} -> ${result.metrics.componentsAfter}`);
    console.log(`Holes: ${result.metrics.holesBefore} -> ${result.metrics.holesAfter}`);
    console.log(`P50 Error: ${result.metrics.p50GeometricError} px, P95 Error: ${result.metrics.p95GeometricError} px, Max Error: ${result.metrics.maxGeometricError} px`);
    console.log(`Counterform Area Drift Max: ${result.metrics.counterformAreaDriftMax}%, Centroid Drift Max: ${result.metrics.counterformCentroidDriftMax} px`);
    console.log(`Topology Gate Passed: ${result.metrics.topologyGatePassed}`);
    console.log(`Coupled Constraints Passed: ${result.metrics.coupledConstraintsPassed}`);
    console.log(`Verdict: ${result.verdict}`);
    console.log('======================================================\n');

    expect(result.metrics.topologyGatePassed).toBe(true);
    expect(result.metrics.coupledConstraintsPassed).toBe(true);
    expect(result.metrics.reconstructedAnchors).toBeLessThan(result.metrics.originalAnchors);
    expect(fs.existsSync(candidatePath)).toBe(true);
    expect(fs.existsSync(refPath)).toBe(true);
    expect(fs.existsSync(evidencePath)).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'logo-dificil-v816-comparison.svg'))).toBe(true);
  });
});
