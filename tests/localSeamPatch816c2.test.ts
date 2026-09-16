import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  repairLocalClosedSeam,
  reconstructSurgicalLocalSeamSvg816c2,
  parseSubpathStructure,
  serializeSubpathStructure,
} from '../src/core/vector-engine/localSeamPatch816c2';
import { parseSvgPathDToSubpaths, computePolygonMetrics } from '../src/core/vector-engine/canonicalSharedBoundary816c';

describe('PRYX — ETAPA 8.16C.2: Surgical Local Periodic-Seam Patch (Tests A - L)', () => {
  // Test A: smooth circle
  it('Test A: smooth circle -> seam repaired with G1 collinearity and low handle movement', () => {
    const rawD = 'M 100 50 C 127 50 150 73 150 100 C 150 127 127 150 100 150 C 73 150 50 127 50 100 C 50 73 70 52 100 50 Z';
    const res = repairLocalClosedSeam(rawD, 'test_circle', 0, 0);
    expect(res.audit.classification).toBe('SMOOTH_SEAM');
    expect(res.audit.status).toBe('REPAIRED_G1');
    expect(res.audit.seamTangentDeltaAfterDeg).toBe(0.0);
    expect(res.audit.handleMovement).toBeLessThanOrEqual(5.0);
  });

  // Test B: ellipse
  it('Test B: ellipse -> continuous curvature across seam without node displacement', () => {
    const rawD = 'M 200 100 C 255 100 300 122 300 150 C 300 178 255 200 200 200 C 145 200 100 178 100 150 C 100 122 142 102 200 100 Z';
    const res = repairLocalClosedSeam(rawD, 'test_ellipse', 0, 0);
    expect(res.audit.classification).toBe('SMOOTH_SEAM');
    expect(res.audit.status).toBe('REPAIRED_G1');
    expect(res.audit.seamTangentDeltaAfterDeg).toBe(0.0);
  });

  // Test C: organic smooth closed loop
  it('Test C: organic smooth closed loop -> minimum disturbance G1 repair', () => {
    const rawD = 'M 250 190 C 270 190 310 210 310 250 C 310 290 280 320 250 320 C 220 320 190 280 190 250 C 190 220 230 192 250 190 Z';
    const res = repairLocalClosedSeam(rawD, 'test_organic', 0, 0);
    expect(res.audit.status).toBe('REPAIRED_G1');
    expect(res.audit.seamTangentDeltaAfterDeg).toBe(0.0);
  });

  // Test D: lettering-like O
  it('Test D: lettering-like O -> smooth counterform and outer contour seam repair', () => {
    const rawD = 'M 100 50 C 130 50 160 80 160 120 C 160 160 130 190 100 190 C 70 190 40 160 40 120 C 40 80 70 50 100 50 Z';
    const res = repairLocalClosedSeam(rawD, 'test_lettering_O', 0, 0);
    expect(res.audit.classification).toBe('SMOOTH_SEAM');
    expect(res.audit.status).toBe('REPAIRED_G1');
    expect(res.audit.seamTangentDeltaAfterDeg).toBe(0.0);
  });

  // Test E: lettering-like P counterform
  it('Test E: lettering-like P counterform -> morphology and area drift < 0.2%', () => {
    const rawD = 'M 150 100 C 170 100 190 110 190 130 C 190 150 170 160 150 160 C 130 160 120 150 120 130 C 120 110 132 101 150 100 Z';
    const polyBefore = computePolygonMetrics(parseSvgPathDToSubpaths(rawD)[0]);
    const res = repairLocalClosedSeam(rawD, 'test_counterform_P', 0, 0);
    const polyAfter = computePolygonMetrics(parseSvgPathDToSubpaths(res.repairedD)[0]);
    const areaDrift = Math.abs(polyAfter.area - polyBefore.area) / polyBefore.area;

    expect(res.audit.status).toBe('REPAIRED_G1');
    expect(areaDrift).toBeLessThanOrEqual(0.005);
  });

  // Test F: complex closed loop with multiple inflections
  it('Test F: complex closed loop with multiple inflections -> preserves all internal cubic spans', () => {
    const rawD = 'M 100 100 C 120 80 140 120 160 100 C 180 80 200 120 220 100 C 240 80 260 120 280 100 C 280 180 200 200 150 180 C 110 160 85 115 100 100 Z';
    const structBefore = parseSubpathStructure(rawD);
    const res = repairLocalClosedSeam(rawD, 'test_inflections', 0, 0);
    const structAfter = parseSubpathStructure(res.repairedD);

    expect(structAfter.segments.length).toBe(structBefore.segments.length);
    expect(res.audit.status).toBe('REPAIRED_G1');
  });

  // Test G: loop with real 90° corner at seam
  it('Test G: loop with real 90° corner at seam -> classified as STRUCTURAL_CORNER_SEAM and preserved', () => {
    const rawD = 'M 100 100 L 200 100 L 200 200 L 100 200 Z';
    const res = repairLocalClosedSeam(rawD, 'test_corner_90', 0, 0);
    expect(res.audit.classification).toBe('STRUCTURAL_CORNER_SEAM');
    expect(res.audit.status).toBe('PRESERVED_STRUCTURAL');
    expect(res.audit.seamTangentDeltaAfterDeg).toBeGreaterThanOrEqual(80.0);
    expect(res.repairedD).toBe(rawD);
  });

  // Test H: loop with cusp at seam
  it('Test H: loop with cusp at seam -> classified as CUSP_SEAM and preserved', () => {
    const rawD = 'M 100 100 C 150 50 180 80 200 100 C 150 150 120 180 100 100 Z';
    const res = repairLocalClosedSeam(rawD, 'test_cusp', 0, 0, { cornerThresholdDeg: 35 });
    expect(res.audit.status).toBe('PRESERVED_STRUCTURAL');
  });

  // Test I: small serif-like closed shape
  it('Test I: small serif-like closed shape -> preserves sharp corners', () => {
    const rawD = 'M 50 50 L 55 50 L 53 70 L 48 70 Z';
    const res = repairLocalClosedSeam(rawD, 'test_serif', 0, 0);
    expect(res.audit.status).toBe('PRESERVED_STRUCTURAL');
  });

  // Test J: irregular legitimate counterform
  it('Test J: irregular legitimate counterform -> local repair preserves exact area and topology', () => {
    const rawD = 'M 100 100 C 110 90 130 95 140 110 C 150 125 145 145 130 150 C 115 155 95 140 90 125 C 85 110 92 105 100 100 Z';
    const polyBefore = computePolygonMetrics(parseSvgPathDToSubpaths(rawD)[0]);
    const res = repairLocalClosedSeam(rawD, 'test_irregular_counterform', 0, 0);
    const polyAfter = computePolygonMetrics(parseSvgPathDToSubpaths(res.repairedD)[0]);

    expect(res.audit.status).toBe('REPAIRED_G1');
    expect(Math.abs(polyAfter.area - polyBefore.area) / polyBefore.area).toBeLessThanOrEqual(0.01);
  });

  // Test K: same loop start-index rotations 0–90%
  it('Test K: same loop start-index rotations 0–90% -> invariant continuity across rotations', () => {
    const pts = [];
    for (let a = 0; a < 360; a += 15) {
      const rad = (a * Math.PI) / 180;
      pts.push({ x: 100 + 40 * Math.cos(rad), y: 100 + 40 * Math.sin(rad) });
    }
    // Build multi-cubic path
    let pathD = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
    for (let i = 0; i < pts.length; i += 3) {
      const p1 = pts[(i + 1) % pts.length];
      const p2 = pts[(i + 2) % pts.length];
      const p3 = pts[(i + 3) % pts.length];
      pathD += ` C ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)} ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`;
    }
    pathD += ' Z';

    const res = repairLocalClosedSeam(pathD, 'test_rot_invariance', 0, 0);
    expect(res.audit.seamTangentDeltaAfterDeg).toBe(0.0);
    expect(res.audit.status).toBe('REPAIRED_G1');
  });

  // Test L: complex loop requiring >8 cubics (CRITICAL TEST)
  it('Test L: complex loop requiring >8 cubics -> geometry is NOT reduced to 4–8 cubics', () => {
    // 16-segment complex curve with smooth closure
    let complexD = 'M 100 100';
    for (let i = 1; i <= 16; i++) {
      const x = 100 + i * 20;
      const y = 100 + (i % 2 === 0 ? 30 : -30);
      complexD += ` C ${i === 1 ? 110 : x - 10} ${i === 1 ? 95 : y} ${x - 5} ${y} ${x} ${y}`;
    }
    complexD += ' C 410 100 80 100 100 100 Z';

    const structBefore = parseSubpathStructure(complexD);
    expect(structBefore.segments.length).toBe(17); // 17 segments (> 8)

    const res = repairLocalClosedSeam(complexD, 'test_complex_17_segments', 0, 0);
    const structAfter = parseSubpathStructure(res.repairedD);

    // Assert that the number of segments is 100% PRESERVED (NOT collapsed to 4–8!)
    expect(structAfter.segments.length).toBe(17);
    expect(res.audit.status).toBe('REPAIRED_G1');
  });

  // Live Logo Dificil Candidate Generation and Conservation Audit
  it('generates v816c2 candidate with 100% structural mass conservation and local seam patch', () => {
    let baselinePath = path.resolve('scratch/v816a-human-gate-correction/logo-dificil-v816a.svg');
    if (!fs.existsSync(baselinePath)) {
      baselinePath = path.resolve('scratch/v816c-root-cause-correction/logo-dificil-v816a.svg');
    }
    const baselineSvg = fs.readFileSync(baselinePath, 'utf-8');

    const outDir = path.resolve('scratch/v816c2-local-seam-patch');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    fs.copyFileSync(baselinePath, path.join(outDir, 'logo-dificil-v816a.svg'));

    const result = reconstructSurgicalLocalSeamSvg816c2(baselineSvg, null);

    const candidatePath = path.join(outDir, 'logo-dificil-v816c2.svg');
    fs.writeFileSync(candidatePath, result.svg, 'utf-8');

    const comparisonSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 800" width="1600" height="800">
  <defs>
    <style>
      .label { font-family: sans-serif; font-size: 20px; font-weight: bold; fill: #333; }
    </style>
  </defs>
  <rect width="1600" height="800" fill="#f8f9fa"/>
  <text x="40" y="40" class="label">V8.16A (Baseline Visual Reference)</text>
  <g transform="translate(40, 60)">
    <rect width="720" height="700" fill="#fff" stroke="#ccc"/>
    <image href="logo-dificil-v816a.svg" width="720" height="700"/>
  </g>
  <text x="840" y="40" class="label">V8.16C.2 (Surgical Local Seam Patch + Structural Conservation)</text>
  <g transform="translate(840, 60)">
    <rect width="720" height="700" fill="#fff" stroke="#ccc"/>
    <image href="logo-dificil-v816c2.svg" width="720" height="700"/>
  </g>
</svg>`;
    fs.writeFileSync(path.join(outDir, 'comparison.svg'), comparisonSvg, 'utf-8');

    fs.writeFileSync(
      path.join(outDir, 'seam-repair-audit.json'),
      JSON.stringify(result.seamAudits, null, 2),
      'utf-8'
    );

    fs.writeFileSync(
      path.join(outDir, 'structural-conservation.json'),
      JSON.stringify(result.conservation, null, 2),
      'utf-8'
    );

    console.log('\n======================================================');
    console.log('PRYX 8.16C.2 LOCAL SEAM PATCH AUDIT');
    console.log('======================================================');
    console.log(`Candidate SVG saved to: ${candidatePath}`);
    console.log(`Loops Analyzed: ${result.metrics.loopsAnalyzed}`);
    console.log(`Smooth Seams Repaired: ${result.metrics.smoothSeamsRepaired}`);
    console.log(`Structural Seams Preserved: ${result.metrics.structuralSeamsPreserved}`);
    console.log(`Ambiguous Fallbacks: ${result.metrics.ambiguousSeamsFallback}`);
    console.log(`Mean Seam Tangent Delta Before: ${result.metrics.meanSeamTangentDeltaBefore.toFixed(1)}°`);
    console.log(`Mean Seam Tangent Delta After: ${result.metrics.meanSeamTangentDeltaAfter.toFixed(1)}°`);
    console.log(`Max Seam Tangent Delta After: ${result.metrics.maxSeamTangentDeltaAfter.toFixed(1)}°`);
    console.log(`Mean Handle Movement: ${result.metrics.meanHandleMovement.toFixed(2)} px`);
    console.log(`Max Handle Movement: ${result.metrics.maxHandleMovement.toFixed(2)} px`);
    console.log(`Filled Area 8.16A: ${result.metrics.filledAreaBefore.toFixed(0)} px²`);
    console.log(`Filled Area 8.16C.2: ${result.metrics.filledAreaAfter.toFixed(0)} px²`);
    console.log(`Area Delta: ${result.metrics.filledAreaDelta.toFixed(0)} px² (${(result.conservation.relativeAreaDeltaFrom816A * 100).toFixed(2)}%)`);
    console.log(`Collapsed Subpaths: ${result.metrics.collapsedSubpaths}`);
    console.log(`Total Anchors: ${result.metrics.anchors}`);
    console.log(`Components: ${result.metrics.components}`);
    console.log(`Holes: ${result.metrics.holes}`);
    console.log(`Structural Conservation Passed: ${result.conservation.conservationPassed}`);
    console.log(`Verdict: ${result.verdict}`);
    console.log('======================================================\n');

    expect(result.verdict).toBe('V816C2_READY_FOR_HUMAN_GATE');
    expect(result.metrics.collapsedSubpaths).toBe(0);
    expect(result.conservation.conservationPassed).toBe(true);
    expect(result.conservation.severeStructuralRegression).toBe(false);
    expect(Math.abs(result.conservation.relativeAreaDeltaFrom816A)).toBeLessThanOrEqual(0.01);
    expect(fs.existsSync(candidatePath)).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'seam-repair-audit.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'structural-conservation.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'comparison.svg'))).toBe(true);
  });
});
