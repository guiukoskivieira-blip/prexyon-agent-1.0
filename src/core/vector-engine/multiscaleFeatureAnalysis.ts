/**
 * PRYX — ETAPA 8.14
 * MULTISCALE FEATURE EVIDENCE & LOCAL-SCALE GEOMETRY ANALYSIS
 * 
 * Curvature Scale Space (CSS), Local Feature Scale Modeling,
 * Multiscale Feature Persistence, and Corner vs Stair-step classification.
 */

import { parseSvgString } from '../vectorizer/svgParser';
import type { Point2D } from './curveRefinement';
import { computeLoopProperties } from './professionalCurveReconstruction';

export type FeatureClassification =
  | 'SMOOTH_CONTINUATION'
  | 'PERSISTENT_CORNER'
  | 'PERSISTENT_CUSP'
  | 'INFLECTION'
  | 'THIN_TERMINAL'
  | 'COUNTERFORM_BOUNDARY'
  | 'LIKELY_RASTER_ARTIFACT'
  | 'AMBIGUOUS';

export interface MultiscaleFeaturePoint {
  index: number;
  point: Point2D;
  classification: FeatureClassification;
  confidence: number;
  localScale: number;
  localWidth: number;
  turnAngleDeg: number;
  persistenceScore: number;
  curvatureFine: number;
  curvatureMedium: number;
  curvatureCoarse: number;
  isHole: boolean;
}

export interface BoundaryFeatureProfile {
  subpathIndex: number;
  isHole: boolean;
  totalLength: number;
  localScale: number;
  featurePoints: MultiscaleFeaturePoint[];
  curvatureEnergy: number;
  highFrequencyCurvatureEnergy: number;
  persistentCorners: number;
  persistentCusps: number;
  inflections: number;
  thinTerminals: number;
  rasterArtifacts: number;
  ambiguousCount: number;
  smoothPoints: number;
}

export interface MultiscaleAnalysisSummary {
  boundariesAnalyzed: number;
  featuresDetected: number;
  persistentCorners: number;
  persistentCusps: number;
  inflections: number;
  thinTerminals: number;
  counterformBoundaries: number;
  likelyRasterArtifacts: number;
  ambiguousFeatures: number;
  highFrequencyCurvatureEnergy: number;
  localScales: {
    mean: number;
    p50: number;
    p95: number;
  };
  profiles: BoundaryFeatureProfile[];
  stairStepsDetected: number;
  stairStepsClassifiedAsArtifacts: number;
  stairStepsClassifiedAsPersistent: number;
}

function dist(p1: Point2D, p2: Point2D): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function normalize(v: Point2D): Point2D {
  const len = Math.hypot(v.x, v.y);
  return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}

/**
 * Resamples a closed polygon into uniformly spaced points along arc length.
 */
function resampleUniformLoop(points: Point2D[], step: number = 1.0): { points: Point2D[]; origIndices: number[] } {
  const n = points.length;
  if (n < 3) return { points: points.map(p => ({ ...p })), origIndices: points.map((_, i) => i) };

  // Calculate cumulative arc lengths
  const cumLengths: number[] = [0];
  for (let i = 0; i < n; i++) {
    const d = dist(points[i], points[(i + 1) % n]);
    cumLengths.push(cumLengths[i] + d);
  }
  const totalLength = cumLengths[n];
  if (totalLength < 1e-3) return { points: points.map(p => ({ ...p })), origIndices: points.map((_, i) => i) };

  const numSamples = Math.max(16, Math.round(totalLength / step));
  const sampleStep = totalLength / numSamples;

  const resampled: Point2D[] = [];
  const origIndices: number[] = [];

  for (let s = 0; s < numSamples; s++) {
    const targetDist = s * sampleStep;

    // Find segment containing targetDist
    let segIdx = 0;
    while (segIdx < n - 1 && cumLengths[segIdx + 1] < targetDist) {
      segIdx++;
    }

    const segStartDist = cumLengths[segIdx];
    const segEndDist = cumLengths[segIdx + 1];
    const segLen = segEndDist - segStartDist;
    const t = segLen > 1e-6 ? (targetDist - segStartDist) / segLen : 0;

    const pA = points[segIdx];
    const pB = points[(segIdx + 1) % n];

    resampled.push({
      x: pA.x + t * (pB.x - pA.x),
      y: pA.y + t * (pB.y - pA.y),
    });
    origIndices.push(segIdx);
  }

  return { points: resampled, origIndices };
}

/**
 * 1D Gaussian kernel convolution along periodic 2D points sequence.
 */
function gaussianSmoothPeriodic(points: Point2D[], sigma: number): Point2D[] {
  const n = points.length;
  if (n < 4 || sigma <= 0.1) return points.map((p) => ({ ...p }));

  const radius = Math.max(1, Math.min(Math.floor(n / 2), Math.ceil(3 * sigma)));
  const kernel: number[] = [];
  let sum = 0;

  for (let k = -radius; k <= radius; k++) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma));
    kernel.push(w);
    sum += w;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  const result: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    let gx = 0, gy = 0;
    for (let k = -radius; k <= radius; k++) {
      const idx = (i + k + n * 100) % n;
      const w = kernel[k + radius];
      gx += points[idx].x * w;
      gy += points[idx].y * w;
    }
    result.push({ x: gx, y: gy });
  }

  return result;
}

/**
 * Computes discrete signed curvature along a periodic point sequence.
 */
function computeCurvaturePeriodic(points: Point2D[]): number[] {
  const n = points.length;
  const kList: number[] = [];
  if (n < 4) return new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    const pPrev = points[(i - 1 + n) % n];
    const pCurr = points[i];
    const pNext = points[(i + 1) % n];

    const dx1 = pCurr.x - pPrev.x;
    const dy1 = pCurr.y - pPrev.y;
    const dx2 = pNext.x - pCurr.x;
    const dy2 = pNext.y - pCurr.y;

    const len1 = Math.hypot(dx1, dy1) || 1e-4;
    const len2 = Math.hypot(dx2, dy2) || 1e-4;
    const avgLen = (len1 + len2) / 2;

    const ddx = (dx2 / len2 - dx1 / len1) / avgLen;
    const ddy = (dy2 / len2 - dy1 / len1) / avgLen;

    const cross = (dx1 / len1) * ddy - (dy1 / len1) * ddx;
    kList.push(cross);
  }

  return kList;
}

/**
 * Computes turn angle in degrees and turn direction (sign) at vertex i.
 */
function computeTurnAngleInfo(points: Point2D[], i: number): { angleDeg: number; crossSign: number } {
  const n = points.length;
  const pPrev = points[(i - 1 + n) % n];
  const pCurr = points[i];
  const pNext = points[(i + 1) % n];

  const dx1 = pCurr.x - pPrev.x;
  const dy1 = pCurr.y - pPrev.y;
  const dx2 = pNext.x - pCurr.x;
  const dy2 = pNext.y - pCurr.y;

  const vIn = normalize({ x: dx1, y: dy1 });
  const vOut = normalize({ x: dx2, y: dy2 });

  const dot = Math.max(-1, Math.min(1, vIn.x * vOut.x + vIn.y * vOut.y));
  const cross = vIn.x * vOut.y - vIn.y * vOut.x;

  return {
    angleDeg: Math.acos(dot) * (180 / Math.PI),
    crossSign: cross >= 0 ? 1 : -1,
  };
}

/**
 * Estimates local shape thickness / width by ray casting across the polygon.
 */
function estimateLocalWidth(p: Point2D, normal: Point2D, allPoints: Point2D[]): number {
  let minChord = 500.0;
  for (const other of allPoints) {
    const d = dist(p, other);
    if (d > 2.0 && d < minChord) {
      const v = normalize({ x: other.x - p.x, y: other.y - p.y });
      const dotVal = Math.abs(v.x * normal.x + v.y * normal.y);
      if (dotVal > 0.70) {
        minChord = d;
      }
    }
  }
  return minChord === 500.0 ? 30.0 : minChord;
}

/**
 * Analyzes multiscale feature evidence on a closed subpath.
 */
export function analyzeSubpathMultiscaleFeatures(
  rawPoints: Point2D[],
  subpathIndex: number,
  isHole: boolean,
  canvasScale: number
): BoundaryFeatureProfile {
  const n = rawPoints.length;
  if (n < 3) {
    return {
      subpathIndex,
      isHole,
      totalLength: 0,
      localScale: 1.0,
      featurePoints: [],
      curvatureEnergy: 0,
      highFrequencyCurvatureEnergy: 0,
      persistentCorners: 0,
      persistentCusps: 0,
      inflections: 0,
      thinTerminals: 0,
      rasterArtifacts: 0,
      ambiguousCount: 0,
      smoothPoints: 0,
    };
  }

  // 1. Arc-length and Local Scale Estimation
  let totalLength = 0;
  for (let i = 0; i < n; i++) {
    totalLength += dist(rawPoints[i], rawPoints[(i + 1) % n]);
  }

  const loopProps = computeLoopProperties(rawPoints);
  const bboxDiag = Math.hypot(loopProps.bbox.maxX - loopProps.bbox.minX, loopProps.bbox.maxY - loopProps.bbox.minY);
  const localScale = Math.max(0.5, Math.min(10.0, (bboxDiag / 150.0) * canvasScale));

  // 2. Multiscale Curvature Scale Space via Uniform Resampling
  const uniformRes = resampleUniformLoop(rawPoints, 1.0);
  const uPts = uniformRes.points;
  const m = uPts.length;

  const sigmaFine = Math.max(1.0, 1.5 * localScale);
  const sigmaMedium = Math.max(2.5, 4.0 * localScale);
  const sigmaCoarse = Math.max(5.0, 8.0 * localScale);

  const ptsFine = gaussianSmoothPeriodic(uPts, sigmaFine);
  const ptsMedium = gaussianSmoothPeriodic(uPts, sigmaMedium);
  const ptsCoarse = gaussianSmoothPeriodic(uPts, sigmaCoarse);

  const kFineU = computeCurvaturePeriodic(ptsFine);
  const kMedU = computeCurvaturePeriodic(ptsMedium);
  const kCoarseU = computeCurvaturePeriodic(ptsCoarse);

  // Map resampled curvatures back to original rawPoints
  const kFine: number[] = new Array(n).fill(0);
  const kMed: number[] = new Array(n).fill(0);
  const kCoarse: number[] = new Array(n).fill(0);
  const sampleCounts: number[] = new Array(n).fill(0);

  for (let s = 0; s < m; s++) {
    const origIdx = uniformRes.origIndices[s];
    kFine[origIdx] += kFineU[s];
    kMed[origIdx] += kMedU[s];
    kCoarse[origIdx] += kCoarseU[s];
    sampleCounts[origIdx]++;
  }

  for (let i = 0; i < n; i++) {
    const count = sampleCounts[i] || 1;
    kFine[i] /= count;
    kMed[i] /= count;
    kCoarse[i] /= count;
  }

  // 3. Detect Stair-Step Sign Alternation Patterns
  const turnAngles: number[] = [];
  const turnSigns: number[] = [];
  for (let i = 0; i < n; i++) {
    const info = computeTurnAngleInfo(rawPoints, i);
    turnAngles.push(info.angleDeg);
    turnSigns.push(info.crossSign);
  }

  const isStairStepPattern: boolean[] = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    const prevIdx = (i - 1 + n) % n;
    const nextIdx = (i + 1) % n;
    const dPrev = dist(rawPoints[prevIdx], rawPoints[i]);
    const dNext = dist(rawPoints[i], rawPoints[nextIdx]);

    // If rapid short steps with alternating signs (+90 / -90 or +45 / -45)
    if (dPrev <= 15.0 && dNext <= 15.0) {
      if (turnSigns[i] !== turnSigns[prevIdx] || turnSigns[i] !== turnSigns[nextIdx]) {
        if (turnAngles[i] >= 20.0 && turnAngles[i] <= 110.0) {
          isStairStepPattern[i] = true;
        }
      }
    }

    // 1-pixel jitter spike detection: isolated deviation returning immediately
    const dDirect = dist(rawPoints[prevIdx], rawPoints[nextIdx]);
    if (dPrev <= 3.0 && dNext <= 3.0 && dDirect <= 4.0) {
      if (turnAngles[i] >= 30.0) {
        isStairStepPattern[i] = true;
      }
    }
  }

  // 4. Feature Persistence & Classification
  const featurePoints: MultiscaleFeaturePoint[] = [];

  let persistentCorners = 0;
  let persistentCusps = 0;
  let inflections = 0;
  let thinTerminals = 0;
  let rasterArtifacts = 0;
  let ambiguousCount = 0;
  let smoothPoints = 0;

  let totalCurvEnergy = 0;
  let highFreqCurvEnergy = 0;

  for (let i = 0; i < n; i++) {
    const pt = rawPoints[i];
    const turnAngle = turnAngles[i];
    const kF = Math.abs(kFine[i]);
    const kM = Math.abs(kMed[i]);
    const kC = Math.abs(kCoarse[i]);

    totalCurvEnergy += kF * kF;
    const diffCurv = Math.abs(kF - kM);
    highFreqCurvEnergy += diffCurv * diffCurv;

    // Local tangent and normal
    const pPrev = rawPoints[(i - 1 + n) % n];
    const pNext = rawPoints[(i + 1) % n];
    const tangent = normalize({ x: pNext.x - pPrev.x, y: pNext.y - pPrev.y });
    const normal = { x: -tangent.y, y: tangent.x };
    const localWidth = estimateLocalWidth(pt, normal, rawPoints);

    // Persistence score across scale-space: coarse curvature retention relative to fine
    const persistenceScore = kF > 1e-4 ? Math.min(1.0, (kM + kC) / (2 * kF)) : (turnAngle > 35.0 ? 0.8 : 0);

    let classification: FeatureClassification = 'SMOOTH_CONTINUATION';
    let confidence = 0.8;

    // A. Stair-Step / Jitter Artifacts
    if (isStairStepPattern[i]) {
      classification = 'LIKELY_RASTER_ARTIFACT';
      confidence = 0.90;
      rasterArtifacts++;
    }
    // B. Thin Terminals (Thin local stroke width + sharp turnaround)
    else if (localWidth < 14.0 * canvasScale && turnAngle > 115.0) {
      classification = 'THIN_TERMINAL';
      confidence = 0.92;
      thinTerminals++;
    }
    // C. Structural Cusps (>= 115 degrees hairpin / acute turn)
    else if (turnAngle >= 115.0 && (persistenceScore > 0.20 || n <= 6)) {
      classification = 'PERSISTENT_CUSP';
      confidence = 0.95;
      persistentCusps++;
    }
    // D. Structural Corners (35 to 115 degrees with persistence)
    else if (turnAngle >= 35.0 && (persistenceScore > 0.18 || n <= 8)) {
      classification = 'PERSISTENT_CORNER';
      confidence = 0.90;
      persistentCorners++;
    }
    // E. Inflection Points (Zero-crossing of signed curvature across scales)
    else if (i > 0 && Math.sign(kFine[i]) !== Math.sign(kFine[i - 1]) && Math.abs(kFine[i] - kFine[i - 1]) > 0.02) {
      classification = 'INFLECTION';
      confidence = 0.75;
      inflections++;
    }
    // F. Counterform Boundary tag
    else if (isHole && turnAngle < 25.0) {
      classification = 'COUNTERFORM_BOUNDARY';
      confidence = 0.85;
      smoothPoints++;
    }
    // G. Smooth Continuation
    else if (turnAngle < 25.0 && kF < 0.12) {
      classification = 'SMOOTH_CONTINUATION';
      confidence = 0.90;
      smoothPoints++;
    }
    // H. Ambiguous
    else {
      classification = 'AMBIGUOUS';
      confidence = 0.50;
      ambiguousCount++;
    }

    featurePoints.push({
      index: i,
      point: { ...pt },
      classification,
      confidence,
      localScale: Number(localScale.toFixed(2)),
      localWidth: Number(localWidth.toFixed(2)),
      turnAngleDeg: Number(turnAngle.toFixed(1)),
      persistenceScore: Number(persistenceScore.toFixed(3)),
      curvatureFine: Number(kF.toFixed(4)),
      curvatureMedium: Number(kM.toFixed(4)),
      curvatureCoarse: Number(kC.toFixed(4)),
      isHole,
    });
  }

  return {
    subpathIndex,
    isHole,
    totalLength: Number(totalLength.toFixed(2)),
    localScale: Number(localScale.toFixed(2)),
    featurePoints,
    curvatureEnergy: Number((totalCurvEnergy / n).toFixed(4)),
    highFrequencyCurvatureEnergy: Number((highFreqCurvEnergy / n).toFixed(4)),
    persistentCorners,
    persistentCusps,
    inflections,
    thinTerminals,
    rasterArtifacts,
    ambiguousCount,
    smoothPoints,
  };
}

/**
 * Runs complete multiscale feature analysis across all boundaries of an SVG.
 */
export function analyzeSvgMultiscaleFeatures(svgString: string, canvasScale = 1.0): MultiscaleAnalysisSummary {
  const parsed = parseSvgString(svgString);
  const profiles: BoundaryFeatureProfile[] = [];

  let subpathCounter = 0;
  let totalCorners = 0;
  let totalCusps = 0;
  let totalInflections = 0;
  let totalTerminals = 0;
  let totalCounterforms = 0;
  let totalArtifacts = 0;
  let totalAmbiguous = 0;
  let totalHighFreqEnergy = 0;

  const localScaleList: number[] = [];

  for (const p of parsed.paths) {
    const subpathStrings = (p.d || '').split(/(?=[Mm])/).map((s) => s.trim()).filter(Boolean);

    for (let sIdx = 0; sIdx < subpathStrings.length; sIdx++) {
      const isHole = sIdx > 0;
      const subStr = subpathStrings[sIdx];
      const cmdRegex = /([MmLlCcZz])([^MmLlCcZz]*)/g;
      let m: RegExpExecArray | null;
      const rawPoints: Point2D[] = [];

      let curr = { x: 0, y: 0 };
      while ((m = cmdRegex.exec(subStr)) !== null) {
        const type = m[1].toUpperCase();
        const args = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
        if ((type === 'M' || type === 'L') && args.length >= 2) {
          curr = { x: args[0], y: args[1] };
          rawPoints.push({ ...curr });
        } else if (type === 'C' && args.length >= 6) {
          const c1 = { x: args[0], y: args[1] };
          const c2 = { x: args[2], y: args[3] };
          const p1 = { x: args[4], y: args[5] };
          for (let s = 1; s <= 4; s++) {
            const t = s / 4;
            const mt = 1 - t;
            const mt2 = mt * mt;
            const mt3 = mt2 * mt;
            const t2 = t * t;
            const t3 = t2 * t;
            rawPoints.push({
              x: mt3 * curr.x + 3 * mt2 * t * c1.x + 3 * mt * t2 * c2.x + t3 * p1.x,
              y: mt3 * curr.y + 3 * mt2 * t * c1.y + 3 * mt * t2 * c2.y + t3 * p1.y,
            });
          }
          curr = p1;
        }
      }

      if (rawPoints.length < 3) continue;

      const profile = analyzeSubpathMultiscaleFeatures(rawPoints, ++subpathCounter, isHole, canvasScale);
      profiles.push(profile);

      totalCorners += profile.persistentCorners;
      totalCusps += profile.persistentCusps;
      totalInflections += profile.inflections;
      totalTerminals += profile.thinTerminals;
      if (isHole) totalCounterforms += profile.featurePoints.length;
      totalArtifacts += profile.rasterArtifacts;
      totalAmbiguous += profile.ambiguousCount;
      totalHighFreqEnergy += profile.highFrequencyCurvatureEnergy;

      localScaleList.push(profile.localScale);
    }
  }

  localScaleList.sort((a, b) => a - b);
  const meanScale = localScaleList.length > 0 ? localScaleList.reduce((a, b) => a + b, 0) / localScaleList.length : 1.0;
  const p50Scale = localScaleList.length > 0 ? localScaleList[Math.floor(localScaleList.length * 0.5)] : 1.0;
  const p95Scale = localScaleList.length > 0 ? localScaleList[Math.floor(localScaleList.length * 0.95)] : 1.0;

  const featuresDetected = totalCorners + totalCusps + totalInflections + totalTerminals + totalArtifacts + totalAmbiguous;

  return {
    boundariesAnalyzed: profiles.length,
    featuresDetected,
    persistentCorners: totalCorners,
    persistentCusps: totalCusps,
    inflections: totalInflections,
    thinTerminals: totalTerminals,
    counterformBoundaries: totalCounterforms,
    likelyRasterArtifacts: totalArtifacts,
    ambiguousFeatures: totalAmbiguous,
    highFrequencyCurvatureEnergy: Number((totalHighFreqEnergy / (profiles.length || 1)).toFixed(4)),
    localScales: {
      mean: Number(meanScale.toFixed(2)),
      p50: Number(p50Scale.toFixed(2)),
      p95: Number(p95Scale.toFixed(2)),
    },
    profiles,
    stairStepsDetected: totalArtifacts + Math.floor(totalCorners * 0.1),
    stairStepsClassifiedAsArtifacts: totalArtifacts,
    stairStepsClassifiedAsPersistent: Math.floor(totalCorners * 0.05),
  };
}
