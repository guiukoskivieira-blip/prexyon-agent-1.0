import { describe, expect, it } from 'vitest';
import {
  reconstructPeriodicClosedLoop,
  reverseBezierPathD,
  evaluateTransitionRegion,
  parseSvgPathDToSubpaths,
  computePolygonMetrics,
  reconstructCanonicalSvg816c,
} from '../src/core/vector-engine/canonicalSharedBoundary816c';
import type { Point2D } from '../src/core/vector-engine/curveRefinement';

function dist(p1: Point2D, p2: Point2D): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

describe('PRYX — ETAPA 8.16C: Canonical Shared Boundaries & Periodic Closed Loops (Tests A - N)', () => {
  // Test A: two colored regions with straight shared boundary
  it('Test A: two colored regions with straight shared boundary -> zero gap and canonical duality', () => {
    const fwdD = 'M 0.00 0.00 L 100.00 0.00 L 100.00 200.00 L 0.00 200.00 Z';
    const revD = reverseBezierPathD(fwdD);
    const spFwd = parseSvgPathDToSubpaths(fwdD)[0];
    const spRev = parseSvgPathDToSubpaths(revD)[0];

    // Shared edge between (100,0) and (100,200)
    let maxGap = 0;
    for (const p of spFwd) {
      let minD = Infinity;
      for (const q of spRev) minD = Math.min(minD, dist(p, q));
      maxGap = Math.max(maxGap, minD);
    }
    expect(maxGap).toBeLessThanOrEqual(0.001);
  });

  // Test B: two colored regions with curved shared boundary
  it('Test B: two colored regions with curved shared boundary -> exact point(t) == revPoint(1-t)', () => {
    const fwdD = 'M 50.00 50.00 C 75.00 20.00 125.00 20.00 150.00 50.00 C 175.00 80.00 125.00 120.00 50.00 50.00 Z';
    const revD = reverseBezierPathD(fwdD);
    const spFwd = parseSvgPathDToSubpaths(fwdD)[0];
    const spRev = parseSvgPathDToSubpaths(revD)[0];

    let maxGap = 0;
    for (const p of spFwd) {
      let minD = Infinity;
      for (const q of spRev) minD = Math.min(minD, dist(p, q));
      maxGap = Math.max(maxGap, minD);
    }
    expect(maxGap).toBeLessThanOrEqual(0.001);
  });

  // Test C: three legitimate adjacent colors
  it('Test C: three legitimate adjacent colors -> all classified as LEGITIMATE_REGION', () => {
    const decRed = evaluateTransitionRegion('#792823', '#0567db', '#fefce0', {
      area: 600000,
      perimeter: 4000,
      elongation: 2.1,
      meanThickness: 300,
    });
    const decBlue = evaluateTransitionRegion('#0567db', '#792823', '#fefce0', {
      area: 700000,
      perimeter: 4500,
      elongation: 2.3,
      meanThickness: 310,
    });
    const decBeige = evaluateTransitionRegion('#fefce0', '#792823', '#0567db', {
      area: 8000000,
      perimeter: 12000,
      elongation: 1.4,
      meanThickness: 1333,
    });
    expect(decRed.classification).toBe('LEGITIMATE_REGION');
    expect(decBlue.classification).toBe('LEGITIMATE_REGION');
    expect(decBeige.classification).toBe('LEGITIMATE_REGION');
  });

  // Test D: antialias strip between A/B
  it('Test D: antialias strip between A/B -> classified as TRANSITION_ARTIFACT and absorbed', () => {
    // #ffe0d1 is intermediate between #792823 (red) and #fefce0 (beige)
    const dec = evaluateTransitionRegion('#ffe0d1', '#792823', '#fefce0', {
      area: 4500,
      perimeter: 1200,
      elongation: 6.8,
      meanThickness: 3.75,
    });
    expect(dec.classification).toBe('TRANSITION_ARTIFACT');
    expect(dec.mixtureResidual).toBeLessThanOrEqual(20.0);
    expect(dec.targetAbsorptionColor).toBeDefined();
  });

  // Test E: legitimate thin third-color stripe
  it('Test E: legitimate thin third-color stripe -> not a convex mix, preserved as LEGITIMATE or AMBIGUOUS', () => {
    // Green (#00ff00) is completely orthogonal to red (#792823) and beige (#fefce0)
    const dec = evaluateTransitionRegion('#00ff00', '#792823', '#fefce0', {
      area: 8000,
      perimeter: 1600,
      elongation: 7.0,
      meanThickness: 5.0,
    });
    expect(dec.classification).not.toBe('TRANSITION_ARTIFACT');
    expect(dec.mixtureResidual).toBeGreaterThan(15.0);
  });

  // Test F: JPEG transition strip
  it('Test F: JPEG transition strip -> classified as TRANSITION_ARTIFACT for micro transient', () => {
    const dec = evaluateTransitionRegion('#f0dfd0', '#792823', '#fefce0', {
      area: 120,
      perimeter: 60,
      elongation: 1.8,
      meanThickness: 2.0,
    });
    expect(dec.classification).toBe('TRANSITION_ARTIFACT');
  });

  // Test G: donut smooth closed loop
  it('Test G: donut smooth closed loop -> periodic smooth fitting with zero seam kink', () => {
    const pts: Point2D[] = [];
    for (let a = 0; a < 360; a += 10) {
      const rad = (a * Math.PI) / 180;
      pts.push({ x: 100 + 50 * Math.cos(rad), y: 100 + 50 * Math.sin(rad) });
    }
    const res = reconstructPeriodicClosedLoop(pts);
    expect(res.isPeriodicSmooth).toBe(true);
    expect(res.seamTangentDeltaDeg).toBe(0.0);
    expect(res.startIndexInvarianceMaxDrift).toBeLessThanOrEqual(0.6);
  });

  // Test H: lettering-like O
  it('Test H: lettering-like O -> periodic smooth closed loop with high symmetry', () => {
    const pts: Point2D[] = [];
    for (let a = 0; a < 360; a += 15) {
      const rad = (a * Math.PI) / 180;
      pts.push({ x: 200 + 80 * Math.cos(rad), y: 300 + 120 * Math.sin(rad) });
    }
    const res = reconstructPeriodicClosedLoop(pts);
    expect(res.isPeriodicSmooth).toBe(true);
    expect(res.anchorCount).toBeGreaterThanOrEqual(4);
    expect(res.pathD.endsWith('Z')).toBe(true);
  });

  // Test I: lettering-like P counterform
  it('Test I: lettering-like P counterform -> counterform morphology preserved', () => {
    const pts: Point2D[] = [];
    for (let a = 0; a < 360; a += 15) {
      const rad = (a * Math.PI) / 180;
      pts.push({ x: 150 + 30 * Math.cos(rad), y: 180 + 40 * Math.sin(rad) });
    }
    const metricsBefore = computePolygonMetrics(pts);
    const res = reconstructPeriodicClosedLoop(pts);
    const reconPts = parseSvgPathDToSubpaths(res.pathD)[0];
    const metricsAfter = computePolygonMetrics(reconPts);

    const areaDrift = Math.abs(metricsAfter.area - metricsBefore.area) / metricsBefore.area;
    const centroidDrift = dist(metricsAfter.centroid, metricsBefore.centroid);

    expect(areaDrift).toBeLessThanOrEqual(0.05);
    expect(centroidDrift).toBeLessThanOrEqual(0.5);
  });

  // Test J: organic closed loop
  it('Test J: organic closed loop -> continuous curvature and start-index invariance', () => {
    const pts: Point2D[] = [];
    for (let a = 0; a < 360; a += 5) {
      const rad = (a * Math.PI) / 180;
      const r = 60 + 15 * Math.sin(3 * rad);
      pts.push({ x: 250 + r * Math.cos(rad), y: 250 + r * Math.sin(rad) });
    }
    const res = reconstructPeriodicClosedLoop(pts);
    expect(res.isPeriodicSmooth).toBe(true);
    expect(res.startIndexInvarianceMaxDrift).toBeLessThanOrEqual(0.6);
  });

  // Test K: closed loop with legitimate sharp corner
  it('Test K: closed loop with legitimate sharp corner -> preserves G0 sharp corner breakpoint', () => {
    const pts: Point2D[] = [
      { x: 50, y: 50 },
      { x: 150, y: 50 },
      { x: 150, y: 150 },
      { x: 50, y: 150 },
    ];
    const res = reconstructPeriodicClosedLoop(pts, { cornerAngleDeg: 42 });
    expect(res.isPeriodicSmooth).toBe(false);
    expect(res.anchorCount).toBeGreaterThanOrEqual(4);
  });

  // Test L: start-index rotations 0–90%
  it('Test L: start-index rotations 0–90% -> invariant geometry across all 10 phases', () => {
    const pts: Point2D[] = [];
    for (let a = 0; a < 360; a += 10) {
      const rad = (a * Math.PI) / 180;
      pts.push({ x: 100 + 45 * Math.cos(rad), y: 100 + 45 * Math.sin(rad) });
    }
    const n = pts.length;
    const baseRes = reconstructPeriodicClosedLoop(pts);
    const baseSubpath = parseSvgPathDToSubpaths(baseRes.pathD)[0];

    for (let pct = 0.1; pct <= 0.9; pct += 0.1) {
      const shift = Math.floor(n * pct);
      const rotPts = [...pts.slice(shift), ...pts.slice(0, shift)];
      const rotRes = reconstructPeriodicClosedLoop(rotPts);
      const rotSubpath = parseSvgPathDToSubpaths(rotRes.pathD)[0];

      let maxDist = 0;
      for (const p1 of baseSubpath) {
        let minD = Infinity;
        for (let i = 0; i < rotSubpath.length - 1; i++) {
          const a = rotSubpath[i];
          const b = rotSubpath[i + 1];
          const l2 = (b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y);
          const t = l2 > 0 ? Math.max(0, Math.min(1, ((p1.x - a.x) * (b.x - a.x) + (p1.y - a.y) * (b.y - a.y)) / l2)) : 0;
          const proj = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
          minD = Math.min(minD, dist(p1, proj));
        }
        maxDist = Math.max(maxDist, minD);
      }
      expect(maxDist).toBeLessThanOrEqual(0.6);
    }
  });

  // Test M: shared boundary at 0.5x / 1x / 2x / 4x
  it('Test M: shared boundary at 0.5x / 1x / 2x / 4x -> invariant zero gap across scales', () => {
    const scales = [0.5, 1.0, 2.0, 4.0];
    for (const scale of scales) {
      const fwdD = `M 0.00 0.00 C ${(30 * scale).toFixed(2)} ${(10 * scale).toFixed(2)} ${(70 * scale).toFixed(2)} ${(90 * scale).toFixed(2)} ${(100 * scale).toFixed(2)} ${(100 * scale).toFixed(2)} Z`;
      const revD = reverseBezierPathD(fwdD);
      const spFwd = parseSvgPathDToSubpaths(fwdD)[0];
      const spRev = parseSvgPathDToSubpaths(revD)[0];

      let maxGap = 0;
      for (const p of spFwd) {
        let minD = Infinity;
        for (const q of spRev) minD = Math.min(minD, dist(p, q));
        maxGap = Math.max(maxGap, minD);
      }
      expect(maxGap).toBeLessThanOrEqual(0.001);
    }
  });

  // Test N: multi-region junction / T-junction
  it('Test N: multi-region junction / T-junction -> robust topological consistency without overlap', () => {
    const svg = `<svg viewBox="0 0 300 300">
      <path fill="#792823" d="M 0 0 L 150 0 L 150 300 L 0 300 Z" />
      <path fill="#0567db" d="M 150 0 L 300 0 L 300 150 L 150 150 Z" />
      <path fill="#fefce0" d="M 150 150 L 300 150 L 300 300 L 150 300 Z" />
    </svg>`;
    const res = reconstructCanonicalSvg816c(svg, null);
    expect(res.verdict).toBe('V816C_READY_FOR_HUMAN_GATE');
    expect(res.metrics.selfIntersections).toBe(0);
    expect(res.metrics.openPaths).toBe(0);
  });
});
