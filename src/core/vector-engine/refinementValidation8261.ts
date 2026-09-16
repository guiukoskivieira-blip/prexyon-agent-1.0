/**
 * PRYX — ETAPA 8.26.1
 * REFINEMENT METRIC VALIDATION & FIDELITY GATE
 *
 * Módulo de validação rigorosa para:
 * 1. Validar as métricas G1 e G2 particionando por tipo de junção (SMOOTH vs CORNER vs AMBIGUOUS).
 * 2. Investigar a causa exata da regressão de Chamfer/P95 no Candidate C.
 * 3. Implementar Candidate C2 (Selective G1/G2) com tolerância restrita (cap de deslocamento <= 0.75px).
 * 4. Comparar fidelidade direta contra Ground Truth em todos os 10 casos sintéticos A–J e na Logo Difícil.
 */

import type { Point2D } from './curveRefinement';
import {
  CubicBezierSegment,
  RefinedPath,
  parseSvgToSegments,
  extractSvgDimensions,
  serializeSegmentsToSvg,
  computeBezierBendingEnergy,
  computeTangencyDiscontinuityDegrees,
  computeCurvatureJumpG2,
  sampleForegroundBoundaryPoints,
} from './vectorRefinementBenchmark826';

// ============================================================================
// 1. JUNCTION CLASSIFIER (SMOOTH vs INTENTIONAL_CORNER vs AMBIGUOUS)
// ============================================================================

export type JunctionClass = 'SMOOTH_JUNCTION' | 'INTENTIONAL_CORNER' | 'AMBIGUOUS_JUNCTION';

export interface ClassifiedJunction {
  pathIndex: number;
  subpathIndex: number;
  junctionIndex: number;
  point: Point2D;
  classification: JunctionClass;
  turningAngleDeg: number;
  chordLengthA: number;
  chordLengthB: number;
  bendingEnergyA: number;
  bendingEnergyB: number;
  confidence: number;
  rationale: string;
}

/**
 * Classifies a junction between segA and segB into SMOOTH, CORNER, or AMBIGUOUS
 */
export function classifyJunction(
  segA: CubicBezierSegment,
  segB: CubicBezierSegment,
  pathIndex: number = 0,
  subpathIndex: number = 0,
  junctionIndex: number = 0
): ClassifiedJunction {
  const turningAngle = computeTangencyDiscontinuityDegrees(segA, segB);
  const chordA = Math.hypot(segA.p3.x - segA.p0.x, segA.p3.y - segA.p0.y);
  const chordB = Math.hypot(segB.p3.x - segB.p0.x, segB.p3.y - segB.p0.y);
  const energyA = computeBezierBendingEnergy(segA);
  const energyB = computeBezierBendingEnergy(segB);

  let classification: JunctionClass;
  let confidence: number;
  let rationale: string;

  // Case 1: Sharp turning angle (>= 38 deg) or two straight segments meeting at angle >= 22 deg
  const isBothStraight = energyA < 15.0 && energyB < 15.0;
  if (turningAngle >= 38.0 || (isBothStraight && turningAngle >= 22.0)) {
    classification = 'INTENTIONAL_CORNER';
    confidence = Math.min(1.0, 0.7 + (turningAngle - 38.0) / 50.0);
    rationale = `Sharp turning angle (${turningAngle.toFixed(1)}°) indicates legitimate structural corner`;
  }
  // Case 2: Smooth transition angle (<= 25 deg)
  else if (turningAngle <= 25.0) {
    classification = 'SMOOTH_JUNCTION';
    confidence = Math.min(1.0, 0.7 + (25.0 - turningAngle) / 25.0);
    rationale = `Gentle turning angle (${turningAngle.toFixed(1)}°) along continuous curve span`;
  }
  // Case 3: Ambiguous range (25 deg < angle < 38 deg)
  else {
    classification = 'AMBIGUOUS_JUNCTION';
    confidence = 0.5;
    rationale = `Intermediate turning angle (${turningAngle.toFixed(1)}°) requires conservative preservation`;
  }

  return {
    pathIndex,
    subpathIndex,
    junctionIndex,
    point: { ...segA.p3 },
    classification,
    turningAngleDeg: Number(turningAngle.toFixed(2)),
    chordLengthA: Number(chordA.toFixed(2)),
    chordLengthB: Number(chordB.toFixed(2)),
    bendingEnergyA: Number(energyA.toFixed(1)),
    bendingEnergyB: Number(energyB.toFixed(1)),
    confidence: Number(confidence.toFixed(2)),
    rationale,
  };
}

// ============================================================================
// 2. CANDIDATE C2: SELECTIVE G1/G2 SPLINE REFINER
// ============================================================================

export interface SelectiveRefinementOptions {
  maxDisplacementPx?: number; // Maximum allowed control point displacement (default 0.75px)
  smoothAngleThresholdDeg?: number; // Threshold below which junction is treated as smooth (default 28 deg)
  preserveCorners?: boolean; // Ensure 100% preservation of corners (default true)
}

/**
 * Candidate C2: Selective G1/G2 Multi-Segment Spline Fitting
 * Applies G1 tangency alignment and G2 curvature smoothing ONLY on SMOOTH_JUNCTIONs,
 * leaving INTENTIONAL_CORNERs strictly untouched, and clamping displacement to <= maxDisplacementPx.
 */
export function executeCandidateC2(
  inputSvg: string,
  options: SelectiveRefinementOptions = {}
): { refinedSvg: string; durationMs: number; modifiedJunctionsCount: number; preservedCornersCount: number } {
  const t0 = performance.now();
  const maxDisp = options.maxDisplacementPx ?? 0.75;
  const parsedPaths = parseSvgToSegments(inputSvg);

  let modifiedJunctions = 0;
  let preservedCorners = 0;

  const refinedPaths: RefinedPath[] = parsedPaths.map((pathObj, pIdx) => {
    const refinedSubpaths = pathObj.subpaths.map((subpath, spIdx) => {
      if (subpath.length < 2) return subpath;

      const n = subpath.length;
      const result: CubicBezierSegment[] = subpath.map((s) => ({
        p0: { ...s.p0 },
        p1: { ...s.p1 },
        p2: { ...s.p2 },
        p3: { ...s.p3 },
      }));

      for (let i = 0; i < n; i++) {
        const segA = result[i];
        const segB = result[(i + 1) % n];

        const junction = classifyJunction(segA, segB, pIdx, spIdx, i);

        if (junction.classification === 'SMOOTH_JUNCTION' && junction.turningAngleDeg > 0.5) {
          const vIn = { x: segA.p3.x - segA.p2.x, y: segA.p3.y - segA.p2.y };
          const vOut = { x: segB.p1.x - segB.p0.x, y: segB.p1.y - segB.p0.y };

          const lenIn = Math.hypot(vIn.x, vIn.y) || 1;
          const lenOut = Math.hypot(vOut.x, vOut.y) || 1;

          // Unit tangent
          const uIn = { x: vIn.x / lenIn, y: vIn.y / lenIn };
          const uOut = { x: vOut.x / lenOut, y: vOut.y / lenOut };
          const avgU = { x: uIn.x + uOut.x, y: uIn.y + uOut.y };
          const lenAvg = Math.hypot(avgU.x, avgU.y) || 1;
          const unitTan = { x: avgU.x / lenAvg, y: avgU.y / lenAvg };

          // Ideal G1 handle targets
          const targetP2 = {
            x: segA.p3.x - unitTan.x * lenIn,
            y: segA.p3.y - unitTan.y * lenIn,
          };
          const targetP1 = {
            x: segB.p0.x + unitTan.x * lenOut,
            y: segB.p0.y + unitTan.y * lenOut,
          };

          // Clamp displacement to maxDisp (e.g. 0.75px) to prevent Chamfer drift
          const dispP2 = Math.hypot(targetP2.x - segA.p2.x, targetP2.y - segA.p2.y);
          const dispP1 = Math.hypot(targetP1.x - segB.p1.x, targetP1.y - segB.p1.y);

          const scaleP2 = dispP2 > maxDisp ? maxDisp / dispP2 : 1.0;
          const scaleP1 = dispP1 > maxDisp ? maxDisp / dispP1 : 1.0;

          segA.p2 = {
            x: segA.p2.x + (targetP2.x - segA.p2.x) * scaleP2,
            y: segA.p2.y + (targetP2.y - segA.p2.y) * scaleP2,
          };
          segB.p1 = {
            x: segB.p1.x + (targetP1.x - segB.p1.x) * scaleP1,
            y: segB.p1.y + (targetP1.y - segB.p1.y) * scaleP1,
          };

          modifiedJunctions++;
        } else if (junction.classification === 'INTENTIONAL_CORNER') {
          preservedCorners++;
        }
      }

      return result;
    });

    return { ...pathObj, subpaths: refinedSubpaths };
  });

  const dims = extractSvgDimensions(inputSvg);
  const refinedSvg = serializeSegmentsToSvg(refinedPaths, dims.viewBox, dims.width, dims.height);
  const durationMs = Math.round(performance.now() - t0);

  return { refinedSvg, durationMs, modifiedJunctionsCount: modifiedJunctions, preservedCornersCount: preservedCorners };
}

// ============================================================================
// 3. PARTITIONED G1 & G2 VALIDATION METRICS
// ============================================================================

export interface PartitionedJunctionMetrics {
  totalJunctions: number;
  smoothJunctionsCount: number;
  cornersCount: number;
  ambiguousCount: number;
  // G1 Metrics
  smoothMeanTangencyErrorDeg: number;
  smoothG1DiscontinuitiesCount: number;
  cornerMeanTurningAngleDeg: number;
  overallMeanTangencyErrorDeg: number;
  // G2 Metrics
  smoothMeanCurvatureJumpG2: number;
  cornerMeanCurvatureJumpG2: number;
  overallMeanCurvatureJumpG2: number;
  // Energy
  totalCurvatureEnergy: number;
}

/**
 * Computes strictly partitioned G1 and G2 metrics separating smooth curves from corners
 */
export function evaluatePartitionedJunctionMetrics(svgString: string): PartitionedJunctionMetrics {
  const parsed = parseSvgToSegments(svgString);
  let totalJunctions = 0;
  let smoothCount = 0;
  let cornerCount = 0;
  let ambiguousCount = 0;

  let sumSmoothG1 = 0;
  let smoothDiscontCount = 0;
  let sumCornerG1 = 0;
  let sumAllG1 = 0;

  let sumSmoothG2 = 0;
  let sumCornerG2 = 0;
  let sumAllG2 = 0;

  let totalCurvatureEnergy = 0;

  for (let pIdx = 0; pIdx < parsed.length; pIdx++) {
    const pathObj = parsed[pIdx];
    for (let spIdx = 0; spIdx < pathObj.subpaths.length; spIdx++) {
      const subpath = pathObj.subpaths[spIdx];
      for (let i = 0; i < subpath.length; i++) {
        const segA = subpath[i];
        const segB = subpath[(i + 1) % subpath.length];

        totalCurvatureEnergy += computeBezierBendingEnergy(segA);
        totalJunctions++;

        const junction = classifyJunction(segA, segB, pIdx, spIdx, i);
        const g1Err = junction.turningAngleDeg;
        const g2Jump = computeCurvatureJumpG2(segA, segB);

        sumAllG1 += g1Err;
        sumAllG2 += g2Jump;

        if (junction.classification === 'SMOOTH_JUNCTION') {
          smoothCount++;
          sumSmoothG1 += g1Err;
          if (g1Err > 5.0) smoothDiscontCount++;
          sumSmoothG2 += g2Jump;
        } else if (junction.classification === 'INTENTIONAL_CORNER') {
          cornerCount++;
          sumCornerG1 += g1Err;
          sumCornerG2 += g2Jump;
        } else {
          ambiguousCount++;
        }
      }
    }
  }

  return {
    totalJunctions,
    smoothJunctionsCount: smoothCount,
    cornersCount: cornerCount,
    ambiguousCount,
    smoothMeanTangencyErrorDeg: smoothCount > 0 ? Number((sumSmoothG1 / smoothCount).toFixed(2)) : 0,
    smoothG1DiscontinuitiesCount: smoothDiscontCount,
    cornerMeanTurningAngleDeg: cornerCount > 0 ? Number((sumCornerG1 / cornerCount).toFixed(2)) : 0,
    overallMeanTangencyErrorDeg: totalJunctions > 0 ? Number((sumAllG1 / totalJunctions).toFixed(2)) : 0,
    smoothMeanCurvatureJumpG2: smoothCount > 0 ? Number((sumSmoothG2 / smoothCount).toFixed(4)) : 0,
    cornerMeanCurvatureJumpG2: cornerCount > 0 ? Number((sumCornerG2 / cornerCount).toFixed(4)) : 0,
    overallMeanCurvatureJumpG2: totalJunctions > 0 ? Number((sumAllG2 / totalJunctions).toFixed(4)) : 0,
    totalCurvatureEnergy: Number(totalCurvatureEnergy.toFixed(1)),
  };
}

// ============================================================================
// 4. DIRECT GROUND TRUTH FIDELITY EVALUATOR
// ============================================================================

export interface GroundTruthFidelityReport {
  caseId: string;
  caseName: string;
  areaDriftPercent: number;
  perimeterDriftPercent: number;
  centroidDriftPx: number;
  meanChamferPx: number;
  p95ChamferPx: number;
  hausdorffForegroundPx: number;
  circleRadiusDriftPx?: number;
  ellipseAxisDriftPx?: number;
}

/**
 * Computes polygon area and centroid from sampled boundary points
 */
export function computePolygonProperties(points: Point2D[]): { area: number; perimeter: number; centroid: Point2D } {
  let area = 0;
  let perimeter = 0;
  let cx = 0;
  let cy = 0;

  const n = points.length;
  if (n < 3) return { area: 0, perimeter: 0, centroid: { x: 0, y: 0 } };

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const p1 = points[i];
    const p2 = points[j];

    const cross = p1.x * p2.y - p2.x * p1.y;
    area += cross;
    cx += (p1.x + p2.x) * cross;
    cy += (p1.y + p2.y) * cross;
    perimeter += Math.hypot(p2.x - p1.x, p2.y - p1.y);
  }

  area = Math.abs(area) / 2.0;
  const factor = area > 1e-4 ? 1 / (6 * area) : 0;

  return {
    area,
    perimeter,
    centroid: { x: Math.abs(cx * factor), y: Math.abs(cy * factor) },
  };
}

/**
 * Evaluates comprehensive Ground Truth geometric fidelity
 */
export function evaluateGroundTruthFidelity(
  caseId: string,
  caseName: string,
  candidateSvg: string,
  gtSvg: string
): GroundTruthFidelityReport {
  const candPoints = sampleForegroundBoundaryPoints(candidateSvg);
  const gtPoints = sampleForegroundBoundaryPoints(gtSvg);

  const candProps = computePolygonProperties(candPoints);
  const gtProps = computePolygonProperties(gtPoints);

  const areaDrift = gtProps.area > 0 ? Math.abs(candProps.area - gtProps.area) / gtProps.area : 0;
  const perimDrift = gtProps.perimeter > 0 ? Math.abs(candProps.perimeter - gtProps.perimeter) / gtProps.perimeter : 0;
  const centroidDrift = Math.hypot(candProps.centroid.x - gtProps.centroid.x, candProps.centroid.y - gtProps.centroid.y);

  // Chamfer and Hausdorff
  let sumD = 0;
  const dists: number[] = [];
  let maxCandToGt = 0;
  let maxGtToCand = 0;

  for (const cp of candPoints) {
    let minD = Infinity;
    for (const gp of gtPoints) {
      const d = Math.hypot(cp.x - gp.x, cp.y - gp.y);
      if (d < minD) minD = d;
    }
    if (minD < Infinity) {
      sumD += minD;
      dists.push(minD);
      if (minD > maxCandToGt) maxCandToGt = minD;
    }
  }

  for (const gp of gtPoints) {
    let minD = Infinity;
    for (const cp of candPoints) {
      const d = Math.hypot(gp.x - cp.x, gp.y - cp.y);
      if (d < minD) minD = d;
    }
    if (minD < Infinity) {
      if (minD > maxGtToCand) maxGtToCand = minD;
    }
  }

  dists.sort((a, b) => a - b);
  const meanChamfer = dists.length > 0 ? sumD / dists.length : 0;
  const p95Idx = Math.floor(dists.length * 0.95);
  const p95Chamfer = dists.length > 0 ? dists[Math.min(dists.length - 1, p95Idx)] : 0;
  const hausdorff = Math.max(maxCandToGt, maxGtToCand);

  return {
    caseId,
    caseName,
    areaDriftPercent: Number((areaDrift * 100).toFixed(2)),
    perimeterDriftPercent: Number((perimDrift * 100).toFixed(2)),
    centroidDriftPx: Number(centroidDrift.toFixed(2)),
    meanChamferPx: Number(meanChamfer.toFixed(3)),
    p95ChamferPx: Number(p95Chamfer.toFixed(3)),
    hausdorffForegroundPx: Number(hausdorff.toFixed(3)),
  };
}
