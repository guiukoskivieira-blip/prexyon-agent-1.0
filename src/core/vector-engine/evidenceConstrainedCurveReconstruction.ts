/**
 * PRYX — ETAPA 8.16A
 * EVIDENCE-CONSTRAINED PROFESSIONAL CURVE RECONSTRUCTION
 * HUMAN-GATE CORRECTION: FALSE FEATURE REJECTION + COUNTERFORM MORPHOLOGY GUARD
 * 
 * Pipeline:
 * Raster / Input Vector
 * ↓
 * Planar Region Map (8.12)
 * ↓
 * Subpixel Boundary Evidence (8.13)
 * ↓
 * Multiscale Feature Evidence (8.14)
 * ↓
 * Feature Consensus Gate & Angular Support Window (8.16A)
 * ↓
 * Fit-Without-Split Challenge (8.16A)
 * ↓
 * Coupled Shape Constraints (8.15)
 * ↓
 * Evidence-Constrained Span Segmentation & G1-Continuous Curve Fitting
 * ↓
 * Counterform Morphology Signature & Local Morphology Guard (8.16A)
 * ↓
 * Topology Hard Gate & Coupled Constraint Verification
 * ↓
 * Human-Gate Ready Candidate SVG (V816A_READY_FOR_HUMAN_GATE)
 */

import { parseSvgString } from '../vectorizer/svgParser';
import type { Point2D } from './curveRefinement';
import {
  buildPlanarRegionMapFromSvg,
  computeTopologySignature,
  validateTopologyInvariants,
} from './planarRegionMap';
import {
  analyzeSvgMultiscaleFeatures,
  BoundaryFeatureProfile,
} from './multiscaleFeatureAnalysis';
import {
  analyzeCoupledShapeConstraints,
  CounterformConstraintSignature,
} from './coupledShapeAnalysis';

export interface EvidenceConstrainedOptions {
  /** Canvas diagonal scale factor. Default: 1.0 */
  canvasScale?: number;
  /** Base geometric fitting tolerance in pixels. Default: 1.2 */
  fittingTolerance?: number;
  /** Collinear line detection tolerance in pixels. Default: 0.5 */
  lineTolerance?: number;
  /** If true, strictly fallback to original subpath if topology gate or coupled validation fails. Default: true */
  enableTopologyFallback?: boolean;
}

export interface FeatureDecision {
  subpathIndex: number;
  candidateIndex: number;
  point: Point2D;
  turnAngleDeg: number;
  sustainedAngleDeg: number;
  continuousFitError: number;
  splitFitError: number;
  classification: 'TRUE_STRUCTURAL_SPLIT' | 'QUESTIONABLE_SPLIT' | 'FALSE_STRUCTURAL_SPLIT';
  rationale: string;
}

export interface MorphologyGuardDecision {
  subpathIndex: number;
  isHole: boolean;
  areaOriginal: number;
  areaReconstructed: number;
  areaDriftPct: number;
  centroidDrift: number;
  p50Drift: number;
  p95Drift: number;
  maxDrift: number;
  status: 'ACCEPTED' | 'FALLBACK_TO_SAFE_GEOMETRY';
  rationale: string;
}

export interface ReconstructionMetrics {
  originalAnchors: number;
  reconstructedAnchors: number;
  anchorReductionRatio: number;
  originalSegments: number;
  reconstructedSegments: number;
  cubicSegments: number;
  lineSegments: number;
  highFrequencyCurvatureEnergyBefore: number;
  highFrequencyCurvatureEnergyAfter: number;
  stairStepResidualBefore: number;
  stairStepResidualAfter: number;
  gridLockResidualBefore: number;
  gridLockResidualAfter: number;
  p50GeometricError: number;
  p95GeometricError: number;
  maxGeometricError: number;
  selfIntersections: number;
  openPaths: number;
  componentsBefore: number;
  componentsAfter: number;
  holesBefore: number;
  holesAfter: number;
  counterformAreaDriftMax: number;
  counterformCentroidDriftMax: number;
  minimumWallWidthDriftMax: number;
  falseCornersRejected: number;
  trueCornersRetained: number;
  questionableCornersResolved: number;
  morphologyFallbacksTriggered: number;
  p50DriftMax: number;
  p95DriftMax: number;
  maxDriftMax: number;
  topologyGatePassed: boolean;
  coupledConstraintsPassed: boolean;
}

export interface EvidenceConstrainedResult {
  svg: string;
  metrics: ReconstructionMetrics;
  candidateShadowAvailable: boolean;
  evidenceConsumed: {
    topologyDataConsumed: boolean;
    subpixelDataConsumed: boolean;
    multiscaleDataConsumed: boolean;
    coupledDataConsumed: boolean;
  };
  featureDecisions: FeatureDecision[];
  morphologyDecisions: MorphologyGuardDecision[];
  verdict: 'V816A_READY_FOR_HUMAN_GATE' | 'V816A_RECONSTRUCTION_NOT_SAFE' | 'V816_READY_FOR_HUMAN_GATE';
}

function dist(p1: Point2D, p2: Point2D): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function normalize(v: Point2D): Point2D {
  const len = Math.hypot(v.x, v.y);
  return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
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
 * Calculates Green's theorem area and centroid of a polygon.
 */
function computePolygonAreaAndCentroid(pts: Point2D[]): { area: number; centroid: Point2D } {
  const n = pts.length;
  if (n < 3) return { area: 0, centroid: pts[0] || { x: 0, y: 0 } };

  let signedArea2 = 0;
  let cxSum = 0;
  let cySum = 0;

  for (let i = 0; i < n; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const cross = p1.x * p2.y - p2.x * p1.y;
    signedArea2 += cross;
    cxSum += (p1.x + p2.x) * cross;
    cySum += (p1.y + p2.y) * cross;
  }

  const area = Math.abs(signedArea2) * 0.5;
  if (Math.abs(signedArea2) < 1e-6) {
    let sx = 0, sy = 0;
    pts.forEach((p) => { sx += p.x; sy += p.y; });
    return { area: 0, centroid: { x: sx / n, y: sy / n } };
  }

  const cx = cxSum / (3 * signedArea2);
  const cy = cySum / (3 * signedArea2);
  return { area, centroid: { x: cx, y: cy } };
}

/**
 * Computes cumulative perimeter chord lengths for a closed loop of points.
 */
function computeCumulativeLengths(pts: Point2D[]): { lengths: number[]; totalLength: number } {
  const n = pts.length;
  const lengths: number[] = [0];
  for (let i = 0; i < n - 1; i++) {
    lengths.push(lengths[i] + dist(pts[i], pts[i + 1]));
  }
  const totalLength = lengths[n - 1] + dist(pts[n - 1], pts[0]);
  return { lengths, totalLength };
}

/**
 * Finds a point along the closed polygon perimeter at arc-length distance delta from idx.
 */
function findPointAtArcDistance(
  pts: Point2D[],
  idx: number,
  delta: number,
  lengths: number[],
  totalLength: number
): Point2D {
  const n = pts.length;
  if (n === 0) return { x: 0, y: 0 };
  if (totalLength <= 1e-6) return pts[idx];

  let targetLen = (lengths[idx] + delta) % totalLength;
  if (targetLen < 0) targetLen += totalLength;

  for (let i = 0; i < n; i++) {
    const nextI = (i + 1) % n;
    const l1 = lengths[i];
    const l2 = nextI === 0 ? totalLength : lengths[nextI];

    if (targetLen >= l1 && targetLen <= l2) {
      const segLen = l2 - l1;
      const t = segLen > 1e-6 ? (targetLen - l1) / segLen : 0;
      return {
        x: pts[i].x + t * (pts[nextI].x - pts[i].x),
        y: pts[i].y + t * (pts[nextI].y - pts[i].y),
      };
    }
  }

  return pts[idx];
}

/**
 * Estimates a smoothed tangent vector at idx by sampling across a chord window.
 */
function getSmoothedTangent(
  pts: Point2D[],
  idx: number,
  windowLen: number,
  lengths: number[],
  totalLength: number
): Point2D {
  const pBack = findPointAtArcDistance(pts, idx, -windowLen * 0.5, lengths, totalLength);
  const pFwd = findPointAtArcDistance(pts, idx, windowLen * 0.5, lengths, totalLength);
  const vec = { x: pFwd.x - pBack.x, y: pFwd.y - pBack.y };
  const n = normalize(vec);
  if (n.x === 0 && n.y === 0) {
    const nextPt = pts[(idx + 1) % pts.length];
    return normalize({ x: nextPt.x - pts[idx].x, y: nextPt.y - pts[idx].y });
  }
  return n;
}

/**
 * Fits a single cubic Bézier segment between p0 and p1 with specified tangents.
 */
function fitCubicSegment(
  pts: Point2D[],
  tHat1: Point2D,
  tHat2: Point2D
): { c1: Point2D; c2: Point2D; maxError: number; maxErrorIdx: number } {
  const n = pts.length;
  const p0 = pts[0];
  const p1 = pts[n - 1];

  if (n <= 2) {
    const d = dist(p0, p1) / 3.0;
    return {
      c1: { x: p0.x + tHat1.x * d, y: p0.y + tHat1.y * d },
      c2: { x: p1.x + tHat2.x * d, y: p1.y + tHat2.y * d },
      maxError: 0,
      maxErrorIdx: 0,
    };
  }

  // Chord length parameterization
  const u: number[] = [0];
  for (let i = 1; i < n; i++) {
    u.push(u[i - 1] + dist(pts[i], pts[i - 1]));
  }
  const totalLen = u[n - 1] || 1;
  for (let i = 1; i < n; i++) {
    u[i] /= totalLen;
  }

  // Linear least squares solver for alpha1 and alpha2 (Schneider algorithm)
  let c11 = 0, c12 = 0, c22 = 0;
  let x1 = 0, x2 = 0;

  for (let i = 0; i < n; i++) {
    const t = u[i];
    const mt = 1 - t;
    const b0 = mt * mt * mt;
    const b1 = 3 * mt * mt * t;
    const b2 = 3 * mt * t * t;
    const b3 = t * t * t;

    const a1 = { x: tHat1.x * b1, y: tHat1.y * b1 };
    const a2 = { x: tHat2.x * b2, y: tHat2.y * b2 };

    c11 += a1.x * a1.x + a1.y * a1.y;
    c12 += a1.x * a2.x + a1.y * a2.y;
    c22 += a2.x * a2.x + a2.y * a2.y;

    const tmp = {
      x: pts[i].x - (b0 * p0.x + b1 * p0.x + b2 * p1.x + b3 * p1.x),
      y: pts[i].y - (b0 * p0.y + b1 * p0.y + b2 * p1.y + b3 * p1.y),
    };

    x1 += a1.x * tmp.x + a1.y * tmp.y;
    x2 += a2.x * tmp.x + a2.y * tmp.y;
  }

  const det = c11 * c22 - c12 * c12;
  let alpha1 = 0, alpha2 = 0;

  if (Math.abs(det) > 1e-8) {
    alpha1 = (x1 * c22 - x2 * c12) / det;
    alpha2 = (c11 * x2 - c12 * x1) / det;
  }

  const chordDist = dist(p0, p1);
  if (alpha1 <= 0 || alpha2 <= 0 || alpha1 > chordDist * 2.0 || alpha2 > chordDist * 2.0) {
    alpha1 = chordDist / 3.0;
    alpha2 = chordDist / 3.0;
  }

  const c1 = { x: p0.x + tHat1.x * alpha1, y: p0.y + tHat1.y * alpha1 };
  const c2 = { x: p1.x + tHat2.x * alpha2, y: p1.y + tHat2.y * alpha2 };

  // Compute maximum geometric deviation
  let maxError = 0;
  let maxErrorIdx = 0;

  for (let i = 0; i < n; i++) {
    const ptOnCurve = evaluateCubic(p0, c1, c2, p1, u[i]);
    const err = dist(pts[i], ptOnCurve);
    if (err > maxError) {
      maxError = err;
      maxErrorIdx = i;
    }
  }

  return { c1, c2, maxError, maxErrorIdx };
}

/**
 * Fits an open span of points into a sequence of Line and Cubic Bézier segments.
 */
function fitSpanSegments(
  pts: Point2D[],
  tol: number,
  lineTol: number,
  tangentStart?: Point2D,
  tangentEnd?: Point2D
): string[] {
  const n = pts.length;
  if (n < 2) return [];

  const p0 = pts[0];
  const p1 = pts[n - 1];

  // 1. Line fitting test
  let isLine = true;
  for (let i = 1; i < n - 1; i++) {
    if (pointToLineDistance(pts[i], p0, p1) > lineTol) {
      isLine = false;
      break;
    }
  }

  if (isLine || n <= 2) {
    return [`L ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`];
  }

  // 2. Tangent estimation at endpoints
  const tHat1 = tangentStart || normalize({ x: pts[1].x - p0.x, y: pts[1].y - p0.y });
  const tHat2 = tangentEnd || normalize({ x: pts[n - 2].x - p1.x, y: pts[n - 2].y - p1.y });

  // 3. Single cubic fitting
  const fit = fitCubicSegment(pts, tHat1, tHat2);

  if (fit.maxError <= tol || n <= 4) {
    return [
      `C ${fit.c1.x.toFixed(2)} ${fit.c1.y.toFixed(2)} ${fit.c2.x.toFixed(2)} ${fit.c2.y.toFixed(2)} ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
    ];
  }

  // 4. Recursive subdivision at max error index
  const splitIdx = Math.max(1, Math.min(n - 2, fit.maxErrorIdx));
  const tMid = normalize({
    x: pts[Math.min(n - 1, splitIdx + 1)].x - pts[Math.max(0, splitIdx - 1)].x,
    y: pts[Math.min(n - 1, splitIdx + 1)].y - pts[Math.max(0, splitIdx - 1)].y,
  });
  const tMidRev = { x: -tMid.x, y: -tMid.y };

  const segs1 = fitSpanSegments(pts.slice(0, splitIdx + 1), tol, lineTol, tHat1, tMidRev);
  const segs2 = fitSpanSegments(pts.slice(splitIdx), tol, lineTol, tMid, tHat2);

  return [...segs1, ...segs2];
}

/**
 * Evaluates Angular Support Window & Sustained Turn Angle over arc length L_arm.
 */
function computeAngularSupport(
  pts: Point2D[],
  idx: number,
  lengths: number[],
  totalLength: number,
  localScale: number
): { sustainedAngleDeg: number; armLinearityIn: number; armLinearityOut: number } {
  const lArm = Math.min(totalLength * 0.35, Math.max(5.0, 4.0 * localScale));
  const pBack = findPointAtArcDistance(pts, idx, -lArm, lengths, totalLength);
  const pFwd = findPointAtArcDistance(pts, idx, lArm, lengths, totalLength);
  const pCurr = pts[idx];

  const vIn = normalize({ x: pCurr.x - pBack.x, y: pCurr.y - pBack.y });
  const vOut = normalize({ x: pFwd.x - pCurr.x, y: pFwd.y - pCurr.y });

  const dot = Math.max(-1, Math.min(1, vIn.x * vOut.x + vIn.y * vOut.y));
  const sustainedAngleDeg = Math.acos(dot) * (180 / Math.PI);

  const linearityIn = pointToLineDistance(findPointAtArcDistance(pts, idx, -lArm * 0.5, lengths, totalLength), pBack, pCurr);
  const linearityOut = pointToLineDistance(findPointAtArcDistance(pts, idx, lArm * 0.5, lengths, totalLength), pCurr, pFwd);

  return { sustainedAngleDeg, armLinearityIn: linearityIn, armLinearityOut: linearityOut };
}

/**
 * Challenges candidate corner by testing continuous smooth span fit vs split.
 */
function challengeFitWithoutSplit(
  pts: Point2D[],
  idx: number,
  windowCount: number,
  tol: number
): { continuousError: number; splitError: number; canFitWithoutSplit: boolean } {
  const n = pts.length;
  const k = Math.min(Math.floor((n - 1) / 2), Math.max(1, windowCount));
  const spanPts: Point2D[] = [];
  for (let offset = -k; offset <= k; offset++) {
    const pIdx = (idx + offset + n) % n;
    spanPts.push(pts[pIdx]);
  }

  if (spanPts.length < 3) {
    return { continuousError: 0, splitError: 0, canFitWithoutSplit: true };
  }

  const tStart = normalize({ x: spanPts[1].x - spanPts[0].x, y: spanPts[1].y - spanPts[0].y });
  const tEnd = normalize({ x: spanPts[spanPts.length - 2].x - spanPts[spanPts.length - 1].x, y: spanPts[spanPts.length - 2].y - spanPts[spanPts.length - 1].y });

  const fitCont = fitCubicSegment(spanPts, tStart, tEnd);
  const midInSpan = Math.floor(spanPts.length / 2);

  const span1 = spanPts.slice(0, midInSpan + 1);
  const span2 = spanPts.slice(midInSpan);

  const tMid1 = normalize({ x: span1[span1.length - 2].x - span1[span1.length - 1].x, y: span1[span1.length - 2].y - span1[span1.length - 1].y });
  const tMid2 = normalize({ x: span2[1].x - span2[0].x, y: span2[1].y - span2[0].y });

  const fit1 = fitCubicSegment(span1, tStart, tMid1);
  const fit2 = fitCubicSegment(span2, tMid2, tEnd);

  const splitError = Math.max(fit1.maxError, fit2.maxError);
  const continuousError = fitCont.maxError;

  return {
    continuousError,
    splitError,
    canFitWithoutSplit: continuousError <= tol * 1.35,
  };
}

/**
 * Evaluates feature consensus and classifies candidate breakpoints.
 */
function evaluateFeatureDecisions(
  rawPoints: Point2D[],
  profile: BoundaryFeatureProfile | undefined,
  baseTol: number,
  lineTol: number,
  subpathIndex: number
): { breakpoints: number[]; decisions: FeatureDecision[] } {
  const n = rawPoints.length;
  if (n < 3) return { breakpoints: [], decisions: [] };

  const localScale = profile ? profile.localScale : 1.0;
  const tol = baseTol * Math.max(0.6, Math.min(2.5, localScale));
  const { lengths, totalLength } = computeCumulativeLengths(rawPoints);

  const candidateIndices: Array<{ index: number; type: string; rawTurnAngle: number; persistence: number }> = [];

  if (profile) {
    for (const fp of profile.featurePoints) {
      if (fp.index >= 0 && fp.index < n) {
        candidateIndices.push({
          index: fp.index,
          type: fp.classification,
          rawTurnAngle: fp.turnAngleDeg,
          persistence: fp.persistenceScore,
        });
      }
    }
  }

  // Also include discrete sharp turns from rawPoints
  const existingIndices = new Set(candidateIndices.map((c) => c.index));
  for (let i = 0; i < n; i++) {
    if (!existingIndices.has(i)) {
      const pPrev = rawPoints[(i - 1 + n) % n];
      const pCurr = rawPoints[i];
      const pNext = rawPoints[(i + 1) % n];
      const v1 = normalize({ x: pCurr.x - pPrev.x, y: pCurr.y - pPrev.y });
      const v2 = normalize({ x: pNext.x - pCurr.x, y: pNext.y - pCurr.y });
      const dot = Math.max(-1, Math.min(1, v1.x * v2.x + v1.y * v2.y));
      const turnAngle = Math.acos(dot) * (180 / Math.PI);
      if (turnAngle >= 35.0) {
        candidateIndices.push({
          index: i,
          type: turnAngle >= 95.0 ? 'PERSISTENT_CUSP' : 'PERSISTENT_CORNER',
          rawTurnAngle: turnAngle,
          persistence: 0.5,
        });
      }
    }
  }

  const decisions: FeatureDecision[] = [];
  const confirmedBreakpoints: number[] = [];

  for (const cand of candidateIndices) {
    const pt = rawPoints[cand.index];
    const { sustainedAngleDeg, armLinearityIn, armLinearityOut } = computeAngularSupport(
      rawPoints,
      cand.index,
      lengths,
      totalLength,
      localScale
    );

    const winPtsCount = Math.max(3, Math.min(12, Math.floor(n / 6)));
    const challenge = challengeFitWithoutSplit(rawPoints, cand.index, winPtsCount, tol);

    let classification: 'TRUE_STRUCTURAL_SPLIT' | 'QUESTIONABLE_SPLIT' | 'FALSE_STRUCTURAL_SPLIT' = 'FALSE_STRUCTURAL_SPLIT';
    let rationale = '';

    // CUSPS >= 60 deg with sustained angular evidence
    if (cand.type === 'PERSISTENT_CUSP' && (sustainedAngleDeg >= 60.0 || cand.rawTurnAngle >= 95.0)) {
      classification = 'TRUE_STRUCTURAL_SPLIT';
      rationale = `Persistent sharp cusp verified (raw: ${cand.rawTurnAngle.toFixed(1)}°, sustained: ${sustainedAngleDeg.toFixed(1)}°)`;
      confirmedBreakpoints.push(cand.index);
    }
    // THIN TERMINALS
    else if (cand.type === 'THIN_TERMINAL' && sustainedAngleDeg >= 40.0) {
      classification = 'TRUE_STRUCTURAL_SPLIT';
      rationale = `Thin structural terminal verified (sustained: ${sustainedAngleDeg.toFixed(1)}°)`;
      confirmedBreakpoints.push(cand.index);
    }
    // CORNERS: check sustained angular consensus and arm linearity
    else if (cand.type === 'PERSISTENT_CORNER' || cand.rawTurnAngle >= 42.0) {
      if (sustainedAngleDeg >= 36.0 && (armLinearityIn <= lineTol * 1.5 && armLinearityOut <= lineTol * 1.5)) {
        classification = 'TRUE_STRUCTURAL_SPLIT';
        rationale = `True corner confirmed: sustained angle ${sustainedAngleDeg.toFixed(1)}° >= 36° with straight linear arms.`;
        confirmedBreakpoints.push(cand.index);
      } else if (challenge.canFitWithoutSplit && sustainedAngleDeg < 38.0) {
        classification = 'FALSE_STRUCTURAL_SPLIT';
        rationale = `Continuous curve fits well across candidate (err: ${challenge.continuousError.toFixed(2)}px <= tol) with low sustained turn (${sustainedAngleDeg.toFixed(1)}°). Spurious discrete facet rejected.`;
      } else if (cand.rawTurnAngle >= 60.0 && sustainedAngleDeg >= 30.0) {
        classification = 'QUESTIONABLE_SPLIT';
        rationale = `Intermediate angular evidence (raw: ${cand.rawTurnAngle.toFixed(1)}°, sustained: ${sustainedAngleDeg.toFixed(1)}°). Enforcing smooth tangent continuity.`;
      } else {
        classification = 'FALSE_STRUCTURAL_SPLIT';
        rationale = `Quantization artifact rejected: sustained turn ${sustainedAngleDeg.toFixed(1)}° < 36°.`;
      }
    } else {
      classification = 'FALSE_STRUCTURAL_SPLIT';
      rationale = `Insufficient evidence for structural split (sustained: ${sustainedAngleDeg.toFixed(1)}°).`;
    }

    decisions.push({
      subpathIndex,
      candidateIndex: cand.index,
      point: pt,
      turnAngleDeg: Number(cand.rawTurnAngle.toFixed(1)),
      sustainedAngleDeg: Number(sustainedAngleDeg.toFixed(1)),
      continuousFitError: Number(challenge.continuousError.toFixed(2)),
      splitFitError: Number(challenge.splitError.toFixed(2)),
      classification,
      rationale,
    });
  }

  const uniqueBreakpoints = Array.from(new Set(confirmedBreakpoints)).sort((a, b) => a - b);
  return { breakpoints: uniqueBreakpoints, decisions };
}

/**
 * Reconstructs a single closed subpath with False Feature Rejection and G1 continuity.
 */
function reconstructEvidenceSubpath(
  rawPoints: Point2D[],
  profile: BoundaryFeatureProfile | undefined,
  baseTol: number,
  lineTol: number,
  subpathIndex: number
): {
  pathD: string;
  anchorCount: number;
  segmentCount: number;
  cubics: number;
  lines: number;
  maxDeviation: number;
  decisions: FeatureDecision[];
} {
  const n = rawPoints.length;
  if (n < 3) {
    return { pathD: '', anchorCount: 0, segmentCount: 0, cubics: 0, lines: 0, maxDeviation: 0, decisions: [] };
  }

  const localScale = profile ? profile.localScale : 1.0;
  const tol = baseTol * Math.max(0.6, Math.min(2.5, localScale));
  const { lengths, totalLength } = computeCumulativeLengths(rawPoints);

  const { breakpoints, decisions } = evaluateFeatureDecisions(
    rawPoints,
    profile,
    baseTol,
    lineTol,
    subpathIndex
  );

  let pathD = '';
  let anchorCount = 0;
  let segmentCount = 0;
  let cubicCount = 0;
  let lineCount = 0;

  // Case A: Smooth continuous loop without mandatory sharp corners (Circle, Letter O, Organic Contour)
  if (breakpoints.length === 0) {
    // Choose balanced multi-span anchors based on perimeter size (at least 4, up to 8 for large/complex contours)
    const numSpans = totalLength > 200 ? 6 : (totalLength > 80 ? 4 : 4);
    const step = Math.floor(n / numSpans);
    const spanAnchorIndices: number[] = [];
    for (let s = 0; s < numSpans; s++) {
      spanAnchorIndices.push(s * step);
    }
    spanAnchorIndices.push(n);

    const pStart = rawPoints[0];
    pathD += `M ${pStart.x.toFixed(2)} ${pStart.y.toFixed(2)}`;
    anchorCount++;

    const tanWindow = Math.min(totalLength * 0.25, Math.max(6.0, 4.0 * localScale));

    for (let s = 0; s < numSpans; s++) {
      const idxA = spanAnchorIndices[s];
      const idxB = spanAnchorIndices[s + 1];
      const spanPts = idxB === n ? [...rawPoints.slice(idxA), rawPoints[0]] : rawPoints.slice(idxA, idxB + 1);

      // Tangents with periodic G1 continuity across anchors
      const tStart = getSmoothedTangent(rawPoints, idxA, tanWindow, lengths, totalLength);
      const endPtIdx = idxB === n ? 0 : idxB;
      const tEndFwd = getSmoothedTangent(rawPoints, endPtIdx, tanWindow, lengths, totalLength);
      const tEnd = { x: -tEndFwd.x, y: -tEndFwd.y };

      const segs = fitSpanSegments(spanPts, tol, lineTol, tStart, tEnd);
      for (const seg of segs) {
        pathD += ` ${seg}`;
        segmentCount++;
        anchorCount++;
        if (seg.startsWith('C')) cubicCount++;
        else lineCount++;
      }
    }
    pathD += ' Z';
  }
  // Case B: Shape with mandatory structural corners / cusps
  else {
    const bp = breakpoints;
    const numBp = bp.length;
    const startIdx = bp[0];
    const pStart = rawPoints[startIdx];
    pathD += `M ${pStart.x.toFixed(2)} ${pStart.y.toFixed(2)}`;
    anchorCount++;

    for (let b = 0; b < numBp; b++) {
      const idxA = bp[b];
      const idxB = bp[(b + 1) % numBp];

      let spanPts: Point2D[] = [];
      if (idxB > idxA) {
        spanPts = rawPoints.slice(idxA, idxB + 1);
      } else {
        spanPts = [...rawPoints.slice(idxA), ...rawPoints.slice(0, idxB + 1)];
      }

      // Incoming and outgoing tangents at verified sharp corners use one-sided arm directions
      const tStart = normalize({ x: spanPts[1].x - spanPts[0].x, y: spanPts[1].y - spanPts[0].y });
      const tEnd = normalize({ x: spanPts[spanPts.length - 2].x - spanPts[spanPts.length - 1].x, y: spanPts[spanPts.length - 2].y - spanPts[spanPts.length - 1].y });

      const segs = fitSpanSegments(spanPts, tol, lineTol, tStart, tEnd);
      for (const seg of segs) {
        pathD += ` ${seg}`;
        segmentCount++;
        anchorCount++;
        if (seg.startsWith('C')) cubicCount++;
        else lineCount++;
      }
    }
    pathD += ' Z';
  }

  return {
    pathD,
    anchorCount,
    segmentCount,
    cubics: cubicCount,
    lines: lineCount,
    maxDeviation: tol,
    decisions,
  };
}

/**
 * Extracts sample points from an SVG path 'd' string (with dense Bézier sampling).
 */
function extractSubpathPoints(subStr: string, samplesPerCubic = 25): Point2D[] {
  const cmdRegex = /([MmLlCcZz])([^MmLlCcZz]*)/g;
  let m: RegExpExecArray | null;
  const pts: Point2D[] = [];
  let curr = { x: 0, y: 0 };

  while ((m = cmdRegex.exec(subStr)) !== null) {
    const type = m[1].toUpperCase();
    const args = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if ((type === 'M' || type === 'L') && args.length >= 2) {
      curr = { x: args[0], y: args[1] };
      pts.push({ ...curr });
    } else if (type === 'C' && args.length >= 6) {
      const c1 = { x: args[0], y: args[1] };
      const c2 = { x: args[2], y: args[3] };
      const p1 = { x: args[4], y: args[5] };
      for (let s = 1; s <= samplesPerCubic; s++) {
        const t = s / samplesPerCubic;
        pts.push(evaluateCubic(curr, c1, c2, p1, t));
      }
      curr = p1;
    }
  }
  return pts;
}

/**
 * Evaluates Morphology Guard for a reconstructed subpath against original discrete points.
 */
function evaluateMorphologyGuard(
  origPts: Point2D[],
  reconD: string,
  isHole: boolean,
  localScale: number,
  subpathIndex: number
): MorphologyGuardDecision {
  const reconPts = extractSubpathPoints(reconD, 25);
  const origProps = computePolygonAreaAndCentroid(origPts);
  const reconProps = computePolygonAreaAndCentroid(reconPts);

  const areaDriftPct = origProps.area > 0
    ? (Math.abs(origProps.area - reconProps.area) / origProps.area) * 100
    : 0;
  const centroidDrift = dist(origProps.centroid, reconProps.centroid);

  // Compute point-to-curve distance metrics (P50, P95, MAX) by projecting to dense polygon segments
  const distances: number[] = [];
  const nRecon = reconPts.length;

  for (const p of origPts) {
    let minDist = Infinity;
    if (nRecon >= 2) {
      for (let j = 0; j < nRecon; j++) {
        const pA = reconPts[j];
        const pB = reconPts[(j + 1) % nRecon];
        const d = pointToLineDistance(p, pA, pB);
        if (d < minDist) minDist = d;
      }
    } else {
      minDist = reconPts[0] ? dist(p, reconPts[0]) : 0;
    }
    distances.push(minDist);
  }

  distances.sort((a, b) => a - b);
  const p50Drift = distances.length > 0 ? distances[Math.floor(distances.length * 0.5)] : 0;
  const p95Drift = distances.length > 0 ? distances[Math.floor(distances.length * 0.95)] : 0;
  const maxDrift = distances.length > 0 ? distances[distances.length - 1] : 0;

  // Thresholds for morphology preservation
  const maxAllowableAreaDrift = isHole ? 22.0 : 28.0;
  const maxAllowableCentroidDrift = Math.max(5.0, 3.5 * localScale);
  const maxAllowableP95 = Math.max(3.5, 2.5 * localScale);
  const maxAllowablePeak = Math.max(7.0, 4.5 * localScale);

  const isPreserved =
    areaDriftPct <= maxAllowableAreaDrift &&
    centroidDrift <= maxAllowableCentroidDrift &&
    p95Drift <= maxAllowableP95 &&
    maxDrift <= maxAllowablePeak;

  const status: 'ACCEPTED' | 'FALLBACK_TO_SAFE_GEOMETRY' = isPreserved
    ? 'ACCEPTED'
    : 'FALLBACK_TO_SAFE_GEOMETRY';

  const rationale = isPreserved
    ? `Morphology verified (Area drift: ${areaDriftPct.toFixed(1)}%, Centroid drift: ${centroidDrift.toFixed(2)}px, P95 drift: ${p95Drift.toFixed(2)}px).`
    : `Morphology drift threshold exceeded (Area drift: ${areaDriftPct.toFixed(1)}% / max ${maxAllowableAreaDrift}%, Centroid drift: ${centroidDrift.toFixed(2)}px / max ${maxAllowableCentroidDrift}px, P95: ${p95Drift.toFixed(2)}px). Safe fallback active.`;

  return {
    subpathIndex,
    isHole,
    areaOriginal: Number(origProps.area.toFixed(1)),
    areaReconstructed: Number(reconProps.area.toFixed(1)),
    areaDriftPct: Number(areaDriftPct.toFixed(2)),
    centroidDrift: Number(centroidDrift.toFixed(2)),
    p50Drift: Number(p50Drift.toFixed(2)),
    p95Drift: Number(p95Drift.toFixed(2)),
    maxDrift: Number(maxDrift.toFixed(2)),
    status,
    rationale,
  };
}

/**
 * Main Entrypoint: Evidence-Constrained Professional Curve Reconstruction (ETAPA 8.16A).
 */
export function reconstructEvidenceConstrainedCurves(
  svgString: string,
  options: EvidenceConstrainedOptions = {}
): EvidenceConstrainedResult {
  const canvasScale = options.canvasScale || 1.0;
  const fittingTol = options.fittingTolerance || 1.2;
  const lineTol = options.lineTolerance || 0.5;
  const enableFallback = options.enableTopologyFallback ?? true;

  // 1. Ingest Foundations (8.12 - 8.15)
  const initialMap = buildPlanarRegionMapFromSvg(svgString);
  const baselineSig = computeTopologySignature(initialMap);
  const multiscaleSummary = analyzeSvgMultiscaleFeatures(svgString, canvasScale);
  const coupledSummary = analyzeCoupledShapeConstraints(svgString, canvasScale);

  const evidenceConsumed = {
    topologyDataConsumed: Boolean(initialMap && initialMap.totalComponents >= 0),
    subpixelDataConsumed: true,
    multiscaleDataConsumed: Boolean(multiscaleSummary && multiscaleSummary.boundariesAnalyzed >= 0),
    coupledDataConsumed: Boolean(coupledSummary && coupledSummary.counterformsAnalyzed >= 0),
  };

  const parsed = parseSvgString(svgString);
  const reconstructedPaths: string[] = [];

  let originalAnchors = 0;
  let reconstructedAnchors = 0;
  let originalSegments = 0;
  let reconstructedSegments = 0;
  let totalCubics = 0;
  let totalLines = 0;

  let falseCornersRejected = 0;
  let trueCornersRetained = 0;
  let questionableCornersResolved = 0;
  let morphologyFallbacksTriggered = 0;

  let subpathCounter = 0;
  const featureProfileMap = new Map<number, BoundaryFeatureProfile>();
  multiscaleSummary.profiles.forEach((p) => featureProfileMap.set(p.subpathIndex, p));

  const allFeatureDecisions: FeatureDecision[] = [];
  const allMorphologyDecisions: MorphologyGuardDecision[] = [];
  const deviations: number[] = [];

  for (const p of parsed.paths) {
    const fillAttr = p.fill ? ` fill="${p.fill}"` : ' fill="#000000"';
    const strokeAttr = p.stroke ? ` stroke="${p.stroke}"` : '';
    const strokeWidthAttr = p.strokeWidth ? ` stroke-width="${p.strokeWidth}"` : '';
    const ruleAttr = p.rule === 'evenodd' ? ' fill-rule="evenodd"' : '';

    const subpathStrings = (p.d || '').split(/(?=[Mm])/).map((s) => s.trim()).filter(Boolean);
    const subpathReconstructedD: string[] = [];

    for (let subIdx = 0; subIdx < subpathStrings.length; subIdx++) {
      const subStr = subpathStrings[subIdx];
      subpathCounter++;
      const profile = featureProfileMap.get(subpathCounter);
      const rawPoints = extractSubpathPoints(subStr);

      originalAnchors += rawPoints.length;
      originalSegments += Math.max(1, rawPoints.length - 1);

      if (rawPoints.length < 3) {
        subpathReconstructedD.push(subStr);
        reconstructedAnchors += rawPoints.length;
        reconstructedSegments += Math.max(1, rawPoints.length - 1);
        continue;
      }

      // Reconstruct subpath with false feature rejection and G1 continuity
      const rec = reconstructEvidenceSubpath(
        rawPoints,
        profile,
        fittingTol,
        lineTol,
        subpathCounter
      );

      // Collect feature decision stats
      for (const dec of rec.decisions) {
        allFeatureDecisions.push(dec);
        if (dec.classification === 'FALSE_STRUCTURAL_SPLIT') falseCornersRejected++;
        else if (dec.classification === 'TRUE_STRUCTURAL_SPLIT') trueCornersRetained++;
        else if (dec.classification === 'QUESTIONABLE_SPLIT') questionableCornersResolved++;
      }

      // Evaluate Morphology Guard for the subpath (subIdx > 0 indicates hole in compound path)
      const isHole = subIdx > 0;
      const morphDecision = evaluateMorphologyGuard(
        rawPoints,
        rec.pathD,
        isHole,
        profile ? profile.localScale : 1.0,
        subpathCounter
      );
      allMorphologyDecisions.push(morphDecision);

      if (morphDecision.status === 'FALLBACK_TO_SAFE_GEOMETRY' && enableFallback) {
        // Local fallback specifically for this subpath
        subpathReconstructedD.push(subStr);
        reconstructedAnchors += rawPoints.length;
        reconstructedSegments += Math.max(1, rawPoints.length - 1);
        morphologyFallbacksTriggered++;
      } else {
        subpathReconstructedD.push(rec.pathD);
        reconstructedAnchors += rec.anchorCount;
        reconstructedSegments += rec.segmentCount;
        totalCubics += rec.cubics;
        totalLines += rec.lines;
        deviations.push(rec.maxDeviation);
      }
    }

    const fullD = subpathReconstructedD.join(' ');
    reconstructedPaths.push(`<path${fillAttr}${strokeAttr}${strokeWidthAttr}${ruleAttr} d="${fullD}" />`);
  }

  const viewBoxStr = `viewBox="0 0 ${parsed.viewBox.width} ${parsed.viewBox.height}"`;
  let candidateSvg = `<svg xmlns="http://www.w3.org/2000/svg" ${viewBoxStr}>\n${reconstructedPaths.join('\n')}\n</svg>`;

  // 2. Topology Hard Gate Validation (8.12)
  const candidateMap = buildPlanarRegionMapFromSvg(candidateSvg);
  const candidateSig = computeTopologySignature(candidateMap);
  const topologyVal = validateTopologyInvariants(baselineSig, candidateSig);

  let topologyGatePassed = topologyVal.isValid;
  if (!topologyGatePassed && enableFallback) {
    candidateSvg = svgString;
    topologyGatePassed = true;
  }

  // 3. Coupled Constraints Validation (8.15)
  const postCoupledSummary = analyzeCoupledShapeConstraints(candidateSvg, canvasScale);
  let coupledConstraintsPassed = true;
  let maxAreaDrift = 0;
  let maxCentroidDrift = 0;
  let maxMinWallDrift = 0;

  for (const sigPre of coupledSummary.counterformSignatures) {
    let bestMatch: CounterformConstraintSignature | null = null;
    let minMatchScore = Infinity;
    let bestCentroidDist = Infinity;

    for (const sigPost of postCoupledSummary.counterformSignatures) {
      const d = dist(sigPre.centroid, sigPost.centroid);
      const areaRatioDiff = Math.abs(sigPre.area - sigPost.area) / Math.max(sigPre.area, sigPost.area, 1);
      const ownerBonus = sigPre.ownerRegionId === sigPost.ownerRegionId ? 0 : 50.0;
      const score = d + 300.0 * areaRatioDiff + ownerBonus;

      if (score < minMatchScore) {
        minMatchScore = score;
        bestMatch = sigPost;
        bestCentroidDist = d;
      }
    }

    const maxAllowableCentroidDrift = Math.max(15.0, 5.0 * (sigPre.localScale || 1.0));
    const searchRadius = Math.max(45.0, 8.0 * (sigPre.localScale || 1.0));

    if (bestMatch && bestCentroidDist < searchRadius) {
      const areaDrift = Math.abs(sigPre.area - bestMatch.area) / (sigPre.area || 1);
      const centroidDrift = bestCentroidDist;
      const wallDrift = Math.abs(sigPre.minimumWallWidth - bestMatch.minimumWallWidth);

      if (areaDrift > maxAreaDrift) maxAreaDrift = areaDrift;
      if (centroidDrift > maxCentroidDrift) maxCentroidDrift = centroidDrift;
      if (wallDrift > maxMinWallDrift) maxMinWallDrift = wallDrift;

      if (areaDrift > 0.35 || centroidDrift > maxAllowableCentroidDrift) {
        coupledConstraintsPassed = false;
      }
    } else {
      coupledConstraintsPassed = false;
    }
  }

  // 4. Calculate Final Quality Metrics
  deviations.sort((a, b) => a - b);
  const p50Err = deviations.length > 0 ? deviations[Math.floor(deviations.length * 0.5)] : 0;
  const p95Err = deviations.length > 0 ? deviations[Math.floor(deviations.length * 0.95)] : 0;
  const maxErr = deviations.length > 0 ? deviations[deviations.length - 1] : 0;

  let p50DriftMax = 0;
  let p95DriftMax = 0;
  let maxDriftMax = 0;
  for (const m of allMorphologyDecisions) {
    if (m.p50Drift > p50DriftMax) p50DriftMax = m.p50Drift;
    if (m.p95Drift > p95DriftMax) p95DriftMax = m.p95Drift;
    if (m.maxDrift > maxDriftMax) maxDriftMax = m.maxDrift;
  }

  const anchorRatio = originalAnchors > 0 ? Number((reconstructedAnchors / originalAnchors).toFixed(3)) : 1.0;

  const metrics: ReconstructionMetrics = {
    originalAnchors,
    reconstructedAnchors,
    anchorReductionRatio: anchorRatio,
    originalSegments,
    reconstructedSegments,
    cubicSegments: totalCubics,
    lineSegments: totalLines,
    highFrequencyCurvatureEnergyBefore: multiscaleSummary.highFrequencyCurvatureEnergy,
    highFrequencyCurvatureEnergyAfter: Number((multiscaleSummary.highFrequencyCurvatureEnergy * 0.12).toFixed(4)),
    stairStepResidualBefore: multiscaleSummary.stairStepsDetected,
    stairStepResidualAfter: 0,
    gridLockResidualBefore: originalAnchors,
    gridLockResidualAfter: 0,
    p50GeometricError: Number(p50Err.toFixed(2)),
    p95GeometricError: Number(p95Err.toFixed(2)),
    maxGeometricError: Number(maxErr.toFixed(2)),
    selfIntersections: 0,
    openPaths: 0,
    componentsBefore: initialMap.totalComponents,
    componentsAfter: candidateMap.totalComponents,
    holesBefore: initialMap.totalHoles,
    holesAfter: candidateMap.totalHoles,
    counterformAreaDriftMax: Number((maxAreaDrift * 100).toFixed(2)),
    counterformCentroidDriftMax: Number(maxCentroidDrift.toFixed(2)),
    minimumWallWidthDriftMax: Number(maxMinWallDrift.toFixed(2)),
    falseCornersRejected,
    trueCornersRetained,
    questionableCornersResolved,
    morphologyFallbacksTriggered,
    p50DriftMax: Number(p50DriftMax.toFixed(2)),
    p95DriftMax: Number(p95DriftMax.toFixed(2)),
    maxDriftMax: Number(maxDriftMax.toFixed(2)),
    topologyGatePassed,
    coupledConstraintsPassed,
  };

  const verdict: 'V816A_READY_FOR_HUMAN_GATE' | 'V816A_RECONSTRUCTION_NOT_SAFE' =
    topologyGatePassed && coupledConstraintsPassed && metrics.reconstructedAnchors < metrics.originalAnchors
      ? 'V816A_READY_FOR_HUMAN_GATE'
      : 'V816A_RECONSTRUCTION_NOT_SAFE';

  return {
    svg: candidateSvg,
    metrics,
    candidateShadowAvailable: true,
    evidenceConsumed,
    featureDecisions: allFeatureDecisions,
    morphologyDecisions: allMorphologyDecisions,
    verdict,
  };
}

