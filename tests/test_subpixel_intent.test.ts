import { describe, expect, it } from 'vitest';
import type { Point2D } from '../src/core/vector-engine/curveRefinement';

function dist(p1: Point2D, p2: Point2D): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function lerp(p1: Point2D, p2: Point2D, t: number): Point2D {
  return { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
}

function normalize(v: Point2D): Point2D {
  const len = Math.hypot(v.x, v.y);
  return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}

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
 * Projects interior points of a smooth span onto local quadratic polynomial in Frenet frame.
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

    // Solve 3x3 linear system for v(u) = a u^2 + b u + c (we want c = v(0))
    // Matrix [ [su4, su3, su2], [su3, su2, su], [su2, su, wSum] ] * [a, b, c]^T = [su2v, suv, sv]^T
    // Cramer's rule for c:
    const m00 = su4, m01 = su3, m02 = su2;
    const m10 = su3, m11 = su2, m12 = su;
    const m20 = su2, m21 = su,  m22 = wSum;

    const detM =
      m00 * (m11 * m22 - m12 * m21) -
      m01 * (m10 * m22 - m12 * m20) +
      m02 * (m10 * m21 - m11 * m20);

    let c = 0;
    if (Math.abs(detM) > 1e-9) {
      // Det replacing 3rd column with RHS [su2v, suv, sv]
      const detC =
        m00 * (m11 * sv - suv * m21) -
        m01 * (m10 * sv - suv * m20) +
        su2v * (m10 * m21 - m11 * m20);
      c = detC / detM;
    } else {
      c = sv / wSum; // Fallback to weighted mean normal offset
    }

    // Clamp sub-pixel shift to maintain exact geometric tolerance
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

  // Newton solver for characteristic polynomial
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

describe('PRYX ETAPA 8.11C — Sub-Pixel Intent Prototype', () => {
  it('eliminates discrete raster staircases on a circular arc without distorting the circle', () => {
    // Generate a 1000x1000 raster circle staircase
    const cx = 500, cy = 500, r = 300;
    const stairPoints: Point2D[] = [];
    for (let deg = 0; deg <= 90; deg += 0.5) {
      const rad = (deg * Math.PI) / 180;
      // Quantize to integer pixel grid (staircase)
      const px = Math.round(cx + r * Math.cos(rad));
      const py = Math.round(cy + r * Math.sin(rad));
      if (stairPoints.length === 0 || stairPoints[stairPoints.length - 1].x !== px || stairPoints[stairPoints.length - 1].y !== py) {
        stairPoints.push({ x: px, y: py });
      }
    }

    expect(stairPoints.length).toBeGreaterThan(100);

    // 1. Resample by arc length
    const resampled = resampleByArcLength(stairPoints, 3.0);

    // 2. Regularize with MLS
    const regularized = regularizeSubPixelSpan(resampled, 15.0, 1.5);

    // 3. Measure circle fit RMS error on stair vs regularized
    const stairFit = fitCircleTaubin(stairPoints)!;
    const regFit = fitCircleTaubin(regularized)!;

    console.log(`Staircase Points: ${stairPoints.length} | RMS Error: ${stairFit.rmsError.toFixed(4)} px`);
    console.log(`Regularized Points: ${regularized.length} | RMS Error: ${regFit.rmsError.toFixed(4)} px`);

    expect(regFit.rmsError).toBeLessThan(0.15); // Sub-pixel precision!
    expect(Math.abs(regFit.r - r)).toBeLessThan(0.2);
  });
});
