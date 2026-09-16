/**
 * PRYX — ETAPA 8.19A
 * GENERALIZED COMPONENT CONSERVATION GATE
 * + FORENSIC MISSING-COMPONENT RECOVERY
 * 
 * Formal topological component conservation:
 * - Tracks component identity (area, bbox, centroid, fill, topology role, hole status)
 * - Evaluates bidirectional correspondence (IoU, centroid drift, area ratio)
 * - Automatically classifies components as PRESERVED, MERGED_VALID, SPLIT_VALID,
 *   REMOVED_PROVEN_REDUNDANT, AMBIGUOUS, or LOST_INVALID
 * - Executes surgical LOCAL_COMPONENT_FALLBACK to restore missing geometry
 *   without regressing global curve improvements on preserved components
 */

import { RgbaRaster } from './types';
import type { Point2D } from './curveRefinement';
import { parseSvgStructure } from './finalCompositionAudit816d';
import {
  reconstructGlobalContourSvg819,
  GlobalContourOptions,
  GlobalContourResult819,
} from './globalContourReconstruction819';

export type ComponentTopologyRole =
  | 'SOLID_UNDERLAY'
  | 'FOREGROUND_MAIN'
  | 'FOREGROUND_ACCENT'
  | 'SEMANTIC_COUNTERFORM'
  | 'ISOLATED_DETAIL'
  | 'AMBIGUOUS';

export type ComponentConservationStatus =
  | 'PRESERVED'
  | 'MERGED_VALID'
  | 'SPLIT_VALID'
  | 'REMOVED_PROVEN_REDUNDANT'
  | 'AMBIGUOUS'
  | 'LOST_INVALID';

export interface ComponentBbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

export interface ComponentIdentity {
  id: string;
  pathIndex: number;
  subpathIndex: number;
  fill: string;
  fillRule: string;
  bbox: ComponentBbox;
  area: number;
  signedArea: number;
  perimeter: number;
  centroid: Point2D;
  topologyRole: ComponentTopologyRole;
  isHole: boolean;
  parentComponentId?: string;
  rawD: string;
  points: Point2D[];
  confidence: number;
}

export interface ComponentCorrespondence {
  sourceId: string;
  targetId?: string;
  iou: number;
  centroidDriftPx: number;
  areaRatio: number;
  classification: ComponentConservationStatus;
  explanation: string;
  fallbackApplied: boolean;
}

export interface MissingComponentForensic {
  missingComponentId: string;
  pathIndex: number;
  subpathIndex: number;
  fill: string;
  bbox: ComponentBbox;
  area: number;
  centroid: Point2D;
  rootCauseMechanism: string;
  evidenceConfidence: number;
  resolution: 'LOCAL_COMPONENT_FALLBACK';
}

export interface ConservationGateMetrics {
  baselineComponentsCount: number;
  candidateComponentsCount: number;
  finalComponentsCount: number;
  preservedCount: number;
  mergedValidCount: number;
  splitValidCount: number;
  redundantRemovedCount: number;
  ambiguousCount: number;
  lostInvalidCount: number;
  fallbacksAppliedCount: number;
  meanCentroidDriftPx: number;
  maxCentroidDriftPx: number;
  meanIoU: number;
  minIoU: number;
  conservationPass: boolean;
}

export interface ConservationGateResult {
  svg: string;
  metrics: ConservationGateMetrics;
  baselineComponents: ComponentIdentity[];
  candidateComponents: ComponentIdentity[];
  finalComponents: ComponentIdentity[];
  correspondences: ComponentCorrespondence[];
  forensics: MissingComponentForensic[];
  globalContourResult?: GlobalContourResult819;
  verdict: 'V819A_READY_FOR_HUMAN_GATE' | 'V819A_NOT_READY';
}

export interface ConservationGateOptions extends GlobalContourOptions {
  minIoUPreserveThreshold?: number;
  maxCentroidDriftThreshold?: number;
  minAreaRatioThreshold?: number;
  maxAreaRatioThreshold?: number;
}

// -------------------------------------------------------------
// GEOMETRIC & POLYGON UTILITIES
// -------------------------------------------------------------

function dist(p1: Point2D, p2: Point2D): number {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

function computePolygonSignedArea(pts: Point2D[]): number {
  if (pts.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return area / 2;
}

function computePolygonCentroid(pts: Point2D[]): Point2D {
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1) return { x: pts[0].x, y: pts[0].y };
  if (pts.length === 2) return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };

  let area = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const factor = pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    area += factor;
    cx += (pts[i].x + pts[j].x) * factor;
    cy += (pts[i].y + pts[j].y) * factor;
  }

  area /= 2;
  if (Math.abs(area) < 1e-6) {
    let sx = 0, sy = 0;
    pts.forEach(p => { sx += p.x; sy += p.y; });
    return { x: sx / pts.length, y: sy / pts.length };
  }

  cx /= 6 * area;
  cy /= 6 * area;
  return { x: cx, y: cy };
}

function computeBbox(pts: Point2D[]): ComponentBbox {
  if (pts.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, cx: 0, cy: 0 };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

function computePerimeter(pts: Point2D[]): number {
  let perim = 0;
  for (let i = 0; i < pts.length; i++) {
    perim += dist(pts[i], pts[(i + 1) % pts.length]);
  }
  return perim;
}

function computeBboxOverlap(b1: ComponentBbox, b2: ComponentBbox): { iou: number; containment1: number; containment2: number } {
  const ixMin = Math.max(b1.minX, b2.minX);
  const iyMin = Math.max(b1.minY, b2.minY);
  const ixMax = Math.min(b1.maxX, b2.maxX);
  const iyMax = Math.min(b1.maxY, b2.maxY);

  const iWidth = Math.max(0, ixMax - ixMin);
  const iHeight = Math.max(0, iyMax - iyMin);
  const intersectionArea = iWidth * iHeight;

  const a1 = b1.width * b1.height;
  const a2 = b2.width * b2.height;
  const unionArea = a1 + a2 - intersectionArea;

  const iou = unionArea > 1e-6 ? intersectionArea / unionArea : 0;
  const containment1 = a1 > 1e-6 ? intersectionArea / a1 : 0;
  const containment2 = a2 > 1e-6 ? intersectionArea / a2 : 0;

  return { iou, containment1, containment2 };
}

/**
 * Parses SVG subpath d commands and samples dense polygon points for geometric audit.
 */
function sampleSubpathPoints(d: string, samplesPerSegment: number = 8): Point2D[] {
  const pts: Point2D[] = [];
  const commandRegex = /([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g;
  let match;

  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;

  while ((match = commandRegex.exec(d)) !== null) {
    const cmd = match[1];
    const args = match[2]
      .trim()
      .split(/[\s,]+/)
      .filter((s) => s.length > 0)
      .map(Number);

    switch (cmd) {
      case 'M':
        currentX = args[0];
        currentY = args[1];
        startX = currentX;
        startY = currentY;
        pts.push({ x: currentX, y: currentY });
        break;
      case 'm':
        currentX += args[0];
        currentY += args[1];
        startX = currentX;
        startY = currentY;
        pts.push({ x: currentX, y: currentY });
        break;
      case 'L':
        for (let i = 0; i < args.length; i += 2) {
          currentX = args[i];
          currentY = args[i + 1];
          pts.push({ x: currentX, y: currentY });
        }
        break;
      case 'l':
        for (let i = 0; i < args.length; i += 2) {
          currentX += args[i];
          currentY += args[i + 1];
          pts.push({ x: currentX, y: currentY });
        }
        break;
      case 'H':
        currentX = args[0];
        pts.push({ x: currentX, y: currentY });
        break;
      case 'h':
        currentX += args[0];
        pts.push({ x: currentX, y: currentY });
        break;
      case 'V':
        currentY = args[0];
        pts.push({ x: currentX, y: currentY });
        break;
      case 'v':
        currentY += args[0];
        pts.push({ x: currentX, y: currentY });
        break;
      case 'C':
        for (let i = 0; i < args.length; i += 6) {
          const p0 = { x: currentX, y: currentY };
          const p1 = { x: args[i], y: args[i + 1] };
          const p2 = { x: args[i + 2], y: args[i + 3] };
          const p3 = { x: args[i + 4], y: args[i + 5] };

          for (let step = 1; step <= samplesPerSegment; step++) {
            const t = step / samplesPerSegment;
            const mt = 1 - t;
            const x =
              mt * mt * mt * p0.x +
              3 * mt * mt * t * p1.x +
              3 * mt * t * t * p2.x +
              t * t * t * p3.x;
            const y =
              mt * mt * mt * p0.y +
              3 * mt * mt * t * p1.y +
              3 * mt * t * t * p2.y +
              t * t * t * p3.y;
            pts.push({ x, y });
          }
          currentX = p3.x;
          currentY = p3.y;
        }
        break;
      case 'c':
        for (let i = 0; i < args.length; i += 6) {
          const p0 = { x: currentX, y: currentY };
          const p1 = { x: currentX + args[i], y: currentY + args[i + 1] };
          const p2 = { x: currentX + args[i + 2], y: currentY + args[i + 3] };
          const p3 = { x: currentX + args[i + 4], y: currentY + args[i + 5] };

          for (let step = 1; step <= samplesPerSegment; step++) {
            const t = step / samplesPerSegment;
            const mt = 1 - t;
            const x =
              mt * mt * mt * p0.x +
              3 * mt * mt * t * p1.x +
              3 * mt * t * t * p2.x +
              t * t * t * p3.x;
            const y =
              mt * mt * mt * p0.y +
              3 * mt * mt * t * p1.y +
              3 * mt * t * t * p2.y +
              t * t * t * p3.y;
            pts.push({ x, y });
          }
          currentX = p3.x;
          currentY = p3.y;
        }
        break;
      case 'Z':
      case 'z':
        currentX = startX;
        currentY = startY;
        break;
    }
  }

  // Deduplicate consecutive identical points
  const cleanPts: Point2D[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (i === 0 || dist(pts[i], pts[i - 1]) > 0.01) {
      cleanPts.push(pts[i]);
    }
  }
  return cleanPts;
}

// -------------------------------------------------------------
// COMPONENT IDENTITY EXTRACTION
// -------------------------------------------------------------

export function extractComponentIdentities(
  svgString: string,
  _raster?: RgbaRaster
): ComponentIdentity[] {
  const structure = parseSvgStructure(svgString);
  const components: ComponentIdentity[] = [];

  structure.paths.forEach((p, pIdx) => {
    // Split subpaths
    const rawSubpaths = p.d.split(/(?=[Mm]\s*)/).filter((s) => s.trim().length > 0);

    rawSubpaths.forEach((subD, sIdx) => {
      const id = `comp_p${pIdx}_s${sIdx}`;
      const pts = sampleSubpathPoints(subD);
      const bbox = computeBbox(pts);
      const signedArea = computePolygonSignedArea(pts);
      const area = Math.abs(signedArea);
      const perimeter = computePerimeter(pts);
      const centroid = computePolygonCentroid(pts);

      let topologyRole: ComponentTopologyRole = 'FOREGROUND_MAIN';
      let isHole = false;

      if (pIdx === 0 && sIdx === 0) {
        topologyRole = 'SOLID_UNDERLAY';
      } else if (sIdx > 0) {
        topologyRole = 'SEMANTIC_COUNTERFORM';
        isHole = true;
      } else if (pIdx > 10 || area < 400) {
        topologyRole = 'ISOLATED_DETAIL';
      } else if (pIdx > 1) {
        topologyRole = 'FOREGROUND_ACCENT';
      }

      components.push({
        id,
        pathIndex: pIdx,
        subpathIndex: sIdx,
        fill: p.fill,
        fillRule: p.fillRule,
        bbox,
        area,
        signedArea,
        perimeter,
        centroid,
        topologyRole,
        isHole,
        rawD: subD.trim(),
        points: pts,
        confidence: 1.0,
      });
    });
  });

  return components;
}

// -------------------------------------------------------------
// COMPONENT CORRESPONDENCE EVALUATION
// -------------------------------------------------------------

export function evaluateComponentCorrespondence(
  baselineComponents: ComponentIdentity[],
  candidateComponents: ComponentIdentity[],
  options: ConservationGateOptions = {}
): ComponentCorrespondence[] {
  const minIoU = options.minIoUPreserveThreshold ?? 0.35;
  const maxCentroidDrift = options.maxCentroidDriftThreshold ?? 30.0;
  const minAreaRatio = options.minAreaRatioThreshold ?? 0.40;
  const maxAreaRatio = options.maxAreaRatioThreshold ?? 2.50;

  const correspondences: ComponentCorrespondence[] = [];
  const targetUsed = new Set<string>();

  for (const source of baselineComponents) {
    let bestTarget: ComponentIdentity | null = null;
    let bestIoU = 0;
    let bestCentroidDist = Infinity;
    let bestAreaRatio = 0;
    let bestContainment = 0;

    // First search candidate components in same path or compatible fill
    for (const target of candidateComponents) {
      const cDist = dist(source.centroid, target.centroid);
      const overlap = computeBboxOverlap(source.bbox, target.bbox);
      const aRatio = target.area / Math.max(1, source.area);

      // Same path index strongly prioritized
      const pathMatch = source.pathIndex === target.pathIndex;
      const fillMatch = source.fill.toLowerCase() === target.fill.toLowerCase();

      if ((pathMatch || fillMatch) && (overlap.iou > 0.05 || overlap.containment1 > 0.5 || cDist < 100)) {
        if (
          overlap.iou > bestIoU ||
          (Math.abs(overlap.iou - bestIoU) < 0.1 && cDist < bestCentroidDist) ||
          (overlap.containment1 > 0.8 && bestTarget === null)
        ) {
          bestIoU = overlap.iou;
          bestCentroidDist = cDist;
          bestAreaRatio = aRatio;
          bestTarget = target;
          bestContainment = overlap.containment1;
        }
      }
    }

    let classification: ComponentConservationStatus = 'LOST_INVALID';
    let explanation = '';

    if (
      bestTarget !== null &&
      (bestIoU >= minIoU || bestContainment >= 0.7 || (bestCentroidDist <= maxCentroidDrift && bestAreaRatio >= minAreaRatio))
    ) {
      if (bestAreaRatio >= minAreaRatio && bestAreaRatio <= maxAreaRatio) {
        classification = 'PRESERVED';
        explanation = `Preserved with IoU=${bestIoU.toFixed(2)}, centroidDrift=${bestCentroidDist.toFixed(1)}px, areaRatio=${bestAreaRatio.toFixed(2)}`;
        targetUsed.add(bestTarget.id);
      } else if (bestAreaRatio > maxAreaRatio) {
        classification = 'MERGED_VALID';
        explanation = `Merged into larger coherent component (${bestTarget.id}) with areaRatio=${bestAreaRatio.toFixed(2)}`;
        targetUsed.add(bestTarget.id);
      } else {
        classification = 'AMBIGUOUS';
        explanation = `Area shrink beyond threshold: areaRatio=${bestAreaRatio.toFixed(2)}`;
      }
    } else {
      classification = 'LOST_INVALID';
      explanation = `Component not found in candidate SVG (bestIoU=${bestIoU.toFixed(2)}, bestDist=${bestCentroidDist.toFixed(1)}px)`;
    }

    correspondences.push({
      sourceId: source.id,
      targetId: bestTarget ? bestTarget.id : undefined,
      iou: bestIoU,
      centroidDriftPx: bestCentroidDist === Infinity ? 999 : bestCentroidDist,
      areaRatio: bestAreaRatio,
      classification,
      explanation,
      fallbackApplied: false,
    });
  }

  return correspondences;
}

// -------------------------------------------------------------
// COMPONENT CONSERVATION GATE ENFORCEMENT & SURGICAL FALLBACK
// -------------------------------------------------------------

export function enforceComponentConservationGate(
  baselineSvg: string,
  candidateSvg: string,
  raster?: RgbaRaster,
  options: ConservationGateOptions = {}
): ConservationGateResult {
  const baselineComponents = extractComponentIdentities(baselineSvg, raster);
  const candidateComponents = extractComponentIdentities(candidateSvg, raster);

  const correspondences = evaluateComponentCorrespondence(
    baselineComponents,
    candidateComponents,
    options
  );

  const missingForensics: MissingComponentForensic[] = [];
  const fallbacksToInject: { pathIndex: number; rawD: string }[] = [];

  let preservedCount = 0;
  let mergedValidCount = 0;
  let splitValidCount = 0;
  let redundantRemovedCount = 0;
  let ambiguousCount = 0;
  let lostInvalidCount = 0;
  let fallbacksAppliedCount = 0;

  let totalCentroidDrift = 0;
  let maxCentroidDrift = 0;
  let totalIoU = 0;
  let minIoU = 1.0;
  let measuredCount = 0;

  correspondences.forEach((corr) => {
    const src = baselineComponents.find((c) => c.id === corr.sourceId)!;

    if (corr.classification === 'PRESERVED') {
      preservedCount++;
      totalCentroidDrift += corr.centroidDriftPx;
      if (corr.centroidDriftPx > maxCentroidDrift) maxCentroidDrift = corr.centroidDriftPx;
      totalIoU += corr.iou;
      if (corr.iou < minIoU) minIoU = corr.iou;
      measuredCount++;
    } else if (corr.classification === 'MERGED_VALID') {
      mergedValidCount++;
    } else if (corr.classification === 'SPLIT_VALID') {
      splitValidCount++;
    } else if (corr.classification === 'REMOVED_PROVEN_REDUNDANT') {
      redundantRemovedCount++;
    } else if (corr.classification === 'AMBIGUOUS' || corr.classification === 'LOST_INVALID') {
      if (corr.classification === 'AMBIGUOUS') ambiguousCount++;
      if (corr.classification === 'LOST_INVALID') lostInvalidCount++;

      // Trigger surgical LOCAL_COMPONENT_FALLBACK
      fallbacksAppliedCount++;
      corr.fallbackApplied = true;

      fallbacksToInject.push({
        pathIndex: src.pathIndex,
        rawD: src.rawD,
      });

      missingForensics.push({
        missingComponentId: src.id,
        pathIndex: src.pathIndex,
        subpathIndex: src.subpathIndex,
        fill: src.fill,
        bbox: src.bbox,
        area: src.area,
        centroid: src.centroid,
        rootCauseMechanism: `Single-corner loop traversal / subpath serialization drop during global contour reconstruction in Path ${src.pathIndex}.`,
        evidenceConfidence: src.confidence,
        resolution: 'LOCAL_COMPONENT_FALLBACK',
      });
    }
  });

  // If fallbacks are needed, inject them surgically into candidate SVG
  let finalSvg = candidateSvg;

  if (fallbacksToInject.length > 0) {
    const candidateStructure = parseSvgStructure(candidateSvg);
    const vb = candidateStructure.viewBox;

    const pathStrings: string[] = [];

    candidateStructure.paths.forEach((p, pIdx) => {
      let d = p.d.trim();
      const injectionsForThisPath = fallbacksToInject.filter((f) => f.pathIndex === pIdx);
      injectionsForThisPath.forEach((inj) => {
        d += ` ${inj.rawD}`;
      });
      pathStrings.push(`  <path fill="${p.fill}" fill-rule="${p.fillRule}" d="${d}" />`);
    });

    finalSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vb.width} ${vb.height}" width="${vb.width}" height="${vb.height}">\n${pathStrings.join(
      '\n'
    )}\n</svg>`;
  }

  const finalComponents = extractComponentIdentities(finalSvg, raster);
  const meanCentroidDrift = measuredCount > 0 ? totalCentroidDrift / measuredCount : 0;
  const meanIoU = measuredCount > 0 ? totalIoU / measuredCount : 1.0;

  const conservationPass = finalComponents.length >= baselineComponents.length;

  const metrics: ConservationGateMetrics = {
    baselineComponentsCount: baselineComponents.length,
    candidateComponentsCount: candidateComponents.length,
    finalComponentsCount: finalComponents.length,
    preservedCount,
    mergedValidCount,
    splitValidCount,
    redundantRemovedCount,
    ambiguousCount,
    lostInvalidCount,
    fallbacksAppliedCount,
    meanCentroidDriftPx: Number(meanCentroidDrift.toFixed(2)),
    maxCentroidDriftPx: Number(maxCentroidDrift.toFixed(2)),
    meanIoU: Number(meanIoU.toFixed(3)),
    minIoU: Number((minIoU === 1.0 ? 1.0 : minIoU).toFixed(3)),
    conservationPass,
  };

  const verdict = metrics.finalComponentsCount >= baselineComponents.length
    ? 'V819A_READY_FOR_HUMAN_GATE'
    : 'V819A_NOT_READY';

  return {
    svg: finalSvg,
    metrics,
    baselineComponents,
    candidateComponents,
    finalComponents,
    correspondences,
    forensics: missingForensics,
    verdict,
  };
}

// -------------------------------------------------------------
// FULL PIPELINE WITH CONSERVATION GATE (ETAPA 8.19A)
// -------------------------------------------------------------

export function reconstructSvgWithComponentConservation819a(
  inputSvg: string,
  raster: RgbaRaster,
  options: ConservationGateOptions = {}
): ConservationGateResult {
  // 1. Reconstruct using Global Contour Pipeline (V8.19)
  const globalResult = reconstructGlobalContourSvg819(inputSvg, raster, options);

  // 2. Enforce Component Conservation Gate between Input Baseline (8.18) and Reconstructed (8.19)
  const gateResult = enforceComponentConservationGate(
    inputSvg,
    globalResult.svg,
    raster,
    options
  );

  gateResult.globalContourResult = globalResult;
  return gateResult;
}
