/**
 * PRYX — ETAPA 8.12
 * TOPOLOGY-FIRST VECTOR RECONSTRUCTION FOUNDATION
 * 
 * Explicit Planar Region Map, Contour Hierarchy, Shared Boundaries,
 * and Topology Lock Gate.
 */

import { parseSvgString } from '../vectorizer/svgParser';
import type { Point2D } from './curveRefinement';
import { computeLoopProperties } from './professionalCurveReconstruction';

function dist(p1: Point2D, p2: Point2D): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
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

export interface RegionNode {
  id: string;
  fill: string;
  area: number;
  signedArea: number;
  centroid: Point2D;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  parentRegionId: string | null;
  childRegionIds: string[];
  adjacentRegionIds: string[];
  outerBoundary: Point2D[];
  holes: Point2D[][];
  nestingDepth: number;
  winding: 'CW' | 'CCW';
}

export interface SharedBoundary {
  id: string;
  regionAId: string;
  regionBId: string | null;
  samples: Point2D[];
  isClosed: boolean;
  orientation: 'forward' | 'reverse';
  length: number;
}

export interface ContourHierarchy {
  rootRegionIds: string[];
  allRegions: Map<string, RegionNode>;
  sharedBoundaries: Map<string, SharedBoundary>;
  adjacencyGraph: Map<string, Set<string>>;
  totalComponents: number;
  totalHoles: number;
  maxNestingDepth: number;
}

export interface TopologySignature {
  componentCount: number;
  holeCount: number;
  maxNestingDepth: number;
  adjacencyEdgeCount: number;
  holesPerRegion: Map<string, number>;
  containmentTree: Map<string, string[]>;
  windingMap: Map<string, 'CW' | 'CCW'>;
}

export interface TopologyValidationResult {
  isValid: boolean;
  violations: string[];
  transformationsTested: number;
  accepted: number;
  rejected: number;
  holeCollapsesPrevented: number;
  adjacencyViolationsPrevented: number;
  topologicalError: number;
}

function parseSubpathPoints(subStr: string): Point2D[] {
  const cmdRegex = /([MmLlCcZz])([^MmLlCcZz]*)/g;
  let m: RegExpExecArray | null;
  const pts: Point2D[] = [];
  let curr = { x: 0, y: 0 };

  while ((m = cmdRegex.exec(subStr)) !== null) {
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

  return pts;
}

/**
 * Point in polygon test using ray casting.
 */
export function isPointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;

    const intersect = yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || 1e-6) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Tests if polygon A geometrically contains polygon B.
 */
export function polygonContainsPolygon(polyA: Point2D[], polyB: Point2D[]): boolean {
  if (polyA.length < 3 || polyB.length < 3) return false;
  // Test multiple sample points of B inside A
  const samples = [
    polyB[0],
    polyB[Math.floor(polyB.length / 4)],
    polyB[Math.floor(polyB.length / 2)],
    polyB[Math.floor((3 * polyB.length) / 4)],
  ];
  let insideCount = 0;
  for (const pt of samples) {
    if (isPointInPolygon(pt, polyA)) insideCount++;
  }
  return insideCount >= 3;
}

/**
 * Constructs explicit Planar Region Map and Contour Hierarchy from an SVG string.
 */
export function buildPlanarRegionMapFromSvg(svgString: string): ContourHierarchy {
  const parsed = parseSvgString(svgString);
  const allRegions = new Map<string, RegionNode>();
  const adjacencyGraph = new Map<string, Set<string>>();
  const sharedBoundaries = new Map<string, SharedBoundary>();

  let regionCounter = 0;
  const regionList: RegionNode[] = [];

  for (let pIdx = 0; pIdx < parsed.paths.length; pIdx++) {
    const p = parsed.paths[pIdx];
    const fill = p.fill || '#000000';
    const subpathStrings = (p.d || '').split(/(?=[Mm])/).map((s) => s.trim()).filter(Boolean);
    if (subpathStrings.length === 0) continue;

    // First subpath is outer boundary, subsequent subpaths are holes of this component
    const outerPts = parseSubpathPoints(subpathStrings[0]);
    if (outerPts.length < 3) continue;

    const outerProps = computeLoopProperties(outerPts);
    const holePointsList: Point2D[][] = [];

    for (let h = 1; h < subpathStrings.length; h++) {
      const hPts = parseSubpathPoints(subpathStrings[h]);
      if (hPts.length >= 3) {
        holePointsList.push(hPts);
      }
    }

    const regionId = `region_${++regionCounter}`;
    const node: RegionNode = {
      id: regionId,
      fill,
      area: outerProps.area,
      signedArea: outerProps.signedArea,
      centroid: outerProps.centroid,
      bbox: outerProps.bbox,
      parentRegionId: null,
      childRegionIds: [],
      adjacentRegionIds: [],
      outerBoundary: outerPts,
      holes: holePointsList,
      nestingDepth: 0,
      winding: outerProps.signedArea >= 0 ? 'CW' : 'CCW',
    };

    allRegions.set(regionId, node);
    adjacencyGraph.set(regionId, new Set<string>());
    regionList.push(node);
  }

  // 2. Build Nesting / Containment Hierarchy
  for (let i = 0; i < regionList.length; i++) {
    for (let j = 0; j < regionList.length; j++) {
      if (i === j) continue;
      const rA = regionList[i];
      const rB = regionList[j];

      // Check if rA contains rB
      if (rA.area > rB.area && polygonContainsPolygon(rA.outerBoundary, rB.outerBoundary)) {
        // rA is an ancestor of rB
        if (!rB.parentRegionId || allRegions.get(rB.parentRegionId)!.area > rA.area) {
          rB.parentRegionId = rA.id;
        }
      }
    }
  }

  // Set child relationships and compute nesting depth
  const rootRegionIds: string[] = [];
  let maxNestingDepth = 0;
  let totalHoles = 0;

  for (const node of allRegions.values()) {
    totalHoles += node.holes.length;
    if (node.parentRegionId) {
      const parent = allRegions.get(node.parentRegionId);
      if (parent) {
        parent.childRegionIds.push(node.id);
        let depth = 1;
        let curr: RegionNode | undefined = parent;
        while (curr && curr.parentRegionId) {
          depth++;
          curr = allRegions.get(curr.parentRegionId);
        }
        node.nestingDepth = depth;
        if (depth > maxNestingDepth) maxNestingDepth = depth;
      }
    } else {
      rootRegionIds.push(node.id);
    }
  }

  // 3. Extract Shared Boundaries & Adjacencies
  let boundaryCounter = 0;
  for (let i = 0; i < regionList.length; i++) {
    for (let j = i + 1; j < regionList.length; j++) {
      const rA = regionList[i];
      const rB = regionList[j];

      // Check if bounding boxes overlap + tolerance
      const bboxOverlap =
        rA.bbox.minX <= rB.bbox.maxX + 3.0 &&
        rA.bbox.maxX >= rB.bbox.minX - 3.0 &&
        rA.bbox.minY <= rB.bbox.maxY + 3.0 &&
        rA.bbox.maxY >= rB.bbox.minY - 3.0;

      if (!bboxOverlap) continue;

      // Check for shared boundary samples
      const sharedSamples: Point2D[] = [];
      for (const pA of rA.outerBoundary) {
        for (const pB of rB.outerBoundary) {
          if (dist(pA, pB) < 2.5) {
            sharedSamples.push({ x: (pA.x + pB.x) / 2, y: (pA.y + pB.y) / 2 });
            break;
          }
        }
      }

      if (sharedSamples.length >= 2) {
        rA.adjacentRegionIds.push(rB.id);
        rB.adjacentRegionIds.push(rA.id);
        adjacencyGraph.get(rA.id)!.add(rB.id);
        adjacencyGraph.get(rB.id)!.add(rA.id);

        const boundaryId = `boundary_${++boundaryCounter}`;
        sharedBoundaries.set(boundaryId, {
          id: boundaryId,
          regionAId: rA.id,
          regionBId: rB.id,
          samples: sharedSamples,
          isClosed: false,
          orientation: 'forward',
          length: sharedSamples.length,
        });
      }
    }
  }

  return {
    rootRegionIds,
    allRegions,
    sharedBoundaries,
    adjacencyGraph,
    totalComponents: allRegions.size,
    totalHoles,
    maxNestingDepth,
  };
}

/**
 * Computes an immutable Topology Signature for a region hierarchy.
 */
export function computeTopologySignature(hierarchy: ContourHierarchy): TopologySignature {
  let adjacencyEdgeCount = 0;
  for (const neighbors of hierarchy.adjacencyGraph.values()) {
    adjacencyEdgeCount += neighbors.size;
  }
  adjacencyEdgeCount = Math.floor(adjacencyEdgeCount / 2);

  const holesPerRegion = new Map<string, number>();
  const containmentTree = new Map<string, string[]>();
  const windingMap = new Map<string, 'CW' | 'CCW'>();

  for (const [id, r] of hierarchy.allRegions.entries()) {
    holesPerRegion.set(id, r.holes.length);
    containmentTree.set(id, [...r.childRegionIds]);
    windingMap.set(id, r.winding);
  }

  return {
    componentCount: hierarchy.totalComponents,
    holeCount: hierarchy.totalHoles,
    maxNestingDepth: hierarchy.maxNestingDepth,
    adjacencyEdgeCount,
    holesPerRegion,
    containmentTree,
    windingMap,
  };
}

/**
 * Topology Gate: verifies that a candidate reconstructed SVG strictly preserves
 * the topological invariants of the original planar region map.
 */
export function validateTopologyInvariants(
  baselineSig: TopologySignature,
  candidateSig: TopologySignature
): TopologyValidationResult {
  const violations: string[] = [];
  let holeCollapsesPrevented = 0;
  let adjacencyViolationsPrevented = 0;

  if (candidateSig.componentCount !== baselineSig.componentCount) {
    violations.push(
      `Component count mismatch: expected ${baselineSig.componentCount}, received ${candidateSig.componentCount}`
    );
  }

  if (candidateSig.holeCount !== baselineSig.holeCount) {
    const diff = baselineSig.holeCount - candidateSig.holeCount;
    if (diff > 0) holeCollapsesPrevented += diff;
    violations.push(
      `Hole count mismatch: expected ${baselineSig.holeCount}, received ${candidateSig.holeCount}`
    );
  }

  if (candidateSig.maxNestingDepth !== baselineSig.maxNestingDepth) {
    violations.push(
      `Max nesting depth mismatch: expected ${baselineSig.maxNestingDepth}, received ${candidateSig.maxNestingDepth}`
    );
  }

  if (Math.abs(candidateSig.adjacencyEdgeCount - baselineSig.adjacencyEdgeCount) > 2) {
    adjacencyViolationsPrevented++;
    violations.push(
      `Adjacency graph mismatch: baseline edges ${baselineSig.adjacencyEdgeCount} vs candidate ${candidateSig.adjacencyEdgeCount}`
    );
  }

  const isValid = violations.length === 0;
  return {
    isValid,
    violations,
    transformationsTested: 1,
    accepted: isValid ? 1 : 0,
    rejected: isValid ? 0 : 1,
    holeCollapsesPrevented,
    adjacencyViolationsPrevented,
    topologicalError: violations.length,
  };
}
