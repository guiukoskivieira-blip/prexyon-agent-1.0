import type { SnapshotEdge, SnapshotRegion } from './baselineSnapshot';

export type RegionClassification = 'STRUCTURAL_REGION' | 'ANTIALIAS_SUPPORT_REGION' | 'LEGITIMATE_SMALL_DETAIL' | 'UNCERTAIN';

export interface StructuralPrototype { id: number; color: SnapshotRegion['meanOklab']; }
export interface RegionAntialiasInput {
  regions: SnapshotRegion[];
  edges: SnapshotEdge[];
  structuralRegionIds: number[];
  prototypes: StructuralPrototype[];
}
export interface RegionAntialiasClassification {
  byRegionId: Map<number, RegionClassification>;
  antialiasSupportRegionIds: number[];
  legitimateSmallDetailIds: number[];
  uncertainRegionIds: number[];
}

function distance(first: SnapshotRegion['meanOklab'], second: SnapshotRegion['meanOklab']): number {
  return Math.hypot(first.l - second.l, first.a - second.a, first.b - second.b);
}

function isThin(region: SnapshotRegion): boolean {
  const width = region.bounds.maxX - region.bounds.minX + 1;
  const height = region.bounds.maxY - region.bounds.minY + 1;
  return Math.min(width, height) / Math.max(width, height) <= 0.45;
}

function liesBetween(color: SnapshotRegion['meanOklab'], first: StructuralPrototype, second: StructuralPrototype): boolean {
  const vx = second.color.l - first.color.l;
  const vy = second.color.a - first.color.a;
  const vz = second.color.b - first.color.b;
  const lengthSquared = vx * vx + vy * vy + vz * vz;
  if (lengthSquared === 0) return false;
  const projection = ((color.l - first.color.l) * vx + (color.a - first.color.a) * vy + (color.b - first.color.b) * vz) / lengthSquared;
  if (projection <= 0.03 || projection >= 0.97) return false;
  const closest = { l: first.color.l + projection * vx, a: first.color.a + projection * vy, b: first.color.b + projection * vz };
  return distance(color, closest) <= 0.08;
}

export function classifyRegionAntialias(input: RegionAntialiasInput): RegionAntialiasClassification {
  const byId = new Map(input.regions.map((region) => [region.id, region]));
  const structural = new Set(input.structuralRegionIds);
  const nearestPrototype = (region: SnapshotRegion): StructuralPrototype | undefined => [...input.prototypes].sort((first, second) => distance(region.meanOklab, first.color) - distance(region.meanOklab, second.color) || first.id - second.id)[0];
  const structuralPrototypeByRegion = new Map<number, StructuralPrototype>();
  for (const regionId of structural) {
    const region = byId.get(regionId);
    const prototype = region && nearestPrototype(region);
    if (prototype) structuralPrototypeByRegion.set(regionId, prototype);
  }
  const adjacency = new Map<number, SnapshotEdge[]>();
  for (const edge of input.edges) {
    const first = adjacency.get(edge.regionA) ?? []; first.push(edge); adjacency.set(edge.regionA, first);
    const second = adjacency.get(edge.regionB) ?? []; second.push(edge); adjacency.set(edge.regionB, second);
  }
  const result = new Map<number, RegionClassification>();
  for (const region of input.regions) {
    if (!structural.has(region.id)) { result.set(region.id, 'UNCERTAIN'); continue; }
    const incident = adjacency.get(region.id) ?? [];
    const neighbours = incident.map((edge) => edge.regionA === region.id ? edge.regionB : edge.regionA).filter((id) => structural.has(id));
    const neighbourRegions = neighbours.map((id) => byId.get(id)).filter((item): item is SnapshotRegion => item !== undefined);
    const largestNeighbour = Math.max(0, ...neighbourRegions.map((item) => item.area));
    const isSmall = region.area <= Math.max(8, largestNeighbour * 0.15);
    const structuralEdges = incident.filter((edge) => structural.has(edge.regionA === region.id ? edge.regionB : edge.regionA));
    const hasStrongBoundary = structuralEdges.length > 0 && structuralEdges.every((edge) => edge.averageBoundaryStrength >= 0.45);
    const prototypesById = new Map<number, StructuralPrototype>();
    for (const neighbour of neighbours) {
      const prototype = structuralPrototypeByRegion.get(neighbour);
      if (prototype) prototypesById.set(prototype.id, prototype);
    }
    const neighbourPrototypes = [...prototypesById.values()];
    const bridgingPair = neighbourPrototypes.some((first, firstIndex) => neighbourPrototypes.slice(firstIndex + 1).some((second) => liesBetween(region.meanOklab, first, second)));
    if (hasStrongBoundary && isSmall && isThin(region)) result.set(region.id, 'UNCERTAIN');
    else if (isSmall && isThin(region) && bridgingPair) result.set(region.id, 'ANTIALIAS_SUPPORT_REGION');
    else if (isSmall && bridgingPair) result.set(region.id, 'UNCERTAIN');
    else if (isSmall) result.set(region.id, 'LEGITIMATE_SMALL_DETAIL');
    else result.set(region.id, 'STRUCTURAL_REGION');
  }
  const ids = (kind: RegionClassification) => [...result].filter(([, value]) => value === kind).map(([id]) => id).sort((first, second) => first - second);
  return { byRegionId: result, antialiasSupportRegionIds: ids('ANTIALIAS_SUPPORT_REGION'), legitimateSmallDetailIds: ids('LEGITIMATE_SMALL_DETAIL'), uncertainRegionIds: ids('UNCERTAIN') };
}
