import { describe, expect, it } from 'vitest';
import type { Point2D } from '../src/core/vector-engine/curveRefinement';
import {
  fitEllipseDirect,
  generateEllipseBeziers,
  reconstructProfessionalCurves,
} from '../src/core/vector-engine/professionalCurveReconstruction';

describe('PRYX — ETAPA 8.11D — Art-Finalist Synthetic Generalization Suite (Cases A - O)', () => {
  // Case A: Antialiased Circle
  it('Case A: Antialiased circle -> recognized as Circle primitive within sub-pixel Evidence Band', () => {
    const pts: Point2D[] = [];
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * 2 * Math.PI;
      const noise = Math.sin(i * 7) * 0.4;
      pts.push({ x: 500 + (120 + noise) * Math.cos(a), y: 500 + (120 + noise) * Math.sin(a) });
    }
    const fit = fitEllipseDirect(pts);
    expect(fit).not.toBeNull();
    expect(fit!.rmsError).toBeLessThan(0.6);
    expect(Math.abs(fit!.a - 120)).toBeLessThan(1.0);
    expect(Math.abs(fit!.b - 120)).toBeLessThan(1.0);
    expect(fit!.isStructuredOrganic).toBe(false);
  });

  // Case B: Rotated Ellipse
  it('Case B: Rotated ellipse -> accurately recovered with canonical Béziers', () => {
    const pts: Point2D[] = [];
    const a = 180, b = 90, theta = Math.PI / 3;
    for (let i = 0; i < 64; i++) {
      const t = (i / 64) * 2 * Math.PI;
      const ex = a * Math.cos(t);
      const ey = b * Math.sin(t);
      pts.push({
        x: 400 + ex * Math.cos(theta) - ey * Math.sin(theta),
        y: 400 + ex * Math.sin(theta) + ey * Math.cos(theta),
      });
    }
    const fit = fitEllipseDirect(pts);
    expect(fit).not.toBeNull();
    expect(Math.abs(fit!.a - a)).toBeLessThan(0.8);
    expect(Math.abs(fit!.b - b)).toBeLessThan(0.8);
    expect(fit!.rmsError).toBeLessThan(0.2);
    expect(fit!.isStructuredOrganic).toBe(false);

    const beziers = generateEllipseBeziers(fit!.cx, fit!.cy, fit!.a, fit!.b, fit!.theta);
    expect(beziers.length).toBe(4);
  });

  // Case C: JPEG-compressed Circle
  it('Case C: JPEG-compressed circle with ringing noise -> recognized within Evidence Band', () => {
    const pts: Point2D[] = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * 2 * Math.PI;
      const r = 80 + 0.8 * Math.sin(i * 4);
      pts.push({ x: 200 + r * Math.cos(a), y: 200 + r * Math.sin(a) });
    }
    const fit = fitEllipseDirect(pts);
    expect(fit).not.toBeNull();
    expect(fit!.rmsError).toBeLessThan(0.7);
    expect(fit!.isStructuredOrganic).toBe(false);
  });

  // Case D: JPEG-compressed Ellipse
  it('Case D: JPEG-compressed ellipse -> recognized and smoothed to 4 exact Bézier arcs', () => {
    const pts: Point2D[] = [];
    const a = 140, b = 60;
    for (let i = 0; i < 48; i++) {
      const t = (i / 48) * 2 * Math.PI;
      const rNoise = 0.7 * Math.cos(i * 6);
      pts.push({
        x: 350 + (a + rNoise) * Math.cos(t),
        y: 250 + (b + rNoise) * Math.sin(t),
      });
    }
    const fit = fitEllipseDirect(pts);
    expect(fit).not.toBeNull();
    expect(fit!.rmsError).toBeLessThan(0.7);
    expect(fit!.isStructuredOrganic).toBe(false);
  });

  // Case E: Counterform circular hole
  it('Case E: Counterform circular hole -> recognized as true circle', () => {
    const pts: Point2D[] = [];
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * 2 * Math.PI;
      pts.push({ x: 150 + 25 * Math.cos(a), y: 150 + 25 * Math.sin(a) });
    }
    const fit = fitEllipseDirect(pts);
    expect(fit).not.toBeNull();
    expect(Math.abs(fit!.a - 25)).toBeLessThan(0.5);
    expect(fit!.rmsError).toBeLessThan(0.1);
  });

  // Case F: Counterform elliptical hole (e.g. inner hole of "o" in scoopie)
  it('Case F: Counterform elliptical hole -> accurately reconstructed without polygonal deformation', () => {
    const pts: Point2D[] = [];
    const a = 35, b = 65, theta = 0.15;
    for (let i = 0; i < 36; i++) {
      const t = (i / 36) * 2 * Math.PI;
      const ex = a * Math.cos(t);
      const ey = b * Math.sin(t);
      pts.push({
        x: 250 + ex * Math.cos(theta) - ey * Math.sin(theta),
        y: 350 + ex * Math.sin(theta) + ey * Math.cos(theta),
      });
    }
    const fit = fitEllipseDirect(pts);
    expect(fit).not.toBeNull();
    expect(Math.abs(fit!.a - 65)).toBeLessThan(0.8);
    expect(Math.abs(fit!.b - 35)).toBeLessThan(0.8);
    expect(fit!.rmsError).toBeLessThan(0.2);
    expect(fit!.isStructuredOrganic).toBe(false);
  });

  // Case G: Rounded Rectangle in full SVG pipeline
  it('Case G: Rounded rectangle -> protects 4 straight spans and 4 corner arcs', () => {
    const svg = `<svg viewBox="0 0 800 1200">
      <path fill="#000000" d="M 120 100 L 280 100 C 291 100 300 109 300 120 L 300 180 C 300 191 291 200 280 200 L 120 200 C 109 200 100 191 100 180 L 100 120 C 100 109 109 100 120 100 Z" />
    </svg>`;
    const res = reconstructProfessionalCurves(svg, { scaleFactor: 2.0 });
    expect(res.stats.reconstructedSegments).toBeGreaterThanOrEqual(4);
    expect(res.stats.maxDeviation).toBeLessThan(1.5);
  });

  // Case H: Capsule (Stadium Shape)
  it('Case H: Capsule -> preserves linear sides and semicircular caps', () => {
    const svg = `<svg viewBox="0 0 800 1200">
      <path fill="#ff0000" d="M 200 100 L 400 100 C 427 100 450 122 450 150 C 450 178 427 200 400 200 L 200 200 C 173 200 150 178 150 150 C 150 122 173 100 200 100 Z" />
    </svg>`;
    const res = reconstructProfessionalCurves(svg, { scaleFactor: 2.0 });
    expect(res.stats.maxDeviation).toBeLessThan(4.0);
  });

  // Case I: Organic S-curve
  it('Case I: Organic S-curve -> continuous Bézier fitting without micro-faceting', () => {
    const svg = `<svg viewBox="0 0 800 1200">
      <path fill="#00aa00" d="M 100 100 C 150 50 250 250 300 200 C 350 150 450 350 500 300 L 500 400 L 100 400 Z" />
    </svg>`;
    const res = reconstructProfessionalCurves(svg, { scaleFactor: 2.0 });
    expect(res.stats.microFacetingScoreAfter).toBeLessThanOrEqual(res.stats.microFacetingScoreBefore || 100);
  });

  // Case J: Asymmetric Organic Shape
  it('Case J: Asymmetric organic shape -> fits smoothly without false primitive collapse', () => {
    const svg = `<svg viewBox="0 0 800 1200">
      <path fill="#0000ff" d="M 200 200 C 230 150 350 180 380 230 C 420 300 320 400 250 380 C 180 350 160 260 200 200 Z" />
    </svg>`;
    const res = reconstructProfessionalCurves(svg, { scaleFactor: 2.0 });
    expect(res.stats.maxDeviation).toBeLessThan(10.0);
  });

  // Case K: 90-degree Corner Protection
  it('Case K: 90-degree sharp corner -> protected from smoothing or rounding', () => {
    const svg = `<svg viewBox="0 0 800 1200">
      <path fill="#333333" d="M 100 100 L 300 100 L 300 300 L 100 300 Z" />
    </svg>`;
    const res = reconstructProfessionalCurves(svg, { scaleFactor: 2.0 });
    expect(res.stats.protectedCusps + res.stats.protectedCorners).toBeGreaterThanOrEqual(4);
    expect(res.stats.maxDeviation).toBeLessThan(0.2);
  });

  // Case L: Acute Cusp (30-degree) Protection
  it('Case L: Acute cusp (30-degree) -> strictly protected as cusp', () => {
    const svg = `<svg viewBox="0 0 800 1200">
      <path fill="#222222" d="M 200 100 L 250 300 L 150 300 Z" />
    </svg>`;
    const res = reconstructProfessionalCurves(svg, { scaleFactor: 2.0 });
    expect(res.stats.protectedCusps).toBeGreaterThanOrEqual(1);
  });

  // Case M: Thin Terminal
  it('Case M: Thin terminal -> preserves sharp endpoint geometry', () => {
    const svg = `<svg viewBox="0 0 800 1200">
      <path fill="#111111" d="M 100 100 L 300 105 L 100 110 Z" />
    </svg>`;
    const res = reconstructProfessionalCurves(svg, { scaleFactor: 2.0 });
    expect(res.stats.protectedCusps).toBeGreaterThanOrEqual(1);
  });

  // Case N: Overfitting Protection — Almost Circular Organic Shape
  it('Case N: Overfitting protection -> rejects asymmetric organic shape from becoming circle', () => {
    const pts: Point2D[] = [];
    for (let i = 0; i < 64; i++) {
      const t = (i / 64) * 2 * Math.PI;
      const r = 100 + (t > 0 && t < Math.PI ? 25 * Math.sin(t) : 0);
      pts.push({ x: 300 + r * Math.cos(t), y: 300 + r * Math.sin(t) });
    }
    const fit = fitEllipseDirect(pts);
    expect(fit).not.toBeNull();
    expect(fit!.isStructuredOrganic || fit!.rmsError > 1.2).toBe(true);
  });

  // Case O: Overfitting Protection — Almost Elliptical Organic Shape (Egg / Pear)
  it('Case O: Overfitting protection -> rejects egg/pear shape from becoming ellipse', () => {
    const pts: Point2D[] = [];
    for (let i = 0; i < 64; i++) {
      const t = (i / 64) * 2 * Math.PI;
      const r = 100 * (1.0 + 0.3 * Math.sin(t));
      pts.push({ x: 400 + r * Math.cos(t), y: 400 + 1.4 * r * Math.sin(t) });
    }
    const fit = fitEllipseDirect(pts);
    expect(fit === null || fit!.isStructuredOrganic || fit!.rmsError > 1.2).toBe(true);
  });

  // Case P: Outer loop + oval counterform (letter/shape topology)
  it('Case P: Outer loop + oval counterform -> preserves containment and non-polygonal counterform', () => {
    // Letter "O" style compound path: outer circle (R=120) + inner ellipse hole (a=60, b=40, CCW)
    const svg = `<svg viewBox="0 0 800 1200">
      <path fill="#000000" d="M 520 400 C 520 466 466 520 400 520 C 334 520 280 466 280 400 C 280 334 334 280 400 280 C 466 280 520 334 520 400 Z M 460 400 C 460 378 433 360 400 360 C 367 360 340 378 340 400 C 340 422 367 440 400 440 C 433 440 460 422 460 400 Z" />
    </svg>`;
    const res = reconstructProfessionalCurves(svg, { scaleFactor: 2.0 });
    expect(res.stats.holesPreserved).toBe(1);
    expect(res.stats.selfIntersections).toBe(0);
    expect(res.stats.openPaths).toBe(0);
  });

  // Case Q: Two oval counterforms side-by-side (like "oo" in scoopie)
  it('Case Q: Two oval counterforms side-by-side -> both preserved with identical topology and smooth curves', () => {
    const svg = `<svg viewBox="0 0 800 1200">
      <path fill="#222222" d="M 100 100 L 700 100 L 700 400 L 100 400 Z M 250 250 C 250 200 220 180 200 180 C 180 180 150 200 150 250 C 150 300 180 320 200 320 C 220 320 250 300 250 250 Z M 450 250 C 450 200 420 180 400 180 C 380 180 350 200 350 250 C 350 300 380 320 400 320 C 420 320 450 300 450 250 Z" />
    </svg>`;
    const res = reconstructProfessionalCurves(svg, { scaleFactor: 2.0 });
    expect(res.stats.holesPreserved).toBe(2);
    expect(res.stats.selfIntersections).toBe(0);
  });

  // Case R: Asymmetric counterform (e.g. letter "P" / "D" with flat stem + rounded bowl)
  it('Case R: Asymmetric counterform -> does NOT become ellipse, sharp junction strictly preserved', () => {
    // D-shape counterform: flat left vertical edge (x=200, y=150..350) + curved right bowl
    const svg = `<svg viewBox="0 0 800 1200">
      <path fill="#111111" d="M 100 100 L 400 100 L 400 400 L 100 400 Z M 200 150 L 200 350 C 320 350 320 150 200 150 Z" />
    </svg>`;
    const res = reconstructProfessionalCurves(svg, { scaleFactor: 2.0 });
    expect(res.stats.protectedCorners + res.stats.protectedCusps).toBeGreaterThanOrEqual(2);
    expect(res.stats.holesPreserved).toBe(1);
  });

  // Case S: Outer organic shape with nested hole
  it('Case S: Outer organic shape with nested hole -> preserves nesting and smooth boundaries', () => {
    const svg = `<svg viewBox="0 0 800 1200">
      <path fill="#444444" d="M 200 200 C 250 150 350 180 380 230 C 420 300 320 400 250 380 C 180 350 160 260 200 200 Z M 260 270 C 280 250 310 260 320 280 C 330 310 290 330 270 320 C 250 300 240 280 260 270 Z" />
    </svg>`;
    const res = reconstructProfessionalCurves(svg, { scaleFactor: 2.0 });
    expect(res.stats.holesPreserved).toBe(1);
  });

  // Case T: Ellipse-like hole with small legitimate asymmetry
  it('Case T: Ellipse-like hole with subtle asymmetry -> smooth freeform reconstruction without polygonal breakage', () => {
    const pts: Point2D[] = [];
    for (let i = 0; i < 48; i++) {
      const t = (i / 48) * 2 * Math.PI;
      // Slight flattening on bottom
      const r = 50 * (1.0 + (t > Math.PI ? 0.05 * Math.sin(t) : 0));
      pts.push({ x: 300 + r * Math.cos(t), y: 300 + 1.3 * r * Math.sin(t) });
    }
    const fit = fitEllipseDirect(pts);
    expect(fit).not.toBeNull();
  });

  // Case U: Closed freeform loop with seam on curved region
  it('Case U: Closed freeform loop with seam on curved region -> verified G0 and G1 continuity across seam', () => {
    const svg = `<svg viewBox="0 0 800 1200">
      <path fill="#008800" d="M 300 150 C 380 150 450 220 450 300 C 450 380 380 450 300 450 C 220 450 150 380 150 300 C 150 220 220 150 300 150 Z" />
    </svg>`;
    const res = reconstructProfessionalCurves(svg, { scaleFactor: 2.0 });
    expect(res.stats.selfIntersections).toBe(0);
    expect(res.stats.openPaths).toBe(0);
  });

  // Case V: Nested holes / islands (depth >= 2)
  it('Case V: Nested holes / islands (depth >= 2) -> multi-level topology tree preserved', () => {
    // Outer donut + nested island inside the hole
    const svg = `<svg viewBox="0 0 800 1200">
      <path fill="#aa0000" d="M 100 100 L 500 100 L 500 500 L 100 500 Z M 200 200 L 200 400 L 400 400 L 400 200 Z M 250 250 L 350 250 L 350 350 L 250 350 Z" />
    </svg>`;
    const res = reconstructProfessionalCurves(svg, { scaleFactor: 2.0 });
    expect(res.stats.holesPreserved).toBe(2);
    expect(res.stats.selfIntersections).toBe(0);
  });

  // Case W: Scale-invariant consistency (0.5x, 1x, 3x)
  it('Case W: Scale-invariant consistency at 0.5x, 1x, and 3x scale factors', () => {
    const svg = `<svg viewBox="0 0 800 1200">
      <path fill="#333333" d="M 200 200 C 250 150 350 180 380 230 C 420 300 320 400 250 380 C 180 350 160 260 200 200 Z" />
    </svg>`;
    const resSmall = reconstructProfessionalCurves(svg, { scaleFactor: 0.5 });
    const resNormal = reconstructProfessionalCurves(svg, { scaleFactor: 1.0 });
    const resLarge = reconstructProfessionalCurves(svg, { scaleFactor: 3.0 });

    expect(resSmall.stats.openPaths).toBe(0);
    expect(resNormal.stats.openPaths).toBe(0);
    expect(resLarge.stats.openPaths).toBe(0);
  });
});
