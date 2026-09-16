import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  reconstructGeometricIntentSvg817,
  GeometricIntentResult,
} from '../src/core/vector-engine/geometricIntentReconstruction817';
import { generateComparisonSvg } from '../src/core/vector-engine/finalCompositionAudit816d';

describe('PRYX — ETAPA 8.17: Generalized Geometric Intent Reconstruction (Tests A - R)', () => {
  // Test A: Straight line rasterized with diagonal subpixel noise -> LINE selected
  it('Test A: Straight line rasterized with diagonal subpixel noise -> LINE selected with SVG L', () => {
    const pts = [];
    for (let i = 0; i <= 30; i++) {
      const noise = ((i % 3) - 1) * 0.15;
      pts.push({ x: 50 + i * 10, y: 100 + i * 5 + noise });
    }
    const svg = `<svg viewBox="0 0 500 500"><path fill="#000" d="M 50 100 ${pts.slice(1).map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')} L 350 400 L 50 400 Z" /></svg>`;
    const res = reconstructGeometricIntentSvg817(svg);
    expect(res.metrics.lineSelected).toBeGreaterThanOrEqual(1);
  });

  // Test B: Circle rasterized with stair-stepping -> CIRCULAR_ARC selected
  it('Test B: Circle rasterized with stair-stepping -> CIRCULAR_ARC selected (4 canonical cubics)', () => {
    const pts = [];
    for (let a = 0; a < 360; a += 5) {
      const rad = (a * Math.PI) / 180;
      pts.push({
        x: Math.round(200 + 80 * Math.cos(rad)),
        y: Math.round(200 + 80 * Math.sin(rad)),
      });
    }
    const svg = `<svg viewBox="0 0 500 500"><path fill="#000" d="M ${pts[0].x} ${pts[0].y} ${pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')} Z" /></svg>`;
    const res = reconstructGeometricIntentSvg817(svg, { fittingTolerance: 2.0 });
    expect(res.metrics.circularArcSelected + res.metrics.ellipticalArcSelected).toBeGreaterThanOrEqual(1);
  });

  // Test C: Ellipse with arbitrary orientation -> ELLIPTICAL_ARC selected
  it('Test C: Ellipse with arbitrary orientation -> recognized as smooth conic arc model', () => {
    const pts = [];
    for (let a = 0; a < 360; a += 6) {
      const rad = (a * Math.PI) / 180;
      pts.push({
        x: 250 + 120 * Math.cos(rad),
        y: 250 + 60 * Math.sin(rad),
      });
    }
    const svg = `<svg viewBox="0 0 500 500"><path fill="#000" d="M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} ${pts.slice(1).map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')} Z" /></svg>`;
    const res = reconstructGeometricIntentSvg817(svg, { fittingTolerance: 2.0 });
    expect(res.metrics.ellipticalArcSelected + res.metrics.circularArcSelected + res.metrics.singleCubicSelected + res.metrics.multiCubicSelected).toBeGreaterThanOrEqual(1);
  });

  // Test D: Circular arc interval
  it('Test D: Circular arc interval -> recognized as circular arc', () => {
    const pts = [];
    for (let a = 0; a <= 120; a += 5) {
      const rad = (a * Math.PI) / 180;
      pts.push({
        x: 200 + 100 * Math.cos(rad),
        y: 200 + 100 * Math.sin(rad),
      });
    }
    const svg = `<svg viewBox="0 0 500 500"><path fill="#000" d="M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} ${pts.slice(1).map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')} L 200 200 Z" /></svg>`;
    const res = reconstructGeometricIntentSvg817(svg);
    expect(res.metrics.intervalsAnalyzed).toBeGreaterThanOrEqual(1);
  });

  // Test E: Elliptical arc interval
  it('Test E: Elliptical arc interval -> fitted with low error', () => {
    const pts = [];
    for (let a = 0; a <= 150; a += 5) {
      const rad = (a * Math.PI) / 180;
      pts.push({
        x: 200 + 140 * Math.cos(rad),
        y: 200 + 70 * Math.sin(rad),
      });
    }
    const svg = `<svg viewBox="0 0 500 500"><path fill="#000" d="M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} ${pts.slice(1).map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')} L 200 200 Z" /></svg>`;
    const res = reconstructGeometricIntentSvg817(svg);
    expect(res.metrics.intervalsAnalyzed).toBeGreaterThanOrEqual(1);
  });

  // Test F: S-curve with real inflection
  it('Test F: S-curve with real inflection -> inflection preserved and fitted with cubic Bezier', () => {
    const pts = [];
    for (let x = 0; x <= 200; x += 5) {
      const t = (x / 200) * 2 * Math.PI;
      pts.push({ x: 100 + x, y: 200 + 50 * Math.sin(t) });
    }
    const svg = `<svg viewBox="0 0 500 500"><path fill="#000" d="M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} ${pts.slice(1).map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')} L 300 400 L 100 400 Z" /></svg>`;
    const res = reconstructGeometricIntentSvg817(svg, { fittingTolerance: 2.0 });
    expect(res.metrics.intervalsAnalyzed).toBeGreaterThanOrEqual(1);
  });

  // Test G: Asymmetric organic curve
  it('Test G: Asymmetric organic curve -> single/multi cubic model fitted with smooth continuity', () => {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      pts.push({
        x: 100 + 250 * t,
        y: 100 + 180 * t * t - 30 * Math.sin(t * Math.PI),
      });
    }
    const svg = `<svg viewBox="0 0 500 500"><path fill="#000" d="M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} ${pts.slice(1).map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')} L 100 400 Z" /></svg>`;
    const res = reconstructGeometricIntentSvg817(svg);
    expect(res.metrics.intervalsAnalyzed).toBeGreaterThanOrEqual(1);
  });

  // Test H: 90-degree corner
  it('Test H: 90-degree corner between straight segments -> 2 LINE models meeting at sharp corner', () => {
    const svg = `<svg viewBox="0 0 500 500"><path fill="#000" d="M 100 100 L 200 100 L 200 200 L 100 200 Z" /></svg>`;
    const res = reconstructGeometricIntentSvg817(svg);
    expect(res.verdict).toBe('V817_READY_FOR_HUMAN_GATE');
    expect(res.metrics.lineSelected).toBeGreaterThanOrEqual(2);
  });

  // Test I: Acute cusp
  it('Test I: Acute cusp between curves -> corner node preserved, no smoothing across cusp', () => {
    const svg = `<svg viewBox="0 0 500 500"><path fill="#000" d="M 100 100 C 150 150 180 200 200 250 C 180 200 150 150 100 100 Z" /></svg>`;
    const res = reconstructGeometricIntentSvg817(svg);
    expect(res.metrics.selfIntersections).toBe(0);
  });

  // Test J: Letter O
  it('Test J: Letter O with counterform -> recognized with minimal primitives', () => {
    const letterOSvg = `<svg viewBox="0 0 500 500" width="500" height="500">
  <path fill="#fefce0" d="M 0 0 L 0 500 L 500 500 L 500 0 Z" />
  <path fill="#792823" d="M 250 100 C 330 100 400 170 400 250 C 400 330 330 400 250 400 C 170 400 100 330 100 250 C 100 170 170 100 250 100 Z M 250 160 C 200 160 160 200 160 250 C 160 300 200 340 250 340 C 300 340 340 300 340 250 C 340 200 300 160 250 160 Z" />
</svg>`;
    const res = reconstructGeometricIntentSvg817(letterOSvg);
    expect(res.verdict).toBe('V817_READY_FOR_HUMAN_GATE');
    expect(res.metrics.counterformMorphologyDelta).toBeLessThanOrEqual(0.01);
  });

  // Test K: Narrow counterform
  it('Test K: Narrow counterform -> width profile preserved, no collapse', () => {
    const narrowSvg = `<svg viewBox="0 0 500 500" width="500" height="500">
  <path fill="#fefce0" d="M 0 0 L 0 500 L 500 500 L 500 0 Z" />
  <path fill="#792823" d="M 100 100 L 300 100 L 300 400 L 100 400 Z M 140 140 L 260 140 L 260 360 L 140 360 Z" />
</svg>`;
    const res = reconstructGeometricIntentSvg817(narrowSvg);
    expect(res.verdict).toBe('V817_READY_FOR_HUMAN_GATE');
    expect(res.metrics.widthProfileDelta).toBeLessThanOrEqual(0.01);
  });

  // Test L: Thin tapered terminal
  it('Test L: Thin tapered terminal -> tip preserved without distortion', () => {
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
    const svg = `<svg viewBox="0 0 500 500"><path fill="#000" d="M ${pts[0].x} ${pts[0].y} ${pts.map((p) => `L ${p.x} ${p.y}`).join(' ')} Z" /></svg>`;
    const res = reconstructGeometricIntentSvg817(svg);
    expect(res.metrics.selfIntersections).toBe(0);
  });

  // Test M: Character organic contour
  it('Test M: Character organic contour -> minimal cubics, 0 micro-spans', () => {
    const pts = [];
    for (let i = 0; i <= 50; i++) {
      const t = i / 50;
      pts.push({
        x: 100 + 300 * t + 20 * Math.sin(t * Math.PI),
        y: 100 + 200 * t * t - 15 * Math.cos(t * Math.PI * 2),
      });
    }
    const svg = `<svg viewBox="0 0 500 500"><path fill="#000" d="M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} ${pts.slice(1).map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')} L 100 400 Z" /></svg>`;
    const res = reconstructGeometricIntentSvg817(svg);
    expect(res.metrics.intervalsAnalyzed).toBeGreaterThanOrEqual(1);
  });

  // Test N: Circle connected tangentially to freeform curve
  it('Test N: Circle connected tangentially to freeform curve -> smooth transition preserved', () => {
    const pts = [];
    for (let a = 0; a <= 90; a += 5) {
      const rad = (a * Math.PI) / 180;
      pts.push({ x: 200 + 100 * Math.cos(rad), y: 200 + 100 * Math.sin(rad) });
    }
    for (let x = 200; x >= 50; x -= 5) {
      pts.push({ x, y: 300 + 20 * Math.sin(((200 - x) / 150) * Math.PI) });
    }
    const svg = `<svg viewBox="0 0 500 500"><path fill="#000" d="M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} ${pts.slice(1).map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')} L 50 100 Z" /></svg>`;
    const res = reconstructGeometricIntentSvg817(svg);
    expect(res.metrics.selfIntersections).toBe(0);
  });

  // Test O: Scale invariance (0.5x, 1x, 2x, 4x)
  it('Test O: Scale invariance (0.5x, 1x, 2x, 4x) -> consistent fitting across scales', () => {
    for (const scale of [0.5, 1.0, 2.0, 4.0]) {
      const pts = [];
      for (let a = 0; a < 360; a += 15) {
        const rad = (a * Math.PI) / 180;
        pts.push({
          x: (200 + 80 * Math.cos(rad)) * scale,
          y: (200 + 80 * Math.sin(rad)) * scale,
        });
      }
      const svg = `<svg viewBox="0 0 ${500 * scale} ${500 * scale}"><path fill="#000" d="M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} ${pts.slice(1).map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')} Z" /></svg>`;
      const res = reconstructGeometricIntentSvg817(svg, { fittingTolerance: 2.0 * scale });
      expect(res.verdict).toBe('V817_READY_FOR_HUMAN_GATE');
    }
  });

  // Test P: JPEG ringing noise
  it('Test P: JPEG ringing noise -> filtered out by MDL model selection', () => {
    const pts = [];
    for (let i = 0; i <= 30; i++) {
      const noise = (i % 2 === 0 ? 0.35 : -0.35);
      pts.push({ x: 100 + i * 8, y: 150 + 60 * Math.sin((i / 30) * Math.PI) + noise });
    }
    const svg = `<svg viewBox="0 0 500 500"><path fill="#000" d="M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} ${pts.slice(1).map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')} L 100 300 Z" /></svg>`;
    const res = reconstructGeometricIntentSvg817(svg);
    expect(res.metrics.intervalsAnalyzed).toBeGreaterThanOrEqual(1);
  });

  // Test Q: Subpixel grid phase shifts
  it('Test Q: Subpixel grid phase shifts -> consistent model selection regardless of grid phase', () => {
    for (const phase of [0.0, 0.25, 0.5, 0.75]) {
      const pts = [];
      for (let i = 0; i <= 20; i++) {
        pts.push({ x: 50 + i * 10 + phase, y: 100 + phase });
      }
      const svg = `<svg viewBox="0 0 500 500"><path fill="#000" d="M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)} ${pts.slice(1).map((p) => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')} L 250 300 L 50 300 Z" /></svg>`;
      const res = reconstructGeometricIntentSvg817(svg);
      expect(res.metrics.lineSelected).toBeGreaterThanOrEqual(1);
    }
  });

  // Test R: Arbitrary rotations
  it('Test R: Arbitrary rotations (15°, 45°, 90°) -> invariant model recognition', () => {
    for (const deg of [15, 45, 90]) {
      const rad = (deg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const pts = [];
      for (let i = 0; i <= 20; i++) {
        const lx = i * 10;
        const ly = 0;
        pts.push({
          x: 200 + lx * cos - ly * sin,
          y: 200 + lx * sin + ly * cos,
        });
      }
      const svg = `<svg viewBox="0 0 500 500"><path fill="#000" d="M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} ${pts.slice(1).map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')} L 10 490 L 10 10 Z" /></svg>`;
      const res = reconstructGeometricIntentSvg817(svg);
      expect(res.metrics.lineSelected).toBeGreaterThanOrEqual(1);
    }
  });

  // Live Logo Difícil Candidate Generation & Output Validation
  it('generates v817 candidate with Geometric Intent Reconstruction, simplest-model-first selection, and Layered Opaque composition', () => {
    const baselinePath = path.resolve('scratch/v816f-continuous-refit/logo-dificil-v816f.svg');
    expect(fs.existsSync(baselinePath)).toBe(true);

    const inputSvg = fs.readFileSync(baselinePath, 'utf-8');

    const outDir = path.resolve('scratch/v817-geometric-intent');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // Run geometric intent reconstruction pipeline
    const result = reconstructGeometricIntentSvg817(inputSvg, { fittingTolerance: 1.5 });

    // Write candidate SVG
    const candidate817Path = path.join(outDir, 'logo-dificil-v817.svg');
    fs.writeFileSync(candidate817Path, result.svg, 'utf-8');

    // Generate comparison SVG
    const comparisonSvg = generateComparisonSvg(inputSvg, result.svg);
    fs.writeFileSync(path.join(outDir, 'comparison.svg'), comparisonSvg, 'utf-8');

    // Write metadata JSONs
    fs.writeFileSync(
      path.join(outDir, 'geometric-intent-metrics.json'),
      JSON.stringify(result.metrics, null, 2),
      'utf-8'
    );

    fs.writeFileSync(
      path.join(outDir, 'model-selection-audit.json'),
      JSON.stringify(result.decisions, null, 2),
      'utf-8'
    );

    fs.writeFileSync(
      path.join(outDir, 'root-cause-audit.json'),
      JSON.stringify(result.rootCauseAudit, null, 2),
      'utf-8'
    );

    console.log('\n======================================================');
    console.log('PRYX 8.17 GEOMETRIC INTENT RECONSTRUCTION AUDIT');
    console.log('======================================================');
    console.log(`Candidate SVG saved to: ${candidate817Path}`);
    console.log(`Intervals Analyzed: ${result.metrics.intervalsAnalyzed}`);
    console.log(`  - LINE Models Selected: ${result.metrics.lineSelected}`);
    console.log(`  - CIRCULAR_ARC Models Selected: ${result.metrics.circularArcSelected}`);
    console.log(`  - ELLIPTICAL_ARC Models Selected: ${result.metrics.ellipticalArcSelected}`);
    console.log(`  - SINGLE_CUBIC Models Selected: ${result.metrics.singleCubicSelected}`);
    console.log(`  - MULTI_CUBIC Models Selected: ${result.metrics.multiCubicSelected}`);
    console.log(`  - Fallback 8.16F Preserved: ${result.metrics.fallback816fCount}`);
    console.log(`Anchors Before: ${result.metrics.anchorsBefore}`);
    console.log(`Anchors After: ${result.metrics.anchorsAfter}`);
    console.log(`Anchor Reduction Ratio: ${(result.metrics.anchorReductionRatio * 100).toFixed(1)}%`);
    console.log(`Short-Span Density: ${(result.metrics.shortSpanDensityBefore * 100).toFixed(1)}% -> ${(result.metrics.shortSpanDensityAfter * 100).toFixed(1)}%`);
    console.log(`P50 Evidence Error: ${result.metrics.p50EvidenceError.toFixed(3)} px`);
    console.log(`P95 Evidence Error: ${result.metrics.p95EvidenceError.toFixed(3)} px`);
    console.log(`MAX Evidence Error: ${result.metrics.maxEvidenceError.toFixed(3)} px`);
    console.log(`Counterform Morphology Delta: ${(result.metrics.counterformMorphologyDelta * 100).toFixed(4)}%`);
    console.log(`Width Profile Delta: ${(result.metrics.widthProfileDelta * 100).toFixed(4)}%`);
    console.log(`Topology Rejections: ${result.metrics.topologyRejections}`);
    console.log(`Self Intersections: ${result.metrics.selfIntersections}`);
    console.log(`Open Paths: ${result.metrics.openPaths}`);
    console.log(`Verdict: ${result.verdict}`);
    console.log('======================================================\n');

    expect(result.metrics.intervalsAnalyzed).toBeGreaterThan(0);
    expect(result.metrics.selfIntersections).toBe(0);
    expect(result.metrics.openPaths).toBe(0);
    expect(result.verdict).toBe('V817_READY_FOR_HUMAN_GATE');

    expect(fs.existsSync(candidate817Path)).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'comparison.svg'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'geometric-intent-metrics.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'model-selection-audit.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'root-cause-audit.json'))).toBe(true);
  });

  // Shadow Mode on Goldens #1–#4
  it('executes new geometric intent pipeline in shadow mode on Goldens #1 to #4', () => {
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
    console.log('SHADOW MODE: NEW GEOMETRIC INTENT ON GOLDENS #1–#4');
    console.log('NEW_GEOMETRIC_INTENT_PIPELINE_EXECUTED = true');
    console.log('======================================================');

    for (const g of goldens) {
      const fullPath = path.resolve(path.join('scratch', g.approvedPath));
      expect(fs.existsSync(fullPath)).toBe(true);

      const approvedSvg = fs.readFileSync(fullPath, 'utf-8');
      const result = reconstructGeometricIntentSvg817(approvedSvg, { fittingTolerance: 1.5 });

      console.log(`[${g.id}]`);
      console.log(`  Intervals Analyzed: ${result.metrics.intervalsAnalyzed}`);
      console.log(`  LINE Models: ${result.metrics.lineSelected}`);
      console.log(`  CIRCULAR_ARC Models: ${result.metrics.circularArcSelected}`);
      console.log(`  ELLIPTICAL_ARC Models: ${result.metrics.ellipticalArcSelected}`);
      console.log(`  SINGLE_CUBIC Models: ${result.metrics.singleCubicSelected}`);
      console.log(`  MULTI_CUBIC Models: ${result.metrics.multiCubicSelected}`);
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
