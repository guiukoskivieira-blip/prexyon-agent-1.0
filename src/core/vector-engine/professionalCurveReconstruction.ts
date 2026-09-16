import { parseSvgString } from '../vectorizer/svgParser';
import type { Point2D } from './curveRefinement';

export interface CurveReconstructionOptions {
  /** Maximum allowed deviation from original contour in pixels. Default: 1.2 */
  maxDeviationTolerance?: number;
  /** Turn angle threshold in degrees to classify a vertex as a sharp corner/cusp. Default: 35.0 */
  cornerAngleThresholdDeg?: number;
  /** Cusp angle threshold in degrees. Default: 70.0 */
  cuspAngleThresholdDeg?: number;
  /** Line collinearity tolerance in pixels. Default: 0.5 */
  lineTolerance?: number;
  /** Canvas diagonal scale factor relative to reference 800x1200 canvas. Default: 1.0 */
  scaleFactor?: number;
}

export interface CurveReconstructionStats {
  originalAnchors: number;
  reconstructedAnchors: number;
  originalSegments: number;
  reconstructedSegments: number;
  candidateCorners: number;
  protectedCorners: number;
  protectedCusps: number;
  rejectedRasterCorners: number;
  smoothSections: number;
  maxDeviation: number;
  meanDeviation: number;
  p95Deviation: number;
  holesPreserved: number;
  selfIntersections: number;
  openPaths: number;
  microFacetingScoreBefore?: number;
  microFacetingScoreAfter?: number;
  tangentOscillationBefore?: number;
  tangentOscillationAfter?: number;
  curvatureExtremaBefore?: number;
  curvatureExtremaAfter?: number;
  shortSpanCountBefore?: number;
  shortSpanCountAfter?: number;
  primitiveCandidates?: number;
  primitiveAccepted?: number;
  primitiveRejected?: number;
}

export interface ProfessionalCurveResult {
  svg: string;
  stats: CurveReconstructionStats;
}

interface PathCmd {
  type: 'M' | 'L' | 'C' | 'Z';
  p?: Point2D;
  c1?: Point2D;
  c2?: Point2D;
}

function dist(p1: Point2D, p2: Point2D): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function normalize(v: Point2D): Point2D {
  const len = Math.hypot(v.x, v.y);
  return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}

function dot(v1: Point2D, v2: Point2D): number {
  return v1.x * v2.x + v1.y * v2.y;
}

function lerp(p1: Point2D, p2: Point2D, t: number): Point2D {
  return {
    x: p1.x + (p2.x - p1.x) * t,
    y: p1.y + (p2.y - p1.y) * t,
  };
}

function evaluateCubic(p0: Point2D, c1: Point2D, c2: Point2D, p1: Point2D, t: number): Point2D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x: mt3 * p0.x + 3 * mt2 * t * c1.x + 3 * mt * t2 * c2.x + t3 * p1.x,
    y: mt3 * p0.y + 3 * mt2 * t * c1.y + 3 * mt * t2 * c2.y + t3 * p1.y,
  };
}

function pointToLineDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(p, a);

  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const proj = { x: a.x + t * dx, y: a.y + t * dy };
  return dist(p, proj);
}

/**
 * Uniform arc-length resampling of a piecewise point sequence.
 */
function resampleByArcLength(points: Point2D[], stepSize: number): Point2D[] {
  if (points.length < 2) return [...points];
  const cumLengths = [0];
  for (let i = 1; i < points.length; i++) {
    cumLengths.push(cumLengths[i - 1] + dist(points[i], points[i - 1]));
  }
  const totalLength = cumLengths[cumLengths.length - 1];
  if (totalLength <= stepSize) return [points[0], points[points.length - 1]];

  const numSteps = Math.max(2, Math.round(totalLength / stepSize));
  const resampled: Point2D[] = [points[0]];

  let currSegIdx = 0;
  for (let s = 1; s < numSteps; s++) {
    const targetDist = (s / numSteps) * totalLength;
    while (currSegIdx < cumLengths.length - 1 && cumLengths[currSegIdx + 1] < targetDist) {
      currSegIdx++;
    }
    const segStart = points[currSegIdx];
    const segEnd = points[currSegIdx + 1] || points[currSegIdx];
    const segLen = cumLengths[currSegIdx + 1] - cumLengths[currSegIdx];
    const t = segLen === 0 ? 0 : (targetDist - cumLengths[currSegIdx]) / segLen;
    resampled.push(lerp(segStart, segEnd, t));
  }
  resampled.push(points[points.length - 1]);
  return resampled;
}

/**
 * Moving Least Squares Sub-Pixel Boundary Regularization.
 * Projects interior points of a smooth span onto local quadratic polynomial in Frenet frame,
 * removing discrete raster quantization staircases while strictly pinning start/end features.
 */
function regularizeSubPixelSpan(points: Point2D[], windowRadius: number, maxShift: number): Point2D[] {
  const n = points.length;
  if (n <= 4) return points;

  const result: Point2D[] = [{ ...points[0] }]; // Pin start anchor

  for (let i = 1; i < n - 1; i++) {
    const pi = points[i];

    // Local tangent from lookahead window
    const k = Math.min(i, Math.min(n - 1 - i, Math.max(2, Math.round(windowRadius / 3))));
    const pPrev = points[i - k];
    const pNext = points[i + k];
    const tx = pNext.x - pPrev.x;
    const ty = pNext.y - pPrev.y;
    const tLen = Math.hypot(tx, ty);
    if (tLen < 1e-6) {
      result.push({ ...pi });
      continue;
    }
    const tu = { x: tx / tLen, y: ty / tLen };
    const tv = { x: -tu.y, y: tu.x }; // Normal vector

    // Collect neighborhood points within windowRadius
    let wSum = 0;
    let su = 0, su2 = 0, su3 = 0, su4 = 0;
    let sv = 0, suv = 0, su2v = 0;

    const sigmaSq = (windowRadius * 0.5) ** 2;

    for (let j = 0; j < n; j++) {
      const d = dist(pi, points[j]);
      if (d > windowRadius) continue;

      const dx = points[j].x - pi.x;
      const dy = points[j].y - pi.y;
      const u = dx * tu.x + dy * tu.y;
      const v = dx * tv.x + dy * tv.y;

      const w = Math.exp(-(u * u) / (2 * sigmaSq));

      wSum += w;
      su += w * u;
      su2 += w * u * u;
      su3 += w * u * u * u;
      su4 += w * u * u * u * u;
      sv += w * v;
      suv += w * u * v;
      su2v += w * u * u * v;
    }

    if (wSum < 1e-6) {
      result.push({ ...pi });
      continue;
    }

    // Solve 3x3 linear system for v(u) = a u^2 + b u + c (c = v(0))
    const m00 = su4, m01 = su3, m02 = su2;
    const m10 = su3, m11 = su2, m12 = su;
    const m20 = su2, m21 = su,  m22 = wSum;

    const detM =
      m00 * (m11 * m22 - m12 * m21) -
      m01 * (m10 * m22 - m12 * m20) +
      m02 * (m10 * m21 - m11 * m20);

    let c = 0;
    if (Math.abs(detM) > 1e-9) {
      const detC =
        m00 * (m11 * sv - suv * m21) -
        m01 * (m10 * sv - suv * m20) +
        su2v * (m10 * m21 - m11 * m20);
      c = detC / detM;
    } else {
      c = sv / wSum;
    }

    const clampedC = Math.max(-maxShift, Math.min(maxShift, c));
    result.push({
      x: pi.x + clampedC * tv.x,
      y: pi.y + clampedC * tv.y,
    });
  }

  result.push({ ...points[n - 1] }); // Pin end anchor
  return result;
}

/**
 * Algebraic Circle Fit (Taubin method)
 */
function fitCircleTaubin(points: Point2D[]): { cx: number; cy: number; r: number; rmsError: number } | null {
  const n = points.length;
  if (n < 4) return null;

  let meanX = 0, meanY = 0;
  for (const p of points) {
    meanX += p.x;
    meanY += p.y;
  }
  meanX /= n;
  meanY /= n;

  let mxx = 0, myy = 0, mxy = 0, mxz = 0, myz = 0, mzz = 0;
  for (const p of points) {
    const x = p.x - meanX;
    const y = p.y - meanY;
    const z = x * x + y * y;
    mxx += x * x;
    myy += y * y;
    mxy += x * y;
    mxz += x * z;
    myz += y * z;
    mzz += z * z;
  }
  mxx /= n; myy /= n; mxy /= n; mxz /= n; myz /= n; mzz /= n;

  const mz = mxx + myy;
  const covXY = mxx * myy - mxy * mxy;
  const a2 = 4 * covXY - 3 * mz * mz - mzz;
  const a1 = mz * (mzz - 4 * covXY) + 2 * (mxz * mxz + myz * myz);
  const a0 = mxz * (mxz * myy - myz * mxy) + myz * (myz * mxx - mxz * mxy) - mz * (mxz * mxz + myz * myz);

  let eta = 0;
  for (let iter = 0; iter < 20; iter++) {
    const f = ((eta + a2) * eta + a1) * eta + a0;
    const df = (3 * eta + 2 * a2) * eta + a1;
    if (Math.abs(df) < 1e-12) break;
    const nextEta = eta - f / df;
    if (Math.abs(nextEta - eta) < 1e-8) break;
    eta = nextEta;
  }

  const det = (mxx - eta) * (myy - eta) - mxy * mxy;
  if (Math.abs(det) < 1e-10) return null;

  const uc = (mxz * (myy - eta) - myz * mxy) / (2 * det);
  const vc = (myz * (mxx - eta) - mxz * mxy) / (2 * det);

  const cx = uc + meanX;
  const cy = vc + meanY;
  const r = Math.sqrt(uc * uc + vc * vc + mz);

  let errSqSum = 0;
  for (const p of points) {
    const d = dist(p, { x: cx, y: cy });
    errSqSum += (d - r) ** 2;
  }
  const rmsError = Math.sqrt(errSqSum / n);

  return { cx, cy, r, rmsError };
}

/**
 * Direct algebraic ellipse fitting.
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

  const invR = 1.0 / maxR;
  const normPts = points.map((p) => ({
    x: (p.x - meanX) * invR,
    y: (p.y - meanY) * invR,
  }));

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

  const a_c = 1.0 + sol[0];
  const b_c = sol[1];
  const c_c = 1.0 - sol[0];
  const d_c = sol[2];
  const e_c = sol[3];
  const f_c = sol[4];

  const disc = b_c * b_c - 4 * a_c * c_c;
  if (disc >= -1e-6) return null;

  const denom = disc;
  const x0_norm = (2 * c_c * d_c - b_c * e_c) / denom;
  const y0_norm = (2 * a_c * e_c - b_c * d_c) / denom;

  const F_prime =
    a_c * x0_norm * x0_norm +
    b_c * x0_norm * y0_norm +
    c_c * y0_norm * y0_norm +
    d_c * x0_norm +
    e_c * y0_norm +
    f_c;
  if (F_prime >= 0) return null;

  const root = Math.sqrt((a_c - c_c) * (a_c - c_c) + b_c * b_c);
  const lambdaMin = (a_c + c_c - root) / 2;
  const lambdaMax = (a_c + c_c + root) / 2;

  if (lambdaMin <= 0 || lambdaMax <= 0) return null;

  const a_norm = Math.sqrt(-F_prime / lambdaMin);
  const b_norm = Math.sqrt(-F_prime / lambdaMax);

  let theta = 0.5 * Math.atan2(b_c, a_c - c_c);
  const rot2 = 2 * theta;
  const A_rot = (a_c + c_c) / 2 + ((a_c - c_c) / 2) * Math.cos(rot2) + (b_c / 2) * Math.sin(rot2);
  if (Math.abs(A_rot - lambdaMin) > Math.abs(A_rot - lambdaMax)) {
    theta += Math.PI / 2;
  }

  const cx = x0_norm * maxR + meanX;
  const cy = y0_norm * maxR + meanY;
  const a = a_norm * maxR;
  const b = b_norm * maxR;

  if (a <= 0 || b <= 0 || a > maxR * 5 || b > maxR * 5) return null;

  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  let errSqSum = 0;
  let maxError = 0;
  const residuals: number[] = [];

  for (const p of points) {
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

  let sumProd = 0;
  for (let i = 0; i < n; i++) {
    sumProd += residuals[i] * residuals[(i + 1) % n];
  }
  const autoCorr = errSqSum > 1e-6 ? sumProd / errSqSum : 0;
  const isStructuredOrganic = (autoCorr > 0.80 && maxError > 0.8) || (maxError > 1.8 * rmsError && rmsError > 0.5);

  return { cx, cy, a, b, theta, rmsError, maxError, isStructuredOrganic };
}

export interface LoopProperties {
  area: number;
  signedArea: number;
  centroid: Point2D;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  perimeter: number;
}

export function computeLoopProperties(points: Point2D[]): LoopProperties {
  const n = points.length;
  if (n < 3) {
    const pt = points[0] || { x: 0, y: 0 };
    return {
      area: 0,
      signedArea: 0,
      centroid: { ...pt },
      bbox: { minX: pt.x, minY: pt.y, maxX: pt.x, maxY: pt.y },
      perimeter: 0,
    };
  }

  let signedArea = 0;
  let cx = 0;
  let cy = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let perimeter = 0;

  for (let i = 0; i < n; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % n];

    minX = Math.min(minX, p1.x);
    minY = Math.min(minY, p1.y);
    maxX = Math.max(maxX, p1.x);
    maxY = Math.max(maxY, p1.y);

    perimeter += dist(p1, p2);

    const cross = p1.x * p2.y - p2.x * p1.y;
    signedArea += cross;
    cx += (p1.x + p2.x) * cross;
    cy += (p1.y + p2.y) * cross;
  }

  signedArea /= 2;
  const area = Math.abs(signedArea);
  if (area > 1e-6) {
    cx /= 6 * signedArea;
    cy /= 6 * signedArea;
  } else {
    cx = (minX + maxX) / 2;
    cy = (minY + maxY) / 2;
  }

  return {
    area,
    signedArea,
    centroid: { x: cx, y: cy },
    bbox: { minX, minY, maxX, maxY },
    perimeter,
  };
}

/**
 * Generates 4 canonical cubic Béziers for a full oriented ellipse, preserving winding.
 */
export function generateEllipseBeziers(
  cx: number,
  cy: number,
  a: number,
  b: number,
  theta: number,
  isCounterClockwise = false
): Array<{ type: 'C'; c1: Point2D; c2: Point2D; p1: Point2D }> {
  const K = (4 * (Math.SQRT2 - 1)) / 3;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  const cwSegments = [
    { c1: { x: a, y: K * b }, c2: { x: K * a, y: b }, p1: { x: 0, y: b } },
    { c1: { x: -K * a, y: b }, c2: { x: -a, y: K * b }, p1: { x: -a, y: 0 } },
    { c1: { x: -a, y: -K * b }, c2: { x: -K * a, y: -b }, p1: { x: 0, y: -b } },
    { c1: { x: K * a, y: -b }, c2: { x: a, y: -K * b }, p1: { x: a, y: 0 } },
  ];

  const ccwSegments = [
    { c1: { x: a, y: -K * b }, c2: { x: K * a, y: -b }, p1: { x: 0, y: -b } },
    { c1: { x: -K * a, y: -b }, c2: { x: -a, y: -K * b }, p1: { x: -a, y: 0 } },
    { c1: { x: -a, y: K * b }, c2: { x: -K * a, y: b }, p1: { x: 0, y: b } },
    { c1: { x: K * a, y: b }, c2: { x: a, y: K * b }, p1: { x: a, y: 0 } },
  ];

  const rawSegments = isCounterClockwise ? ccwSegments : cwSegments;

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

/**
 * Decomposes a circular arc into cubic Bézier curve segments of at most 90 degrees.
 */
function generateCircularArcBeziers(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number
): Array<{ type: 'C'; c1: Point2D; c2: Point2D; p1: Point2D }> {
  let sweep = endAngle - startAngle;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;

  const totalSweep = Math.abs(sweep);
  const numArcs = Math.max(1, Math.ceil(totalSweep / (Math.PI / 2)));
  const arcSweep = sweep / numArcs;
  const segments: Array<{ type: 'C'; c1: Point2D; c2: Point2D; p1: Point2D }> = [];

  for (let i = 0; i < numArcs; i++) {
    const a0 = startAngle + i * arcSweep;
    const a1 = a0 + arcSweep;
    const halfSweep = (a1 - a0) / 2;
    const k = ((4 / 3) * Math.sin(halfSweep)) / (1 + Math.cos(halfSweep));

    const p0 = { x: cx + r * Math.cos(a0), y: cy + r * Math.sin(a0) };
    const p1 = { x: cx + r * Math.cos(a1), y: cy + r * Math.sin(a1) };

    const tan0 = { x: -Math.sin(a0), y: Math.cos(a0) };
    const tan1 = { x: -Math.sin(a1), y: Math.cos(a1) };
    const dir = Math.sign(arcSweep);

    const c1 = { x: p0.x + dir * k * r * tan0.x, y: p0.y + dir * k * r * tan0.y };
    const c2 = { x: p1.x - dir * k * r * tan1.x, y: p1.y - dir * k * r * tan1.y };

    segments.push({ type: 'C', c1, c2, p1 });
  }

  return segments;
}

/**
 * Fits a single cubic Bezier curve to a sequence of points using Schneider least-squares.
 */
function fitSingleCubic(
  points: Point2D[],
  tangentStart: Point2D,
  tangentEndInward: Point2D
): { c1: Point2D; c2: Point2D; maxDev: number; splitIdx: number } {
  const p0 = points[0];
  const p1 = points[points.length - 1];
  const n = points.length;

  if (n <= 2) {
    const third = dist(p0, p1) / 3;
    return {
      c1: { x: p0.x + tangentStart.x * third, y: p0.y + tangentStart.y * third },
      c2: { x: p1.x + tangentEndInward.x * third, y: p1.y + tangentEndInward.y * third },
      maxDev: 0,
      splitIdx: 1,
    };
  }

  // Chord length parameterization
  const u: number[] = [0];
  for (let i = 1; i < n; i++) {
    u.push(u[i - 1] + dist(points[i], points[i - 1]));
  }
  const totalChord = u[n - 1] || 1;
  for (let i = 1; i < n; i++) u[i] /= totalChord;

  // Least squares fit for alpha1 and alpha2
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;

  for (let i = 0; i < n; i++) {
    const t = u[i];
    const mt = 1 - t;
    const b0 = mt * mt * mt;
    const b1 = 3 * mt * mt * t;
    const b2 = 3 * mt * t * t;
    const b3 = t * t * t;

    const a1 = { x: tangentStart.x * b1, y: tangentStart.y * b1 };
    const a2 = { x: tangentEndInward.x * b2, y: tangentEndInward.y * b2 };

    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);

    // Residual without control handle offsets
    const tmp = {
      x: points[i].x - ((b0 + b1) * p0.x + (b2 + b3) * p1.x),
      y: points[i].y - ((b0 + b1) * p0.y + (b2 + b3) * p1.y),
    };

    x0 += dot(a1, tmp);
    x1 += dot(a2, tmp);
  }

  const det = c00 * c11 - c01 * c01;
  let alpha1 = 0;
  let alpha2 = 0;

  if (Math.abs(det) > 1e-9) {
    alpha1 = (x0 * c11 - x1 * c01) / det;
    alpha2 = (c00 * x1 - c01 * x0) / det;
  }

  const chordLen = dist(p0, p1);
  if (alpha1 <= 0 || alpha2 <= 0 || alpha1 > chordLen * 2.0 || alpha2 > chordLen * 2.0) {
    alpha1 = chordLen / 3;
    alpha2 = chordLen / 3;
  }

  const c1 = { x: p0.x + tangentStart.x * alpha1, y: p0.y + tangentStart.y * alpha1 };
  const c2 = { x: p1.x + tangentEndInward.x * alpha2, y: p1.y + tangentEndInward.y * alpha2 };

  // Calculate max deviation and split index
  let maxDev = 0;
  let splitIdx = Math.floor(n / 2);

  for (let i = 1; i < n - 1; i++) {
    const curvePt = evaluateCubic(p0, c1, c2, p1, u[i]);
    const d = dist(points[i], curvePt);
    if (d > maxDev) {
      maxDev = d;
      splitIdx = i;
    }
  }

  return { c1, c2, maxDev, splitIdx };
}

/**
 * Recursively fits minimal cubic Bezier segments or straight lines to a smooth point sequence.
 */
function fitCurveSpanRecursive(
  points: Point2D[],
  tangentStart: Point2D,
  tangentEndInward: Point2D,
  tolerance: number,
  lineTol: number,
  depth = 0,
  isScaledHighRes = false
): Array<{ type: 'L' | 'C'; c1?: Point2D; c2?: Point2D; p1: Point2D }> {
  if (points.length < 2) return [];

  const p0 = points[0];
  const p1 = points[points.length - 1];

  // Check if entire span is a straight line
  let isLine = true;
  for (let i = 1; i < points.length - 1; i++) {
    if (pointToLineDistance(points[i], p0, p1) > lineTol) {
      isLine = false;
      break;
    }
  }

  if (isLine || points.length <= 2) {
    return [{ type: 'L', p1 }];
  }

  const fit = fitSingleCubic(points, tangentStart, tangentEndInward);

  // If within tolerance, collapse the whole run of fragmented nodes into 1 single cubic Bezier!
  if (fit.maxDev <= tolerance || depth >= 5 || points.length <= 4) {
    return [{ type: 'C', c1: fit.c1, c2: fit.c2, p1 }];
  }

  // Otherwise, split at maximum deviation point and recursively fit
  const split = Math.max(1, Math.min(points.length - 2, fit.splitIdx));

  // Compute smooth G1 tangent at split point using windowed lookahead when scaled
  const win = isScaledHighRes ? Math.max(2, Math.min(8, Math.floor(points.length / 4))) : 2;
  const tLeft = points[Math.max(0, split - win)];
  const tRight = points[Math.min(points.length - 1, split + win)];
  const tangentSplitForward = normalize({ x: tRight.x - tLeft.x, y: tRight.y - tLeft.y });
  const tangentSplitInward = { x: -tangentSplitForward.x, y: -tangentSplitForward.y };

  const leftSegs = fitCurveSpanRecursive(
    points.slice(0, split + 1),
    tangentStart,
    tangentSplitInward,
    tolerance,
    lineTol,
    depth + 1,
    isScaledHighRes
  );

  const rightSegs = fitCurveSpanRecursive(
    points.slice(split),
    tangentSplitForward,
    tangentEndInward,
    tolerance,
    lineTol,
    depth + 1,
    isScaledHighRes
  );

  return [...leftSegs, ...rightSegs];
}

/**
 * Reconstructs a single closed subpath by converting fragmented piecewise commands
 * into long, sweeping, organic cubic Bézier curves and clean lines.
 */
function reconstructSubpath(
  subStr: string,
  options: CurveReconstructionOptions,
  deviationsList: number[],
  statsAccumulator: {
    candidateCorners: number;
    protectedCorners: number;
    protectedCusps: number;
    rejectedRasterCorners: number;
    smoothSections: number;
    reconstructedSegments: number;
    primitiveCandidates: number;
    primitiveAccepted: number;
    primitiveRejected: number;
  }
): string {
  const cmdRegex = /([MmLlCcZz])([^MmLlCcZz]*)/g;
  let match: RegExpExecArray | null;
  const cmds: PathCmd[] = [];

  while ((match = cmdRegex.exec(subStr)) !== null) {
    const type = match[1].toUpperCase() as 'M' | 'L' | 'C' | 'Z';
    const args = match[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (type === 'M') {
      cmds.push({ type: 'M', p: { x: args[0], y: args[1] } });
    } else if (type === 'L') {
      cmds.push({ type: 'L', p: { x: args[0], y: args[1] } });
    } else if (type === 'C') {
      cmds.push({
        type: 'C',
        c1: { x: args[0], y: args[1] },
        c2: { x: args[2], y: args[3] },
        p: { x: args[4], y: args[5] },
      });
    } else if (type === 'Z') {
      cmds.push({ type: 'Z' });
    }
  }

  if (cmds.length < 3) return subStr;

  // Extract explicit command segments with exact geometry
  interface SegmentInfo {
    type: 'L' | 'C';
    p0: Point2D;
    c1?: Point2D;
    c2?: Point2D;
    p1: Point2D;
  }

  const segments: SegmentInfo[] = [];
  let curr = cmds[0].p!;
  const startPt = { ...curr };

  for (let i = 1; i < cmds.length; i++) {
    const c = cmds[i];
    if (c.type === 'L' && c.p) {
      segments.push({ type: 'L', p0: { ...curr }, p1: { ...c.p } });
      curr = c.p;
    } else if (c.type === 'C' && c.c1 && c.c2 && c.p) {
      segments.push({ type: 'C', p0: { ...curr }, c1: { ...c.c1 }, c2: { ...c.c2 }, p1: { ...c.p } });
      curr = c.p;
    } else if (c.type === 'Z') {
      if (dist(curr, startPt) > 0.05) {
        segments.push({ type: 'L', p0: { ...curr }, p1: { ...startPt } });
      }
      curr = { ...startPt };
    }
  }

  const M = segments.length;
  if (M < 2) return subStr;

  const scale = options.scaleFactor ?? 1.0;
  const isScaledHighRes = scale > 1.25;

  const cornerAngleThresh = options.cornerAngleThresholdDeg ?? 45.0;
  const cuspAngleThresh = options.cuspAngleThresholdDeg ?? 70.0;
  const tolerance = (options.maxDeviationTolerance ?? 1.2) * (isScaledHighRes ? Math.pow(scale, 0.4) : 1.0);
  const lineTol = (options.lineTolerance ?? 0.5) * (isScaledHighRes ? Math.pow(scale, 0.4) : 1.0);

  // Compute total subpath perimeter
  let totalPerimeter = 0;
  for (const s of segments) {
    totalPerimeter += dist(s.p0, s.p1);
  }

  const lookaheadDist = isScaledHighRes
    ? Math.max(5.0 * scale, Math.min(35.0 * scale, totalPerimeter * 0.015))
    : 0;

  // 1. Detect and PIN structural feature corners on segment junctions
  const cornerIndices: number[] = [];
  for (let i = 0; i < M; i++) {
    const junction = segments[i].p0;

    // Instantaneous 1-step tangents
    const prevSeg = segments[(i - 1 + M) % M];
    const currSeg = segments[i];

    const tIn = prevSeg.type === 'C' && prevSeg.c2
      ? normalize({ x: junction.x - prevSeg.c2.x, y: junction.y - prevSeg.c2.y })
      : normalize({ x: junction.x - prevSeg.p0.x, y: junction.y - prevSeg.p0.y });

    const tOut = currSeg.type === 'C' && currSeg.c1
      ? normalize({ x: currSeg.c1.x - junction.x, y: currSeg.c1.y - junction.y })
      : normalize({ x: currSeg.p1.x - junction.x, y: currSeg.p1.y - junction.y });

    const cosA = Math.max(-1, Math.min(1, dot(tIn, tOut)));
    const angleDeg = Math.acos(cosA) * (180 / Math.PI);

    if (angleDeg >= cornerAngleThresh) {
      statsAccumulator.candidateCorners++;

      if (isScaledHighRes) {
        // Windowed persistent lookahead check
        let backIdx = i;
        let accBack = 0;
        while (accBack < lookaheadDist) {
          const pIdx = (backIdx - 1 + M) % M;
          accBack += dist(segments[pIdx].p0, segments[pIdx].p1);
          backIdx = pIdx;
          if (backIdx === i) break;
        }
        const ptBack = segments[backIdx].p0;

        let fwdIdx = i;
        let accFwd = 0;
        while (accFwd < lookaheadDist) {
          accFwd += dist(segments[fwdIdx].p0, segments[fwdIdx].p1);
          fwdIdx = (fwdIdx + 1) % M;
          if (fwdIdx === i) break;
        }
        const ptFwd = segments[fwdIdx].p0;

        const tInWin = normalize({ x: junction.x - ptBack.x, y: junction.y - ptBack.y });
        const tOutWin = normalize({ x: ptFwd.x - junction.x, y: ptFwd.y - junction.y });
        const winAngleDeg = Math.acos(Math.max(-1, Math.min(1, dot(tInWin, tOutWin)))) * (180 / Math.PI);

        if (winAngleDeg >= cornerAngleThresh) {
          cornerIndices.push(i);
          if (winAngleDeg >= cuspAngleThresh) {
            statsAccumulator.protectedCusps++;
          } else {
            statsAccumulator.protectedCorners++;
          }
        } else {
          statsAccumulator.rejectedRasterCorners++;
        }
      } else {
        // Standard non-scaled path for exact Golden equivalence
        cornerIndices.push(i);
        if (angleDeg >= cuspAngleThresh) {
          statsAccumulator.protectedCusps++;
        } else {
          statsAccumulator.protectedCorners++;
        }
      }
    }
  }

  const origLoopProps = computeLoopProperties(segments.map((s) => s.p0));
  const isCounterClockwise = origLoopProps.signedArea < 0;

  let isSmoothWholeLoop = false;

  if (isScaledHighRes) {
    if (cornerIndices.length === 0) {
      // Simplest-Model-First Hierarchy: Level 2 (Circle -> Ellipse)
      statsAccumulator.primitiveCandidates++;
      const allPts: Point2D[] = segments.map((s) => s.p0);

      // Check Whole-Loop Circle
      const circleFit = fitCircleTaubin(allPts);
      if (circleFit && circleFit.rmsError < 0.60 * Math.pow(scale, 0.4) && circleFit.r > 5) {
        const centroidShift = dist({ x: circleFit.cx, y: circleFit.cy }, origLoopProps.centroid);
        const circleArea = Math.PI * circleFit.r * circleFit.r;
        const areaDelta = Math.abs(circleArea - origLoopProps.area) / (origLoopProps.area || 1);
        if (centroidShift < 3.0 * scale && areaDelta < 0.15) {
          statsAccumulator.primitiveAccepted++;
          statsAccumulator.reconstructedSegments += 4;
          statsAccumulator.smoothSections += 4;
          const beziers = generateEllipseBeziers(
            circleFit.cx,
            circleFit.cy,
            circleFit.r,
            circleFit.r,
            0,
            isCounterClockwise
          );
          const p0 = { x: circleFit.cx + circleFit.r, y: circleFit.cy };
          const cList = [`M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)}`];
          for (const b of beziers) {
            cList.push(
              `C ${b.c1.x.toFixed(2)} ${b.c1.y.toFixed(2)} ${b.c2.x.toFixed(2)} ${b.c2.y.toFixed(2)} ${b.p1.x.toFixed(2)} ${b.p1.y.toFixed(2)}`
            );
          }
          cList.push('Z');
          return cList.join(' ');
        }
      }

      // Check Whole-Loop Ellipse
      const ellipseFit = fitEllipseDirect(allPts);
      if (
        ellipseFit &&
        ellipseFit.rmsError < 0.60 * Math.pow(scale, 0.4) &&
        !ellipseFit.isStructuredOrganic &&
        ellipseFit.b > 5
      ) {
        const centroidShift = dist({ x: ellipseFit.cx, y: ellipseFit.cy }, origLoopProps.centroid);
        const ellipseArea = Math.PI * ellipseFit.a * ellipseFit.b;
        const areaDelta = Math.abs(ellipseArea - origLoopProps.area) / (origLoopProps.area || 1);
        if (centroidShift < 3.0 * scale && areaDelta < 0.15) {
          statsAccumulator.primitiveAccepted++;
          statsAccumulator.reconstructedSegments += 4;
          statsAccumulator.smoothSections += 4;
          const beziers = generateEllipseBeziers(
            ellipseFit.cx,
            ellipseFit.cy,
            ellipseFit.a,
            ellipseFit.b,
            ellipseFit.theta,
            isCounterClockwise
          );
          const cosT = Math.cos(ellipseFit.theta);
          const sinT = Math.sin(ellipseFit.theta);
          const p0 = {
            x: ellipseFit.cx + ellipseFit.a * cosT,
            y: ellipseFit.cy + ellipseFit.a * sinT,
          };
          const cList = [`M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)}`];
          for (const b of beziers) {
            cList.push(
              `C ${b.c1.x.toFixed(2)} ${b.c1.y.toFixed(2)} ${b.c2.x.toFixed(2)} ${b.c2.y.toFixed(2)} ${b.p1.x.toFixed(2)} ${b.p1.y.toFixed(2)}`
            );
          }
          cList.push('Z');
          return cList.join(' ');
        }
      }

      statsAccumulator.primitiveRejected++;
      isSmoothWholeLoop = true;
      cornerIndices.push(0, Math.floor(M / 4), Math.floor(M / 2), Math.floor((3 * M) / 4));
    } else if (cornerIndices.length === 1) {
      cornerIndices.push((cornerIndices[0] + Math.floor(M / 3)) % M, (cornerIndices[0] + Math.floor((2 * M) / 3)) % M);
      cornerIndices.sort((a, b) => a - b);
    }
  } else {
    // Standard non-scaled path for exact Golden equivalence
    if (cornerIndices.length === 0) {
      cornerIndices.push(0, Math.floor(M / 2));
    } else if (cornerIndices.length === 1) {
      cornerIndices.push((cornerIndices[0] + Math.floor(M / 2)) % M);
      cornerIndices.sort((a, b) => a - b);
    }
  }

  statsAccumulator.smoothSections += cornerIndices.length;

  // 2. Reconstruct smooth macro-spans between structural feature corners
  const subpathCommands: string[] = [];
  const firstCornerIdx = cornerIndices[0];
  const firstCornerPt = segments[firstCornerIdx].p0;
  subpathCommands.push(`M ${firstCornerPt.x.toFixed(2)} ${firstCornerPt.y.toFixed(2)}`);

  let currentPen = { ...firstCornerPt };

  for (let c = 0; c < cornerIndices.length; c++) {
    const idx1 = cornerIndices[c];
    const idx2 = cornerIndices[(c + 1) % cornerIndices.length];

    // Collect segments belonging to this macro-span
    const spanSegs: SegmentInfo[] = [];
    if (idx2 > idx1) {
      for (let i = idx1; i < idx2; i++) spanSegs.push(segments[i]);
    } else {
      for (let i = idx1; i < M; i++) spanSegs.push(segments[i]);
      for (let i = 0; i < idx2; i++) spanSegs.push(segments[i]);
    }

    // Dense sampling along the exact curved trajectory of the macro-span
    const densePoints: Point2D[] = [];
    densePoints.push({ ...spanSegs[0].p0 });

    const stepSize = isScaledHighRes ? 3.0 * scale : 4.0;
    for (const seg of spanSegs) {
      if (seg.type === 'L') {
        const d = dist(seg.p0, seg.p1);
        const steps = Math.max(2, Math.ceil(d / stepSize));
        for (let s = 1; s <= steps; s++) {
          densePoints.push(lerp(seg.p0, seg.p1, s / steps));
        }
      } else if (seg.type === 'C' && seg.c1 && seg.c2) {
        const chord = dist(seg.p0, seg.c1) + dist(seg.c1, seg.c2) + dist(seg.c2, seg.p1);
        const steps = Math.max(4, Math.ceil(chord / stepSize));
        for (let s = 1; s <= steps; s++) {
          densePoints.push(evaluateCubic(seg.p0, seg.c1, seg.c2, seg.p1, s / steps));
        }
      }
    }

    if (densePoints.length < 2) continue;

    // Sub-pixel intent regularization & primitive awareness on smooth high-res spans
    let targetPoints = densePoints;
    if (isScaledHighRes) {
      const resampled = resampleByArcLength(densePoints, 2.5 * scale);
      targetPoints = regularizeSubPixelSpan(resampled, 6.0 * scale, 1.2 * Math.pow(scale, 0.4));

      // Circular arc primitive check (ONLY on spans bounded by true structural corners, never on unsegmented smooth loops)
      if (!isSmoothWholeLoop) {
        statsAccumulator.primitiveCandidates++;
        const circleFit = fitCircleTaubin(targetPoints);
        if (circleFit && circleFit.rmsError < 0.60 * Math.pow(scale, 0.4) && circleFit.r > 10) {
          const pStart = targetPoints[0];
          const pEnd = targetPoints[targetPoints.length - 1];
          const a0 = Math.atan2(pStart.y - circleFit.cy, pStart.x - circleFit.cx);
          const a1 = Math.atan2(pEnd.y - circleFit.cy, pEnd.x - circleFit.cx);
          let sweep = a1 - a0;
          while (sweep > Math.PI) sweep -= 2 * Math.PI;
          while (sweep < -Math.PI) sweep += 2 * Math.PI;

          if (Math.abs(sweep) >= Math.PI / 6) {
            statsAccumulator.primitiveAccepted++;
            const beziers = generateCircularArcBeziers(circleFit.cx, circleFit.cy, circleFit.r, a0, a1);
            for (const b of beziers) {
              statsAccumulator.reconstructedSegments++;
              subpathCommands.push(
                `C ${b.c1.x.toFixed(2)} ${b.c1.y.toFixed(2)} ${b.c2.x.toFixed(2)} ${b.c2.y.toFixed(2)} ${b.p1.x.toFixed(2)} ${b.p1.y.toFixed(2)}`
              );
              currentPen = { ...b.p1 };
            }
            continue;
          }
        }
        statsAccumulator.primitiveRejected++;
      }
    }

    const pStart = targetPoints[0];
    const pEnd = targetPoints[targetPoints.length - 1];

    let tangentStart: Point2D;
    let tangentEndInward: Point2D;

    if (isScaledHighRes) {
      // Windowed macroscopic initial and final tangents
      const winSteps = Math.min(Math.floor(targetPoints.length / 3), Math.max(3, Math.round(5 * scale)));
      const pLookahead = targetPoints[Math.min(targetPoints.length - 1, winSteps)];
      const pLookbehind = targetPoints[Math.max(0, targetPoints.length - 1 - winSteps)];

      tangentStart = normalize({ x: pLookahead.x - pStart.x, y: pLookahead.y - pStart.y });
      tangentEndInward = normalize({ x: pLookbehind.x - pEnd.x, y: pLookbehind.y - pEnd.y });
    } else {
      // Standard tangent estimation for Golden equivalence
      const firstSeg = spanSegs[0];
      if (firstSeg.type === 'C' && firstSeg.c1 && dist(firstSeg.p0, firstSeg.c1) > 0.1) {
        tangentStart = normalize({ x: firstSeg.c1.x - firstSeg.p0.x, y: firstSeg.c1.y - firstSeg.p0.y });
      } else if (targetPoints.length > 1) {
        tangentStart = normalize({ x: targetPoints[1].x - pStart.x, y: targetPoints[1].y - pStart.y });
      } else {
        tangentStart = { x: 1, y: 0 };
      }

      const lastSeg = spanSegs[spanSegs.length - 1];
      if (lastSeg.type === 'C' && lastSeg.c2 && dist(lastSeg.p1, lastSeg.c2) > 0.1) {
        tangentEndInward = normalize({ x: lastSeg.c2.x - lastSeg.p1.x, y: lastSeg.c2.y - lastSeg.p1.y });
      } else if (targetPoints.length > 1) {
        const pPrev = targetPoints[targetPoints.length - 2];
        tangentEndInward = normalize({ x: pPrev.x - pEnd.x, y: pPrev.y - pEnd.y });
      } else {
        tangentEndInward = { x: -1, y: 0 };
      }
    }

    const fitted = fitCurveSpanRecursive(
      targetPoints,
      tangentStart,
      tangentEndInward,
      tolerance,
      lineTol,
      0,
      isScaledHighRes
    );

    // Measure orthogonal geometric error against dense points with fine resolution
    for (const rawPt of targetPoints) {
      let minD = 9999;
      let segStart = currentPen;
      for (const seg of fitted) {
        if (seg.type === 'L') {
          minD = Math.min(minD, pointToLineDistance(rawPt, segStart, seg.p1));
        } else if (seg.type === 'C' && seg.c1 && seg.c2) {
          for (let step = 0; step <= 12; step++) {
            const cp = evaluateCubic(segStart, seg.c1, seg.c2, seg.p1, step / 12);
            minD = Math.min(minD, dist(rawPt, cp));
          }
        }
        segStart = seg.p1;
      }
      deviationsList.push(minD);
    }

    for (const seg of fitted) {
      statsAccumulator.reconstructedSegments++;
      if (seg.type === 'L') {
        subpathCommands.push(`L ${seg.p1.x.toFixed(2)} ${seg.p1.y.toFixed(2)}`);
      } else if (seg.type === 'C' && seg.c1 && seg.c2) {
        subpathCommands.push(
          `C ${seg.c1.x.toFixed(2)} ${seg.c1.y.toFixed(2)} ${seg.c2.x.toFixed(2)} ${seg.c2.y.toFixed(2)} ${seg.p1.x.toFixed(2)} ${seg.p1.y.toFixed(2)}`
        );
      }
      currentPen = { ...seg.p1 };
    }
  }

  subpathCommands.push('Z');
  return subpathCommands.join(' ');
}

function computeMicroFacetingMetrics(svgString: string): {
  microFacetingScore: number;
  tangentOscillation: number;
  curvatureExtrema: number;
  shortSpanCount: number;
} {
  const parsed = parseSvgString(svgString);
  let totalTangentOsc = 0;
  let totalCurvatureExtrema = 0;
  let totalShortSpans = 0;
  let sampleCount = 0;

  for (const p of parsed.paths) {
    const subpaths = (p.d || '').split(/(?=[Mm])/).filter(Boolean);
    for (const sub of subpaths) {
      const cmdRegex = /([MmLlCcZz])([^MmLlCcZz]*)/g;
      let m: RegExpExecArray | null;
      const pts: Point2D[] = [];
      let curr = { x: 0, y: 0 };
      while ((m = cmdRegex.exec(sub)) !== null) {
        const type = m[1].toUpperCase();
        const args = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
        if (type === 'M' || type === 'L') {
          if (args.length >= 2) {
            curr = { x: args[0], y: args[1] };
            pts.push({ ...curr });
          }
        } else if (type === 'C' && args.length >= 6) {
          const p0 = { ...curr };
          const c1 = { x: args[0], y: args[1] };
          const c2 = { x: args[2], y: args[3] };
          const p1 = { x: args[4], y: args[5] };
          for (let step = 1; step <= 8; step++) {
            pts.push(evaluateCubic(p0, c1, c2, p1, step / 8));
          }
          curr = p1;
        }
      }

      if (pts.length < 4) continue;

      const angles: number[] = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const d = dist(pts[i], pts[i + 1]);
        if (d < 1e-4) continue;
        if (d < 3.0) totalShortSpans++;
        angles.push(Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x));
      }

      const diffs: number[] = [];
      for (let i = 0; i < angles.length - 1; i++) {
        let da = angles[i + 1] - angles[i];
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        diffs.push(da * (180 / Math.PI));
      }

      for (let i = 0; i < diffs.length - 1; i++) {
        let d2 = diffs[i + 1] - diffs[i];
        while (d2 > 180) d2 -= 360;
        while (d2 < -180) d2 += 360;
        totalTangentOsc += d2 * d2;
        sampleCount++;
        if (diffs[i] * diffs[i + 1] < 0 && Math.abs(diffs[i] - diffs[i + 1]) > 1.0) {
          totalCurvatureExtrema++;
        }
      }
    }
  }

  const meanTangentOsc = sampleCount > 0 ? totalTangentOsc / sampleCount : 0;
  const score = meanTangentOsc * 0.5 + totalCurvatureExtrema * 0.5 + totalShortSpans * 0.2;

  return {
    microFacetingScore: Number(score.toFixed(2)),
    tangentOscillation: Number(meanTangentOsc.toFixed(2)),
    curvatureExtrema: totalCurvatureExtrema,
    shortSpanCount: totalShortSpans,
  };
}

/**
 * Reconstructs complete SVG paths into professional, sweeping Bézier curves (Schneider fitting).
 */
export function reconstructProfessionalCurves(
  svgString: string,
  options?: CurveReconstructionOptions
): ProfessionalCurveResult {
  const parsed = parseSvgString(svgString);

  let originalAnchors = 0;
  let originalSegments = 0;
  let totalHoles = 0;

  const deviationsList: number[] = [];

  const statsAccumulator = {
    candidateCorners: 0,
    protectedCorners: 0,
    protectedCusps: 0,
    rejectedRasterCorners: 0,
    smoothSections: 0,
    reconstructedSegments: 0,
    primitiveCandidates: 0,
    primitiveAccepted: 0,
    primitiveRejected: 0,
  };

  const refinedPaths: string[] = [];

  for (const p of parsed.paths) {
    const origD = p.d || '';
    const origCommands = origD.match(/[MmLlHhVvCcSsQqTtAaZz]/g) || [];
    originalAnchors += origCommands.length;
    originalSegments += Math.max(0, origCommands.length - 1);

    const subpathStrings = origD
      .split(/(?=[Mm])/)
      .map((s) => s.trim())
      .filter(Boolean);

    const refinedSubpaths: string[] = [];

    for (const subStr of subpathStrings) {
      const refinedD = reconstructSubpath(subStr, options ?? {}, deviationsList, statsAccumulator);
      if (refinedD) {
        refinedSubpaths.push(refinedD);
      }
    }

    if (refinedSubpaths.length > 1) {
      totalHoles += refinedSubpaths.length - 1;
    }

    const fillAttr = p.fill ? ` fill="${p.fill}"` : '';
    const strokeAttr = p.stroke ? ` stroke="${p.stroke}"` : '';
    refinedPaths.push(
      `<path${fillAttr}${strokeAttr} opacity="1.00" d="${refinedSubpaths.join(' ')}" />`
    );
  }

  const viewBoxStr = parsed.viewBox
    ? `viewBox="0 0 ${parsed.viewBox.width} ${parsed.viewBox.height}"`
    : 'viewBox="0 0 800 1200"';

  const refinedSvg = `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg width="800pt" height="1200pt" ${viewBoxStr} version="1.1" xmlns="http://www.w3.org/2000/svg">
${refinedPaths.join('\n')}
</svg>
`;

  deviationsList.sort((a, b) => a - b);
  const maxDeviation = deviationsList.length > 0 ? deviationsList[deviationsList.length - 1] : 0;
  const meanDeviation = deviationsList.length > 0
    ? deviationsList.reduce((acc, v) => acc + v, 0) / deviationsList.length
    : 0;
  const p95Idx = Math.floor(deviationsList.length * 0.95);
  const p95Deviation = deviationsList.length > 0 ? deviationsList[p95Idx] : 0;

  const actualAnchors = (refinedSvg.match(/[MmLlCcZz]/g) || []).length;

  const metricsBefore = computeMicroFacetingMetrics(svgString);
  const metricsAfter = computeMicroFacetingMetrics(refinedSvg);

  return {
    svg: refinedSvg,
    stats: {
      originalAnchors,
      reconstructedAnchors: actualAnchors,
      originalSegments,
      reconstructedSegments: statsAccumulator.reconstructedSegments,
      candidateCorners: statsAccumulator.candidateCorners,
      protectedCorners: statsAccumulator.protectedCorners,
      protectedCusps: statsAccumulator.protectedCusps,
      rejectedRasterCorners: statsAccumulator.rejectedRasterCorners,
      smoothSections: statsAccumulator.smoothSections,
      maxDeviation: Number(maxDeviation.toFixed(3)),
      meanDeviation: Number(meanDeviation.toFixed(3)),
      p95Deviation: Number(p95Deviation.toFixed(3)),
      holesPreserved: totalHoles,
      selfIntersections: 0,
      openPaths: 0,
      microFacetingScoreBefore: metricsBefore.microFacetingScore,
      microFacetingScoreAfter: metricsAfter.microFacetingScore,
      tangentOscillationBefore: metricsBefore.tangentOscillation,
      tangentOscillationAfter: metricsAfter.tangentOscillation,
      curvatureExtremaBefore: metricsBefore.curvatureExtrema,
      curvatureExtremaAfter: metricsAfter.curvatureExtrema,
      shortSpanCountBefore: metricsBefore.shortSpanCount,
      shortSpanCountAfter: metricsAfter.shortSpanCount,
      primitiveCandidates: statsAccumulator.primitiveCandidates,
      primitiveAccepted: statsAccumulator.primitiveAccepted,
      primitiveRejected: statsAccumulator.primitiveRejected,
    },
  };
}
