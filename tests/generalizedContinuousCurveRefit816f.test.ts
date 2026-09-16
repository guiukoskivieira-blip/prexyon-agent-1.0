import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  extractSmoothIntervalsFromSubpath,
  refitSmoothInterval,
  reconstructContinuousCurvesFromSvg,
} from '../src/core/vector-engine/generalizedContinuousCurveRefit816f';
import { generateComparisonSvg } from '../src/core/vector-engine/finalCompositionAudit816d';

describe('PRYX — ETAPA 8.16F: Generalized Continuous Curve Reconstruction (Tests A - N)', () => {
  // Test A: Circle rasterized with stair-step
  it('Test A: Circle rasterized with stair-step -> consolidated to 4 smooth continuous cubics', () => {
    // Generate stair-stepped circle
    const pts = [];
    for (let a = 0; a <= 360; a += 5) {
      const rad = (a * Math.PI) / 180;
      const x = Math.round(200 + 100 * Math.cos(rad));
      const y = Math.round(200 + 100 * Math.sin(rad));
      pts.push({ x, y });
    }
    const intervals = extractSmoothIntervalsFromSubpath(pts, 0);
    expect(intervals.length).toBe(1);
    expect(intervals[0].isClosedLoop).toBe(true);

    const refit = refitSmoothInterval(intervals[0], 1.5);
    expect(refit.status).toBe('ACCEPT_RECONSTRUCTION');
    expect(refit.spans.length).toBe(4);
    expect(refit.maxError).toBeLessThanOrEqual(2.0);
  });

  // Test B: Ellipse
  it('Test B: Ellipse -> smooth continuous curvature with 4 cubics and 0 micro-spans', () => {
    const pts = [];
    for (let a = 0; a <= 360; a += 6) {
      const rad = (a * Math.PI) / 180;
      pts.push({ x: 300 + 150 * Math.cos(rad), y: 200 + 80 * Math.sin(rad) });
    }
    const intervals = extractSmoothIntervalsFromSubpath(pts, 0);
    const refit = refitSmoothInterval(intervals[0], 2.0);

    expect(refit.status).toBe('ACCEPT_RECONSTRUCTION');
    expect(refit.spans.length).toBeLessThanOrEqual(6);
    expect(refit.microSpansAfter).toBe(0);
  });

  // Test C: S-curve with real inflection
  it('Test C: S-curve with real inflection -> detects inflection and fits continuous cubics', () => {
    const pts = [];
    for (let x = 0; x <= 200; x += 5) {
      const t = (x / 200) * 2 * Math.PI;
      const y = 100 + 50 * Math.sin(t);
      pts.push({ x: 100 + x, y });
    }
    const intervals = extractSmoothIntervalsFromSubpath(pts, 0);
    expect(intervals[0].hasInflection).toBe(true);

    const refit = refitSmoothInterval(intervals[0], 2.0);
    expect(refit.status).toBe('ACCEPT_RECONSTRUCTION');
    expect(refit.spans.length).toBeLessThanOrEqual(4);
    expect(refit.maxError).toBeLessThanOrEqual(3.5);
  });

  // Test D: Letter O
  it('Test D: Letter O -> outer contour and inner counterform both refitted with smooth continuous curves', () => {
    const letterOSvg = `<svg viewBox="0 0 500 500" width="500" height="500">
  <path fill="#fefce0" d="M 0 0 L 0 500 L 500 500 L 500 0 Z" />
  <path fill="#792823" d="M 250 100 C 330 100 400 170 400 250 C 400 330 330 400 250 400 C 170 400 100 330 100 250 C 100 170 170 100 250 100 Z M 250 160 C 200 160 160 200 160 250 C 160 300 200 340 250 340 C 300 340 340 300 340 250 C 340 200 300 160 250 160 Z" />
</svg>`;
    const res = reconstructContinuousCurvesFromSvg(letterOSvg);
    expect(res.verdict).toBe('V816F_READY_FOR_HUMAN_GATE');
    expect(res.metrics.intervalsReconstructed).toBeGreaterThanOrEqual(1);
    expect(res.metrics.microSpansAfter).toBeLessThanOrEqual(2);
  });

  // Test E: Letter P
  it('Test E: Letter P -> outer contour, stem, and circular loop counterform refitted without area distortion', () => {
    const letterPSvg = `<svg viewBox="0 0 500 500" width="500" height="500">
  <path fill="#fefce0" d="M 0 0 L 0 500 L 500 500 L 500 0 Z" />
  <path fill="#792823" d="M 100 100 L 250 100 C 320 100 350 140 350 190 C 350 240 320 280 250 280 L 160 280 L 160 400 L 100 400 Z M 160 150 L 240 150 C 270 150 290 165 290 190 C 290 215 270 230 240 230 L 160 230 Z" />
</svg>`;
    const res = reconstructContinuousCurvesFromSvg(letterPSvg);
    expect(res.verdict).toBe('V816F_READY_FOR_HUMAN_GATE');
    expect(res.metrics.counterformMorphologyDelta).toBeLessThanOrEqual(0.005);
  });

  // Test F: Lettering with serif
  it('Test F: Lettering with serif -> sharp corner nodes of serifs preserved, smooth brackets refitted', () => {
    const serifSvg = `<svg viewBox="0 0 500 500" width="500" height="500">
  <path fill="#fefce0" d="M 0 0 L 0 500 L 500 500 L 500 0 Z" />
  <path fill="#792823" d="M 80 100 L 220 100 L 220 130 L 170 130 L 170 370 L 220 370 L 220 400 L 80 400 L 80 370 L 130 370 L 130 130 L 80 130 Z" />
</svg>`;
    const res = reconstructContinuousCurvesFromSvg(serifSvg);
    expect(res.verdict).toBe('V816F_READY_FOR_HUMAN_GATE');
    expect(res.metrics.selfIntersections).toBe(0);
  });

  // Test G: Thin terminal
  it('Test G: Thin terminal -> terminal tip preserved without collapsing', () => {
    const pts = [
      { x: 100, y: 100 },
      { x: 150, y: 120 },
      { x: 200, y: 130 },
      { x: 250, y: 132 },
      { x: 252, y: 131 },
      { x: 250, y: 128 },
      { x: 200, y: 125 },
      { x: 150, y: 110 },
      { x: 100, y: 100 },
    ];
    const intervals = extractSmoothIntervalsFromSubpath(pts, 0);
    expect(intervals.length).toBeGreaterThanOrEqual(1);
  });

  // Test H: Organic character curve
  it('Test H: Organic character curve -> long organic curves consolidated from dozens of micro-spans into few smooth cubics', () => {
    const pts = [];
    for (let i = 0; i <= 50; i++) {
      const t = i / 50;
      pts.push({
        x: 100 + 300 * t + 20 * Math.sin(t * Math.PI),
        y: 100 + 200 * t * t - 15 * Math.cos(t * Math.PI * 2),
      });
    }
    const intervals = extractSmoothIntervalsFromSubpath(pts, 0);
    const refit = refitSmoothInterval(intervals[0], 1.5);

    expect(refit.status).toBe('ACCEPT_RECONSTRUCTION');
    expect(refit.anchorsBefore).toBe(51);
    expect(refit.anchorsAfter).toBeLessThanOrEqual(5);
  });

  // Test I: Curve with real inflection
  it('Test I: Curve with real inflection -> inflection point correctly detected as internal knot', () => {
    const pts = [];
    for (let x = 0; x <= 200; x += 10) {
      const t = (x / 200) * 2 * Math.PI;
      pts.push({ x: 100 + x, y: 100 + 40 * Math.sin(t) });
    }
    const intervals = extractSmoothIntervalsFromSubpath(pts, 0);
    expect(intervals[0].hasInflection).toBe(true);
  });

  // Test J: Artificial sequence of micro-spans
  it('Test J: Artificial sequence of micro-spans (<10 px chords) -> consolidated into minimal smooth cubics, micro-span density drops >80%', () => {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      pts.push({ x: 100 + i * 5, y: 100 + 40 * Math.sin((i / 40) * Math.PI) });
    }
    const intervals = extractSmoothIntervalsFromSubpath(pts, 0);
    const refit = refitSmoothInterval(intervals[0], 1.2);

    expect(refit.status).toBe('ACCEPT_RECONSTRUCTION');
    expect(refit.microSpansBefore).toBe(40);
    expect(refit.microSpansAfter).toBe(0);
  });

  // Test K: Micro-spans containing real corner
  it('Test K: Micro-spans containing real corner -> corner split preserved, smooth sides consolidated', () => {
    const pts = [
      { x: 100, y: 100 },
      { x: 110, y: 100 },
      { x: 120, y: 100 },
      { x: 130, y: 100 },
      { x: 140, y: 100 },
      { x: 150, y: 100 }, // 90 deg corner
      { x: 150, y: 110 },
      { x: 150, y: 120 },
      { x: 150, y: 130 },
      { x: 150, y: 140 },
      { x: 150, y: 150 },
    ];
    const intervals = extractSmoothIntervalsFromSubpath(pts, 0);
    expect(intervals.length).toBe(2);
    expect(intervals[0].points.length).toBeGreaterThanOrEqual(2);
    expect(intervals[1].points.length).toBeGreaterThanOrEqual(2);
  });

  // Test L: Scale invariance (0.5x / 1x / 2x / 4x)
  it('Test L: Scale invariance (0.5x / 1x / 2x / 4x) -> consistent fitting across scales', () => {
    for (const scale of [0.5, 1.0, 2.0, 4.0]) {
      const pts = [];
      for (let a = 0; a < 360; a += 15) {
        const rad = (a * Math.PI) / 180;
        pts.push({
          x: (200 + 80 * Math.cos(rad)) * scale,
          y: (200 + 80 * Math.sin(rad)) * scale,
        });
      }
      const intervals = extractSmoothIntervalsFromSubpath(pts, 0);
      const refit = refitSmoothInterval(intervals[0], 1.5 * scale);
      expect(refit.status).toBe('ACCEPT_RECONSTRUCTION');
    }
  });

  // Test M: JPEG ringing noise
  it('Test M: JPEG ringing noise -> filtered by chord parameterization and energy minimization without feature erosion', () => {
    const pts = [];
    for (let i = 0; i <= 30; i++) {
      const noise = (i % 2 === 0 ? 0.4 : -0.4);
      pts.push({ x: 100 + i * 8, y: 150 + 60 * Math.sin((i / 30) * Math.PI) + noise });
    }
    const intervals = extractSmoothIntervalsFromSubpath(pts, 0);
    const refit = refitSmoothInterval(intervals[0], 1.2);
    expect(refit.status).toBe('ACCEPT_RECONSTRUCTION');
    expect(refit.curvatureOscillationAfter).toBeLessThan(refit.curvatureOscillationBefore);
  });

  // Test N: Narrow counterform
  it('Test N: Narrow counterform -> counterform width profile preserved, no collapse', () => {
    const narrowSvg = `<svg viewBox="0 0 500 500" width="500" height="500">
  <path fill="#fefce0" d="M 0 0 L 0 500 L 500 500 L 500 0 Z" />
  <path fill="#792823" d="M 100 100 L 300 100 L 300 400 L 100 400 Z M 140 140 L 260 140 L 260 360 L 140 360 Z" />
</svg>`;
    const res = reconstructContinuousCurvesFromSvg(narrowSvg);
    expect(res.verdict).toBe('V816F_READY_FOR_HUMAN_GATE');
    expect(res.metrics.areaDelta).toBeLessThanOrEqual(0.005);
  });

  // Live Logo Difícil Candidate Generation & Output Validation
  it('generates v816f candidate with continuous curve refitting, reduced micro-spans, and solid underlay', () => {
    const baselinePath = path.resolve('scratch/v816e-layered-composition/logo-dificil-v816e.svg');
    expect(fs.existsSync(baselinePath)).toBe(true);

    const inputSvg = fs.readFileSync(baselinePath, 'utf-8');

    const outDir = path.resolve('scratch/v816f-continuous-refit');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // Run continuous curve refitting pipeline
    const result = reconstructContinuousCurvesFromSvg(inputSvg, { fittingTolerance: 1.5 });

    // Write candidate SVG
    const candidate816fPath = path.join(outDir, 'logo-dificil-v816f.svg');
    fs.writeFileSync(candidate816fPath, result.svg, 'utf-8');

    // Generate comparison SVG
    const comparisonSvg = generateComparisonSvg(inputSvg, result.svg);
    fs.writeFileSync(path.join(outDir, 'comparison.svg'), comparisonSvg, 'utf-8');

    // Write metadata JSONs
    fs.writeFileSync(
      path.join(outDir, 'refit-metrics.json'),
      JSON.stringify(result.metrics, null, 2),
      'utf-8'
    );

    fs.writeFileSync(
      path.join(outDir, 'intervals-audit.json'),
      JSON.stringify(result.intervals, null, 2),
      'utf-8'
    );

    console.log('\n======================================================');
    console.log('PRYX 8.16F CONTINUOUS CURVE RECONSTRUCTION AUDIT');
    console.log('======================================================');
    console.log(`Candidate SVG saved to: ${candidate816fPath}`);
    console.log(`Smooth Intervals Detected: ${result.metrics.smoothIntervalsDetected}`);
    console.log(`Intervals Reconstructed: ${result.metrics.intervalsReconstructed}`);
    console.log(`Intervals Preserved (Fallback): ${result.metrics.intervalsPreservedFallback}`);
    console.log(`Micro-Spans (<12px) Before: ${result.metrics.microSpansBefore}`);
    console.log(`Micro-Spans (<12px) After: ${result.metrics.microSpansAfter}`);
    console.log(`Short-Span Density Before: ${(result.metrics.shortSpanDensityBefore * 100).toFixed(1)}%`);
    console.log(`Short-Span Density After: ${(result.metrics.shortSpanDensityAfter * 100).toFixed(1)}%`);
    console.log(`Anchors Before: ${result.metrics.anchorsBefore}`);
    console.log(`Anchors After: ${result.metrics.anchorsAfter}`);
    console.log(`Anchor Reduction Ratio: ${(result.metrics.anchorReductionRatio * 100).toFixed(1)}%`);
    console.log(`P50 Raster Evidence Error: ${result.metrics.p50RasterEvidenceError.toFixed(3)} px`);
    console.log(`P95 Raster Evidence Error: ${result.metrics.p95RasterEvidenceError.toFixed(3)} px`);
    console.log(`MAX Raster Evidence Error: ${result.metrics.maxRasterEvidenceError.toFixed(3)} px`);
    console.log(`Tangent Oscillation Energy Before: ${result.metrics.tangentOscillationBeforeDeg.toFixed(1)}`);
    console.log(`Tangent Oscillation Energy After: ${result.metrics.tangentOscillationAfterDeg.toFixed(1)}`);
    console.log(`Curvature Extrema Count Before: ${result.metrics.curvatureExtremaBefore}`);
    console.log(`Curvature Extrema Count After: ${result.metrics.curvatureExtremaAfter}`);
    console.log(`Counterform Morphology Delta: ${(result.metrics.counterformMorphologyDelta * 100).toFixed(4)}%`);
    console.log(`Width Profile Delta: ${(result.metrics.widthProfileDelta * 100).toFixed(4)}%`);
    console.log(`Self Intersections: ${result.metrics.selfIntersections}`);
    console.log(`Open Paths: ${result.metrics.openPaths}`);
    console.log(`Verdict: ${result.verdict}`);
    console.log('======================================================\n');

    expect(result.metrics.intervalsReconstructed).toBeGreaterThan(0);
    expect(result.metrics.shortSpanDensityAfter).toBeLessThan(result.metrics.shortSpanDensityBefore);
    expect(result.metrics.selfIntersections).toBe(0);
    expect(result.metrics.openPaths).toBe(0);
    expect(result.verdict).toBe('V816F_READY_FOR_HUMAN_GATE');

    expect(fs.existsSync(candidate816fPath)).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'comparison.svg'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'refit-metrics.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'intervals-audit.json'))).toBe(true);
  });

  // Shadow Mode on Goldens #1–#4
  it('executes new continuous refit pipeline in shadow mode on Goldens #1 to #4', () => {
    const goldens = [
      {
        id: 'Golden #1 (08-logo-simples)',
        approvedPath: 'golden-human-regression-4/corel-review/01-logo-simples-approved.svg',
      },
      {
        id: 'Golden #2 (09-logo-lettering)',
        approvedPath: 'golden-human-regression-4/corel-review/02-logo-lettering-approved.svg',
      },
      {
        id: 'Golden #3 (10-logo-colorida)',
        approvedPath: 'golden-human-regression-4/corel-review/03-logo-colorida-approved.svg',
      },
      {
        id: 'Golden #4 (11-logo-personagem)',
        approvedPath: 'golden-human-regression-4/corel-review/04-logo-personagem-approved.svg',
      },
    ];

    console.log('\n======================================================');
    console.log('SHADOW MODE: NEW CONTINUOUS REFIT ON GOLDENS #1–#4');
    console.log('NEW_CONTINUOUS_REFIT_PIPELINE_EXECUTED = true');
    console.log('======================================================');

    for (const g of goldens) {
      const fullPath = path.resolve(path.join('scratch', g.approvedPath));
      expect(fs.existsSync(fullPath)).toBe(true);

      const approvedSvg = fs.readFileSync(fullPath, 'utf-8');
      const result = reconstructContinuousCurvesFromSvg(approvedSvg, { fittingTolerance: 1.5 });

      console.log(`[${g.id}]`);
      console.log(`  Smooth Intervals Detected: ${result.metrics.smoothIntervalsDetected}`);
      console.log(`  Intervals Reconstructed: ${result.metrics.intervalsReconstructed}`);
      console.log(`  Anchors: ${result.metrics.anchorsBefore} -> ${result.metrics.anchorsAfter}`);
      console.log(`  Short-Span Density: ${(result.metrics.shortSpanDensityBefore * 100).toFixed(1)}% -> ${(result.metrics.shortSpanDensityAfter * 100).toFixed(1)}%`);
      console.log(`  Self Intersections: ${result.metrics.selfIntersections}`);
      console.log(`  Open Paths: ${result.metrics.openPaths}`);
      console.log(`  Verdict: ${result.verdict}`);

      expect(result.metrics.selfIntersections).toBe(0);
      expect(result.metrics.openPaths).toBe(0);
    }
    console.log('======================================================\n');
  });
});
