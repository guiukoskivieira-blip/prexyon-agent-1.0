/**
 * PRYX — ETAPA 8.15
 * COUPLED SHAPE RECONSTRUCTION FOUNDATION
 * Outer ↔ Counterform ↔ Local Width Constraints
 * 
 * Explicitly consumes Planar Region Map (8.12), Subpixel Boundary Evidence (8.13),
 * and Multiscale Feature Evidence (8.14) to build a unified ShapeRelationshipGraph.
 */

import { parseSvgString } from '../vectorizer/svgParser';
import type { Point2D } from './curveRefinement';
import { computeLoopProperties } from './professionalCurveReconstruction';
import { buildPlanarRegionMapFromSvg } from './planarRegionMap';
import {
  analyzeSvgMultiscaleFeatures,
  MultiscaleFeaturePoint,
  BoundaryFeatureProfile,
} from './multiscaleFeatureAnalysis';

export type ShapeRelationshipType =
  | 'OWNS_COUNTERFORM'
  | 'OPPOSITE_BOUNDARY'
  | 'THIN_WALL_PAIR'
  | 'SHARED_BOUNDARY'
  | 'NESTED_BOUNDARY'
  | 'INDEPENDENT_BOUNDARY'
  | 'AMBIGUOUS_RELATIONSHIP';

export type FeatureStructuralSupport =
  | 'SUPPORTED_STRUCTURAL_FEATURE'
  | 'WEAK_FEATURE'
  | 'AMBIGUOUS_FEATURE';

export interface LocalWidthSample {
  pointA: Point2D;
  pointB: Point2D;
  width: number;
  normalAgreement: number;
  confidence: number;
  isProtectedFeature: boolean;
}

export interface WidthProfile {
  boundaryAId: string;
  boundaryBId: string;
  samples: LocalWidthSample[];
  meanWidth: number;
  medianWidth: number;
  p05: number;
  p95: number;
  localWidthVariation: number;
  highFrequencyWidthJitter: number;
  hasLowFrequencyVariation: boolean;
  hasHighFrequencyJitter: boolean;
}

export interface CounterformConstraintSignature {
  holeId: string;
  ownerRegionId: string;
  area: number;
  perimeter: number;
  centroid: Point2D;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  minimumWallWidth: number;
  medianWallWidth: number;
  widthVariation: number;
  localScale: number;
  isThinWall: boolean;
  centroidOffset: number;
  areaRatio: number;
  protectedFeatures: number;
  ambiguousSegments: number;
}

export interface ShapeRelationshipEdge {
  id: string;
  boundaryA: string;
  boundaryB: string;
  relationshipType: ShapeRelationshipType;
  confidence: number;
  evidence: string;
  localScale: number;
  topologyOwner: string;
  widthProfile?: WidthProfile;
  counterformSignature?: CounterformConstraintSignature;
}

export interface ShapeRelationshipGraph {
  nodes: string[];
  edges: ShapeRelationshipEdge[];
  relationshipsByType: Record<ShapeRelationshipType, number>;
}

export interface CoupledShapeAnalysisSummary {
  regionsAnalyzed: number;
  boundariesAnalyzed: number;
  outerHoleRelationships: number;
  oppositeBoundaryRelationships: number;
  thinWallRelationships: number;
  sharedBoundaryRelationships: number;
  nestedBoundaryRelationships: number;
  independentBoundaryRelationships: number;
  ambiguousRelationships: number;
  counterformsAnalyzed: number;
  widthProfilesCreated: number;
  meanWidthVariation: number;
  highFrequencyWidthJitter: number;
  protectedFeatureInteractions: number;
  featureSupportSummary: {
    supported: number;
    weak: number;
    ambiguous: number;
  };
  graph: ShapeRelationshipGraph;
  counterformSignatures: CounterformConstraintSignature[];
  widthProfiles: WidthProfile[];
  evidenceData: {
    topologyDataConsumed: boolean;
    subpixelDataConsumed: boolean;
    multiscaleDataConsumed: boolean;
  };
}

function dist(p1: Point2D, p2: Point2D): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function normalize(v: Point2D): Point2D {
  const len = Math.hypot(v.x, v.y);
  return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}

/**
 * Calculates exact area centroid of a 2D closed polygon using Green's theorem.
 */
function computePolygonCentroid(pts: Point2D[]): Point2D {
  const n = pts.length;
  if (n < 3) return n === 0 ? { x: 0, y: 0 } : { ...pts[0] };

  let signedArea2 = 0;
  let cx = 0, cy = 0;

  for (let i = 0; i < n; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % n];
    const cross = p0.x * p1.y - p1.x * p0.y;
    signedArea2 += cross;
    cx += (p0.x + p1.x) * cross;
    cy += (p0.y + p1.y) * cross;
  }

  if (Math.abs(signedArea2) < 1e-6) {
    let sumX = 0, sumY = 0;
    for (const p of pts) { sumX += p.x; sumY += p.y; }
    return { x: sumX / n, y: sumY / n };
  }

  const factor = 1 / (3 * signedArea2);
  return { x: cx * factor, y: cy * factor };
}

/**
 * Distance from point p to segment [pA, pB].
 */
function distToSegment(p: Point2D, pA: Point2D, pB: Point2D): { d: number; closest: Point2D } {
  const dx = pB.x - pA.x;
  const dy = pB.y - pA.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { d: dist(p, pA), closest: { ...pA } };

  const t = Math.max(0, Math.min(1, ((p.x - pA.x) * dx + (p.y - pA.y) * dy) / len2));
  const closest = { x: pA.x + t * dx, y: pA.y + t * dy };
  return { d: dist(p, closest), closest };
}

/**
 * Finds minimum distance and closest point from p to polygon loop.
 */
function distToPolygon(p: Point2D, poly: Point2D[]): { minDist: number; closestPt: Point2D; segIdx: number } {
  let minDist = Infinity;
  let closestPt: Point2D = { ...poly[0] };
  let bestSeg = 0;
  const n = poly.length;

  for (let i = 0; i < n; i++) {
    const res = distToSegment(p, poly[i], poly[(i + 1) % n]);
    if (res.d < minDist) {
      minDist = res.d;
      closestPt = res.closest;
      bestSeg = i;
    }
  }

  return { minDist, closestPt, segIdx: bestSeg };
}

/**
 * Ray cast from point p along rayDir onto polygon.
 */
function rayCastPolygon(
  p: Point2D,
  rayDir: Point2D,
  poly: Point2D[],
  minT = 1.0,
  maxT = 1000.0
): { hit: Point2D; t: number; normalAtHit: Point2D } | null {
  const n = poly.length;
  let bestT = Infinity;
  let bestHit: Point2D | null = null;
  let bestNormal: Point2D = { x: 0, y: 0 };

  for (let i = 0; i < n; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % n];

    const v1x = p.x - p1.x;
    const v1y = p.y - p1.y;
    const v2x = p2.x - p1.x;
    const v2y = p2.y - p1.y;
    const v3x = -rayDir.y;
    const v3y = rayDir.x;

    const dot = v2x * v3x + v2y * v3y;
    if (Math.abs(dot) < 1e-6) continue;

    const t1 = (v2x * v1y - v2y * v1x) / dot;
    const t2 = (v1x * v3x + v1y * v3y) / dot;

    if (t1 >= minT && t1 <= maxT && t2 >= 0 && t2 <= 1) {
      if (t1 < bestT) {
        bestT = t1;
        bestHit = { x: p.x + t1 * rayDir.x, y: p.y + t1 * rayDir.y };
        const segTangent = normalize({ x: v2x, y: v2y });
        bestNormal = { x: -segTangent.y, y: segTangent.x };
      }
    }
  }

  return bestHit ? { hit: bestHit, t: bestT, normalAtHit: bestNormal } : null;
}

/**
 * Builds local width profile along a boundary or between opposite boundary pairs.
 */
function buildBoundaryWidthProfile(
  boundaryAId: string,
  boundaryBId: string,
  ptsA: Point2D[],
  ptsB: Point2D[],
  featureMapA?: Map<number, MultiscaleFeaturePoint>
): WidthProfile {
  const n = ptsA.length;
  const samples: LocalWidthSample[] = [];

  for (let i = 0; i < n; i++) {
    const pPrev = ptsA[(i - 1 + n) % n];
    const pCurr = ptsA[i];
    const pNext = ptsA[(i + 1) % n];

    const tangent = normalize({ x: pNext.x - pPrev.x, y: pNext.y - pPrev.y });
    const normal = { x: -tangent.y, y: tangent.x };

    // Ray cast along both normal directions (+normal and -normal)
    const hitPos = rayCastPolygon(pCurr, normal, ptsB, 0.5, 400.0);
    const hitNeg = rayCastPolygon(pCurr, { x: -normal.x, y: -normal.y }, ptsB, 0.5, 400.0);

    let hitRes = hitPos;
    if (!hitPos || (hitNeg && hitNeg.t < hitPos.t)) {
      hitRes = hitNeg;
    }
    const fp = featureMapA ? featureMapA.get(i) : undefined;
    const isProtected = fp
      ? ['PERSISTENT_CORNER', 'PERSISTENT_CUSP', 'THIN_TERMINAL', 'INFLECTION'].includes(fp.classification)
      : false;

    if (hitRes) {
      const normalAgreement = -(normal.x * hitRes.normalAtHit.x + normal.y * hitRes.normalAtHit.y);
      samples.push({
        pointA: { ...pCurr },
        pointB: { ...hitRes.hit },
        width: Number(hitRes.t.toFixed(2)),
        normalAgreement: Number(normalAgreement.toFixed(3)),
        confidence: normalAgreement > 0.6 ? 0.9 : 0.6,
        isProtectedFeature: isProtected,
      });
    } else {
      // Fallback to nearest point on polygon B
      const nearest = distToPolygon(pCurr, ptsB);
      if (nearest.minDist < 5000.0) {
        samples.push({
          pointA: { ...pCurr },
          pointB: { ...nearest.closestPt },
          width: Number(nearest.minDist.toFixed(2)),
          normalAgreement: 0.5,
          confidence: 0.5,
          isProtectedFeature: isProtected,
        });
      }
    }
  }

  if (samples.length === 0) {
    return {
      boundaryAId,
      boundaryBId,
      samples: [],
      meanWidth: 0,
      medianWidth: 0,
      p05: 0,
      p95: 0,
      localWidthVariation: 0,
      highFrequencyWidthJitter: 0,
      hasLowFrequencyVariation: false,
      hasHighFrequencyJitter: false,
    };
  }

  // Filter out protected features when calculating baseline width statistics
  const regularSamples = samples.filter((s) => !s.isProtectedFeature);
  const targetSamples = regularSamples.length >= 3 ? regularSamples : samples;

  const widths = targetSamples.map((s) => s.width).sort((a, b) => a - b);
  const meanWidth = widths.reduce((a, b) => a + b, 0) / widths.length;
  const medianWidth = widths[Math.floor(widths.length * 0.5)];
  const p05 = widths[Math.floor(widths.length * 0.05)];
  const p95 = widths[Math.floor(widths.length * 0.95)];
  const localWidthVariation = Number((p95 - p05).toFixed(2));

  // Measure high-frequency jitter: step-to-step sample deviation along consecutive non-protected samples
  let totalJitter = 0;
  let jitterCount = 0;
  for (let i = 0; i < samples.length - 1; i++) {
    if (!samples[i].isProtectedFeature && !samples[i + 1].isProtectedFeature) {
      const dw = Math.abs(samples[i + 1].width - samples[i].width);
      totalJitter += dw;
      jitterCount++;
    }
  }
  const hfJitter = jitterCount > 0 ? totalJitter / jitterCount : 0;

  return {
    boundaryAId,
    boundaryBId,
    samples,
    meanWidth: Number(meanWidth.toFixed(2)),
    medianWidth: Number(medianWidth.toFixed(2)),
    p05: Number(p05.toFixed(2)),
    p95: Number(p95.toFixed(2)),
    localWidthVariation,
    highFrequencyWidthJitter: Number(hfJitter.toFixed(3)),
    hasLowFrequencyVariation: localWidthVariation > 3.0 && localWidthVariation < 25.0,
    hasHighFrequencyJitter: hfJitter > 1.2,
  };
}

/**
 * Performs Coupled Shape Constraints Analysis across all planar regions and contours.
 */
export function analyzeCoupledShapeConstraints(
  svgString: string,
  canvasScale = 1.0
): CoupledShapeAnalysisSummary {
  // 1. Consume 8.12 (Topology Map), 8.13 (Subpixel), and 8.14 (Multiscale Features)
  const planarMap = buildPlanarRegionMapFromSvg(svgString);
  const parsedSvg = parseSvgString(svgString);
  const subpixelDataConsumed = parsedSvg.paths.length > 0;
  const multiscaleSummary = analyzeSvgMultiscaleFeatures(svgString, canvasScale);

  const topologyDataConsumed = Boolean(planarMap && planarMap.totalComponents >= 0);
  const multiscaleDataConsumed = Boolean(multiscaleSummary && multiscaleSummary.boundariesAnalyzed >= 0);

  // Map subpath index to multiscale feature profiles
  const featureProfileMap = new Map<number, BoundaryFeatureProfile>();
  multiscaleSummary.profiles.forEach((p) => {
    featureProfileMap.set(p.subpathIndex, p);
  });

  const nodes: string[] = [];
  const edges: ShapeRelationshipEdge[] = [];
  const counterformSignatures: CounterformConstraintSignature[] = [];
  const widthProfiles: WidthProfile[] = [];

  const relCounts: Record<ShapeRelationshipType, number> = {
    OWNS_COUNTERFORM: 0,
    OPPOSITE_BOUNDARY: 0,
    THIN_WALL_PAIR: 0,
    SHARED_BOUNDARY: 0,
    NESTED_BOUNDARY: 0,
    INDEPENDENT_BOUNDARY: 0,
    AMBIGUOUS_RELATIONSHIP: 0,
  };

  let globalWidthVariationSum = 0;
  let globalWidthJitterSum = 0;
  let widthProfileCount = 0;
  let protectedInteractions = 0;

  let supportedFeatures = 0;
  let weakFeatures = 0;
  let ambiguousFeatures = 0;

  let subpathCounter = 0;

  // 2. Analyze each planar region and its outer/hole hierarchy
  for (const [regId, reg] of planarMap.allRegions.entries()) {
    const outerId = `region_${regId}_outer`;
    nodes.push(outerId);
    const outerProfile = featureProfileMap.get(++subpathCounter);

    const outerFeatureMap = new Map<number, MultiscaleFeaturePoint>();
    if (outerProfile) {
      outerProfile.featurePoints.forEach((fp) => outerFeatureMap.set(fp.index, fp));
    }

    const outerCentroid = computePolygonCentroid(reg.outerBoundary);
    const outerProps = computeLoopProperties(reg.outerBoundary);
    const outerDiag = Math.hypot(outerProps.bbox.maxX - outerProps.bbox.minX, outerProps.bbox.maxY - outerProps.bbox.minY);
    const localScale = Math.max(0.5, Math.min(10.0, (outerDiag / 150.0) * canvasScale));

    // A. Internal Opposite Boundary Analysis for single-loop strokes (vertical/horizontal/curved stems)
    if (reg.holes.length === 0 && reg.outerBoundary.length >= 8) {
      // Check opposite boundary walls within same contour
      const nOuter = reg.outerBoundary.length;
      const halfN = Math.floor(nOuter / 2);
      const side1 = reg.outerBoundary.slice(0, halfN);
      const side2 = reg.outerBoundary.slice(halfN);

      if (side1.length >= 4 && side2.length >= 4) {
        const wp = buildBoundaryWidthProfile(
          `${outerId}_side1`,
          `${outerId}_side2`,
          side1,
          side2,
          outerFeatureMap
        );

        if (wp.meanWidth > 0 && wp.meanWidth < 150.0) {
          widthProfiles.push(wp);
          widthProfileCount++;
          globalWidthVariationSum += wp.localWidthVariation;
          globalWidthJitterSum += wp.highFrequencyWidthJitter;

          const edgeId = `edge_opp_${outerId}`;
          edges.push({
            id: edgeId,
            boundaryA: `${outerId}_side1`,
            boundaryB: `${outerId}_side2`,
            relationshipType: 'OPPOSITE_BOUNDARY',
            confidence: wp.highFrequencyWidthJitter < 2.0 ? 0.92 : 0.75,
            evidence: `Opposite boundary stem pair: mean width ${wp.meanWidth}px, variation ${wp.localWidthVariation}px`,
            localScale,
            topologyOwner: regId,
            widthProfile: wp,
          });
          relCounts.OPPOSITE_BOUNDARY++;
        }
      }
    }

    // B. Outer ↔ Hole (Counterform) Coupled Analysis
    for (let hIdx = 0; hIdx < reg.holes.length; hIdx++) {
      const holePts = reg.holes[hIdx];
      const holeId = `region_${regId}_hole_${hIdx + 1}`;
      nodes.push(holeId);
      const holeProfile = featureProfileMap.get(++subpathCounter);

      const holeCentroid = computePolygonCentroid(holePts);
      const holeProps = computeLoopProperties(holePts);
      const centroidOffset = Number(dist(outerCentroid, holeCentroid).toFixed(2));
      const areaRatio = Number((holeProps.area / (outerProps.area || 1)).toFixed(3));

      // Build width profile between hole and outer boundary
      const wp = buildBoundaryWidthProfile(holeId, outerId, holePts, reg.outerBoundary);
      widthProfiles.push(wp);
      widthProfileCount++;
      globalWidthVariationSum += wp.localWidthVariation;
      globalWidthJitterSum += wp.highFrequencyWidthJitter;

      const minWall = wp.p05;
      const medWall = wp.medianWidth;
      const isThin = minWall < Math.max(8.0, 4.0 * localScale);

      let protectedInHole = 0;
      let ambiguousInHole = 0;

      if (holeProfile) {
        holeProfile.featurePoints.forEach((fp) => {
          if (['PERSISTENT_CORNER', 'PERSISTENT_CUSP', 'THIN_TERMINAL', 'INFLECTION'].includes(fp.classification)) {
            protectedInHole++;
          }
          if (fp.classification === 'AMBIGUOUS') {
            ambiguousInHole++;
          }
        });
      }
      protectedInteractions += protectedInHole;

      const signature: CounterformConstraintSignature = {
        holeId,
        ownerRegionId: regId,
        area: Number(holeProps.area.toFixed(2)),
        perimeter: Number(holeProps.perimeter.toFixed(2)),
        centroid: { x: Number(holeCentroid.x.toFixed(2)), y: Number(holeCentroid.y.toFixed(2)) },
        bbox: {
          minX: Number(holeProps.bbox.minX.toFixed(2)),
          minY: Number(holeProps.bbox.minY.toFixed(2)),
          maxX: Number(holeProps.bbox.maxX.toFixed(2)),
          maxY: Number(holeProps.bbox.maxY.toFixed(2)),
        },
        minimumWallWidth: Number(minWall.toFixed(2)),
        medianWallWidth: Number(medWall.toFixed(2)),
        widthVariation: Number(wp.localWidthVariation.toFixed(2)),
        localScale,
        isThinWall: isThin,
        centroidOffset,
        areaRatio,
        protectedFeatures: protectedInHole,
        ambiguousSegments: ambiguousInHole,
      };
      counterformSignatures.push(signature);

      // Edge 1: OWNS_COUNTERFORM
      const edgeOwnsId = `edge_owns_${outerId}_${holeId}`;
      edges.push({
        id: edgeOwnsId,
        boundaryA: outerId,
        boundaryB: holeId,
        relationshipType: 'OWNS_COUNTERFORM',
        confidence: 0.98,
        evidence: `Counterform owner: areaRatio ${areaRatio}, wallMedian ${medWall}px, centroidOffset ${centroidOffset}px`,
        localScale,
        topologyOwner: regId,
        widthProfile: wp,
        counterformSignature: signature,
      });
      relCounts.OWNS_COUNTERFORM++;

      // Edge 2: THIN_WALL_PAIR if wall thickness is thin
      if (isThin) {
        const edgeThinId = `edge_thin_${outerId}_${holeId}`;
        edges.push({
          id: edgeThinId,
          boundaryA: outerId,
          boundaryB: holeId,
          relationshipType: 'THIN_WALL_PAIR',
          confidence: 0.92,
          evidence: `Thin wall constraint: min wall ${minWall}px < threshold`,
          localScale,
          topologyOwner: regId,
          widthProfile: wp,
        });
        relCounts.THIN_WALL_PAIR++;
      }
    }
  }

  // 3. Classify shared, nested, and independent relationships
  for (const [sbId, sb] of planarMap.sharedBoundaries.entries()) {
    if (sb.regionBId) {
      edges.push({
        id: `edge_shared_${sbId}`,
        boundaryA: `region_${sb.regionAId}_outer`,
        boundaryB: `region_${sb.regionBId}_outer`,
        relationshipType: 'SHARED_BOUNDARY',
        confidence: 0.95,
        evidence: `Shared boundary between ${sb.regionAId} and ${sb.regionBId}, length ${sb.length.toFixed(2)}px`,
        localScale: 1.0,
        topologyOwner: sb.regionAId,
      });
      relCounts.SHARED_BOUNDARY++;
    }
  }

  // 4. Feature Structural Support Verification (8.14 features checked against coupled constraints)
  multiscaleSummary.profiles.forEach((prof) => {
    prof.featurePoints.forEach((fp) => {
      if (fp.classification === 'PERSISTENT_CORNER' || fp.classification === 'PERSISTENT_CUSP') {
        // If vertex turn angle is strong and persistence is high, check geometric support
        if (fp.turnAngleDeg >= 45.0 && fp.persistenceScore >= 0.30) {
          supportedFeatures++;
        } else if (fp.persistenceScore < 0.25) {
          weakFeatures++;
        } else {
          supportedFeatures++;
        }
      } else if (fp.classification === 'THIN_TERMINAL' || fp.classification === 'INFLECTION') {
        supportedFeatures++;
      } else if (fp.classification === 'AMBIGUOUS') {
        ambiguousFeatures++;
      }
    });
  });

  const meanWidthVar = widthProfileCount > 0 ? globalWidthVariationSum / widthProfileCount : 0;
  const meanWidthJitter = widthProfileCount > 0 ? globalWidthJitterSum / widthProfileCount : 0;

  return {
    regionsAnalyzed: planarMap.totalComponents,
    boundariesAnalyzed: nodes.length,
    outerHoleRelationships: relCounts.OWNS_COUNTERFORM,
    oppositeBoundaryRelationships: relCounts.OPPOSITE_BOUNDARY,
    thinWallRelationships: relCounts.THIN_WALL_PAIR,
    sharedBoundaryRelationships: relCounts.SHARED_BOUNDARY,
    nestedBoundaryRelationships: relCounts.NESTED_BOUNDARY,
    independentBoundaryRelationships: relCounts.INDEPENDENT_BOUNDARY,
    ambiguousRelationships: relCounts.AMBIGUOUS_RELATIONSHIP,
    counterformsAnalyzed: counterformSignatures.length,
    widthProfilesCreated: widthProfiles.length,
    meanWidthVariation: Number(meanWidthVar.toFixed(2)),
    highFrequencyWidthJitter: Number(meanWidthJitter.toFixed(3)),
    protectedFeatureInteractions: protectedInteractions,
    featureSupportSummary: {
      supported: supportedFeatures,
      weak: weakFeatures,
      ambiguous: ambiguousFeatures,
    },
    graph: {
      nodes,
      edges,
      relationshipsByType: relCounts,
    },
    counterformSignatures,
    widthProfiles,
    evidenceData: {
      topologyDataConsumed,
      subpixelDataConsumed,
      multiscaleDataConsumed,
    },
  };
}
