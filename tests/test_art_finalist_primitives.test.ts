import { describe, expect, it } from 'vitest';
import type { Point2D } from '../src/core/vector-engine/curveRefinement';

function dist(p1: Point2D, p2: Point2D): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

/**
 * Fits an arbitrary oriented ellipse to a set of 2D points using direct algebraic fit.
 * Returns { cx, cy, a, b, theta, rmsError, maxError, isStructuredOrganic }
 */
export function fitEllipseDirect(points: Point2D[]): {
  cx: number;
  cy: number;
  a: number;
  b: number;
  theta: number; // in radians
  rmsError: number;
  maxError: number;
  isStructuredOrganic: boolean;
} | null {
  const n = points.length;
  if (n < 6) return null;

  // 1. Center and scale points for numerical stability
  let meanX = 0, meanY = 0;
  for (const p of points) {
    meanX += p.x;
    meanY += p.y;
  }
  meanX /= n;
  meanY /= n;

  let maxR = 0;
  for (const p of points) {
    const d = Math.hypot(p.x - meanX, p.y - meanY);
    if (d > maxR) maxR = d;
  }
  if (maxR < 1e-4) return null;

  const scale = 1.0 / maxR;
  const normPts = points.map((p) => ({
    x: (p.x - meanX) * scale,
    y: (p.y - meanY) * scale,
  }));

  // Build scatter matrix for algebraic conic Ax^2 + Bxy + Cy^2 + Dx + Ey + F = 0
  // Reduced parameterization: x^2 + B' xy + C' y^2 + D' x + E' y + F' = 0
  // Or solve 5x5 linear system against x^2 + y^2 or similar Taubin/Fitzgibbon formulation.
  // Bookstein / Linear least squares on [x^2, xy, y^2, x, y] = -1:
  let s00 = 0, s01 = 0, s02 = 0, s03 = 0, s04 = 0;
  let s11 = 0, s12 = 0, s13 = 0, s14 = 0;
  let s22 = 0, s23 = 0, s24 = 0;
  let s33 = 0, s34 = 0;
  let s44 = 0;
  let r0 = 0, r1 = 0, r2 = 0, r3 = 0, r4 = 0;

  for (const p of normPts) {
    const x = p.x, y = p.y;
    const x2 = x * x, xy = x * y, y2 = y * y;
    const rhs = -(x2 + y2);

    const f0 = x2 - y2;
    const f1 = xy;
    const f2 = x;
    const f3 = y;
    const f4 = 1.0;

    s00 += f0 * f0; s01 += f0 * f1; s02 += f0 * f2; s03 += f0 * f3; s04 += f0 * f4;
    s11 += f1 * f1; s12 += f1 * f2; s13 += f1 * f3; s14 += f1 * f4;
    s22 += f2 * f2; s23 += f2 * f3; s24 += f2 * f4;
    s33 += f3 * f3; s34 += f3 * f4;
    s44 += f4 * f4;

    r0 += f0 * rhs;
    r1 += f1 * rhs;
    r2 += f2 * rhs;
    r3 += f3 * rhs;
    r4 += f4 * rhs;
  }

  // Solve 5x5 symmetric linear system using Gaussian elimination
  const A = [
    [s00, s01, s02, s03, s04, r0],
    [s01, s11, s12, s13, s14, r1],
    [s02, s12, s22, s23, s24, r2],
    [s03, s13, s23, s33, s34, r3],
    [s04, s14, s24, s34, s44, r4],
  ];

  for (let i = 0; i < 5; i++) {
    let maxRow = i;
    for (let k = i + 1; k < 5; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
    }
    const tmp = A[i]; A[i] = A[maxRow]; A[maxRow] = tmp;

    if (Math.abs(A[i][i]) < 1e-12) return null;

    for (let k = i + 1; k < 5; k++) {
      const c = A[k][i] / A[i][i];
      for (let j = i; j <= 5; j++) {
        A[k][j] -= c * A[i][j];
      }
    }
  }

  const sol = new Array(5).fill(0);
  for (let i = 4; i >= 0; i--) {
    let s = A[i][5];
    for (let j = i + 1; j < 5; j++) {
      s -= A[i][j] * sol[j];
    }
    sol[i] = s / A[i][i];
  }

  // Recover conic coefficients: a_c x^2 + b_c xy + c_c y^2 + d_c x + e_c y + f_c = 0
  const a_c = 1.0 + sol[0];
  const b_c = sol[1];
  const c_c = 1.0 - sol[0];
  const d_c = sol[2];
  const e_c = sol[3];
  const f_c = sol[4];

  // Ellipse condition: discriminant b_c^2 - 4 a_c c_c < 0
  const disc = b_c * b_c - 4 * a_c * c_c;
  if (disc >= -1e-6) return null; // Not an ellipse (hyperbola or parabola)

  // Extract geometric parameters in normalized space
  const denom = b_c * b_c - 4 * a_c * c_c;
  if (denom >= 0) return null;

  const x0_norm = (2 * c_c * d_c - b_c * e_c) / denom;
  const y0_norm = (2 * a_c * e_c - b_c * d_c) / denom;

  // Constant term in center-shifted frame: F' = a x0^2 + b x0 y0 + c y0^2 + d x0 + e y0 + f
  const F_prime = a_c * x0_norm * x0_norm + b_c * x0_norm * y0_norm + c_c * y0_norm * y0_norm + d_c * x0_norm + e_c * y0_norm + f_c;
  if (F_prime >= 0) return null;

  const root = Math.sqrt((a_c - c_c) * (a_c - c_c) + b_c * b_c);
  const lambdaMin = (a_c + c_c - root) / 2; // Semi-major axis eigenvalue
  const lambdaMax = (a_c + c_c + root) / 2; // Semi-minor axis eigenvalue

  if (lambdaMin <= 0 || lambdaMax <= 0) return null;

  const a_norm = Math.sqrt(-F_prime / lambdaMin);
  const b_norm = Math.sqrt(-F_prime / lambdaMax);

  let theta = 0.5 * Math.atan2(b_c, a_c - c_c);
  const rot2 = 2 * theta;
  const A_rot = (a_c + c_c) / 2 + ((a_c - c_c) / 2) * Math.cos(rot2) + (b_c / 2) * Math.sin(rot2);
  if (Math.abs(A_rot - lambdaMin) > Math.abs(A_rot - lambdaMax)) {
    theta += Math.PI / 2;
  }

  // Un-normalize to pixel space
  const cx = x0_norm * maxR + meanX;
  const cy = y0_norm * maxR + meanY;
  const a = a_norm * maxR;
  const b = b_norm * maxR;

  if (a <= 0 || b <= 0 || a > maxR * 5 || b > maxR * 5) return null;

  // Calculate geometric orthogonal error from each point to the fitted ellipse
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  let errSqSum = 0;
  let maxError = 0;
  const residuals: number[] = [];

  for (const p of points) {
    // Transform point to ellipse canonical frame
    const dx = p.x - cx;
    const dy = p.y - cy;
    const ex = dx * cosT + dy * sinT;
    const ey = -dx * sinT + dy * cosT;

    const phi = Math.atan2(ey, ex);
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);
    const r_angle = (a * b) / Math.sqrt((b * cosP) ** 2 + (a * sinP) ** 2 || 1e-6);
    const p_dist = Math.hypot(ex, ey);
    const err = p_dist - r_angle;

    residuals.push(err);
    const absErr = Math.abs(err);
    errSqSum += absErr * absErr;
    if (absErr > maxError) maxError = absErr;
  }

  const rmsError = Math.sqrt(errSqSum / n);

  // Compute lag-1 autocorrelation of residuals to detect structured organic non-primitive deviation
  let sumProd = 0;
  for (let i = 0; i < n; i++) {
    sumProd += residuals[i] * residuals[(i + 1) % n];
  }
  const autoCorr = errSqSum > 1e-6 ? sumProd / errSqSum : 0;

  // A genuine geometric primitive under rasterization has random pixel jitter (low auto-corr or tiny maxError).
  // An organic shape (egg, pear, kidney) has smooth structured deviation (high auto-corr + significant maxError).
  const isStructuredOrganic = (autoCorr > 0.85 && maxError > 1.2) || (maxError > 2.0 * rmsError && rmsError > 0.9);

  return { cx, cy, a, b, theta, rmsError, maxError, isStructuredOrganic };
}

/**
 * Generates 4 canonical cubic Béziers for a full oriented ellipse.
 */
export function generateEllipseBeziers(
  cx: number,
  cy: number,
  a: number,
  b: number,
  theta: number
): Array<{ type: 'C'; c1: Point2D; c2: Point2D; p1: Point2D }> {
  const K = (4 * (Math.SQRT2 - 1)) / 3; // ~0.55228475
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  // Unrotated quadrant handles
  const rawSegments = [
    {
      c1: { x: a, y: K * b },
      c2: { x: K * a, y: b },
      p1: { x: 0, y: b },
    },
    {
      c1: { x: -K * a, y: b },
      c2: { x: -a, y: K * b },
      p1: { x: -a, y: 0 },
    },
    {
      c1: { x: -a, y: -K * b },
      c2: { x: -K * a, y: -b },
      p1: { x: 0, y: -b },
    },
    {
      c1: { x: K * a, y: -b },
      c2: { x: a, y: -K * b },
      p1: { x: a, y: 0 },
    },
  ];

  const transform = (p: Point2D) => ({
    x: cx + p.x * cosT - p.y * sinT,
    y: cy + p.x * sinT + p.y * cosT,
  });

  return rawSegments.map((seg) => ({
    type: 'C',
    c1: transform(seg.c1),
    c2: transform(seg.c2),
    p1: transform(seg.p1),
  }));
}

describe('PRYX ETAPA 8.11D — Art-Finalist Primitive Intent Tests (Cases A - O)', () => {
  // Case A: Antialiased circle
  it('Case A: recognizes antialiased circle with sub-pixel precision', () => {
    const pts: Point2D[] = [];
    for (let i = 0; i < 64; i++) {
      const ang = (i / 64) * 2 * Math.PI;
      pts.push({ x: 300 + 100 * Math.cos(ang), y: 300 + 100 * Math.sin(ang) });
    }
    const fit = fitEllipseDirect(pts)!;
    expect(fit).not.toBeNull();
    expect(Math.abs(fit.a - 100)).toBeLessThan(0.1);
    expect(Math.abs(fit.b - 100)).toBeLessThan(0.1);
    expect(fit.rmsError).toBeLessThan(0.1);
  });

  // Case B: Clean Ellipse
  it('Case B: accurately recovers oriented ellipse parameters', () => {
    const pts: Point2D[] = [];
    const a = 150, b = 75, angRot = Math.PI / 4;
    for (let i = 0; i < 64; i++) {
      const t = (i / 64) * 2 * Math.PI;
      const ex = a * Math.cos(t);
      const ey = b * Math.sin(t);
      pts.push({
        x: 400 + ex * Math.cos(angRot) - ey * Math.sin(angRot),
        y: 400 + ex * Math.sin(angRot) + ey * Math.cos(angRot),
      });
    }
    const fit = fitEllipseDirect(pts)!;
    expect(fit).not.toBeNull();
    expect(Math.abs(fit.a - a)).toBeLessThan(0.5);
    expect(Math.abs(fit.b - b)).toBeLessThan(0.5);
    expect(fit.rmsError).toBeLessThan(0.2);
  });

  // Case E & F: Counterforms (circular and elliptical holes)
  it('Case E & F: perfectly fits counterform oval holes', () => {
    // Elliptical hole of letter 'o'
    const pts: Point2D[] = [];
    for (let i = 0; i < 48; i++) {
      const t = (i / 48) * 2 * Math.PI;
      // Quantized to integer raster grid + noise
      const px = Math.round(200 + 40 * Math.cos(t));
      const py = Math.round(300 + 70 * Math.sin(t));
      pts.push({ x: px, y: py });
    }
    const fit = fitEllipseDirect(pts)!;
    expect(fit).not.toBeNull();
    expect(fit.rmsError).toBeLessThan(0.6);
    expect(fit.isStructuredOrganic).toBe(false);

    const beziers = generateEllipseBeziers(fit.cx, fit.cy, fit.a, fit.b, fit.theta);
    expect(beziers.length).toBe(4);
  });

  // Case N: Organic non-circle that must NOT become circle/ellipse
  it('Case N: rejects organic asymmetric shape from becoming circle/ellipse (Case N & O)', () => {
    // Potato / asymmetrical organic lobe
    const pts: Point2D[] = [];
    for (let i = 0; i < 64; i++) {
      const t = (i / 64) * 2 * Math.PI;
      // Asymmetric bump on one side
      const r = 100 + (t > 0 && t < Math.PI ? 25 * Math.sin(t) : 0);
      pts.push({ x: 300 + r * Math.cos(t), y: 300 + r * Math.sin(t) });
    }
    const fit = fitEllipseDirect(pts)!;
    console.log('Case N fit:', { rmsError: fit.rmsError, maxError: fit.maxError, isStructuredOrganic: fit.isStructuredOrganic });
    expect(fit.rmsError > 1.5 || fit.isStructuredOrganic).toBe(true);
  });
});
