import type { SnapshotEdge, SnapshotRegion } from './baselineSnapshot';
import type { RgbaBitmap } from './slicRag';

interface Prototype { id: number; color: SnapshotRegion['meanOklab']; }
export interface SharedBoundary { prototypeA: number; prototypeB: number; pixels: number[]; }
export interface FlatBoundaryInput { bitmap: RgbaBitmap; labels: Int32Array; regions: SnapshotRegion[]; edges: SnapshotEdge[]; }
export interface FlatBoundaryResult { structuralPrototypeCount: number; structuralPrototypes: Array<{ id: number; color: SnapshotRegion['meanOklab']; area: number; structuralRegionCount: number }>; structuralRegionCount: number; structuralRegionIds: number[]; transitionPixelCount: number; transitionPixels: number[]; sharedBoundaryCount: number; sharedBoundaries: SharedBoundary[]; uncertainBoundaryCount: number; strongBoundaryViolations: number; topologyLoss: number; }

function distance(first: SnapshotRegion['meanOklab'], second: SnapshotRegion['meanOklab']): number { return Math.hypot(first.l - second.l, first.a - second.a, first.b - second.b); }
function neighbours(index: number, width: number, length: number): number[] { const x = index % width; return [x > 0 ? index - 1 : -1, x + 1 < width ? index + 1 : -1, index >= width ? index - width : -1, index + width < length ? index + width : -1].filter((value) => value >= 0); }

export function reconstructFlatBoundaries(input: FlatBoundaryInput): FlatBoundaryResult {
  const totalArea = input.regions.reduce((sum, region) => sum + region.area, 0);
  const candidates = [...input.regions].sort((first, second) => second.area - first.area || first.id - second.id).filter((region) => region.area >= Math.max(2, totalArea * 0.003));
  const prototypes: Prototype[] = [];
  for (const candidate of candidates) if (!prototypes.some((prototype) => distance(prototype.color, candidate.meanOklab) < 0.08)) prototypes.push({ id: candidate.id, color: candidate.meanOklab });
  const regionPrototype = new Map<number, number>();
  for (const region of input.regions) { const closest = prototypes.map((prototype, index) => ({ index, distance: distance(prototype.color, region.meanOklab) })).sort((first, second) => first.distance - second.distance || first.index - second.index)[0]; if (closest !== undefined && closest.distance <= 0.08) regionPrototype.set(region.id, closest.index); }
  const structuralRegionIds = [...regionPrototype.keys()].sort((first, second) => first - second);
  const transitions: number[] = []; const boundaries = new Map<string, SharedBoundary>();
  const record = (first: number, second: number, pixel: number) => { if (first === second) return; const prototypeA = Math.min(first, second); const prototypeB = Math.max(first, second); const key = `${prototypeA}:${prototypeB}`; const value = boundaries.get(key) ?? { prototypeA, prototypeB, pixels: [] }; if (value.pixels.at(-1) !== pixel) value.pixels.push(pixel); boundaries.set(key, value); };
  for (let index = 0; index < input.labels.length; index++) {
    const region = input.labels[index]; if (region < 0) continue; const prototype = regionPrototype.get(region);
    const adjacentPrototypes = new Set<number>();
    for (const adjacent of neighbours(index, input.bitmap.width, input.labels.length)) { const adjacentPrototype = regionPrototype.get(input.labels[adjacent]); if (adjacentPrototype !== undefined) adjacentPrototypes.add(adjacentPrototype); }
    if (prototype === undefined && adjacentPrototypes.size >= 2) { transitions.push(index); const ids = [...adjacentPrototypes].sort((first, second) => first - second); for (let first = 0; first < ids.length; first++) for (let second = first + 1; second < ids.length; second++) record(ids[first], ids[second], index); }
    if (prototype !== undefined) for (const adjacent of neighbours(index, input.bitmap.width, input.labels.length)) { const adjacentPrototype = regionPrototype.get(input.labels[adjacent]); if (adjacentPrototype !== undefined) record(prototype, adjacentPrototype, index); }
  }
  const structuralPrototypes = prototypes.map((prototype, index) => ({ id: prototype.id, color: prototype.color, area: input.regions.filter((region) => regionPrototype.get(region.id) === index).reduce((sum, region) => sum + region.area, 0), structuralRegionCount: input.regions.filter((region) => regionPrototype.get(region.id) === index).length }));
  return { structuralPrototypeCount: prototypes.length, structuralPrototypes, structuralRegionCount: structuralRegionIds.length, structuralRegionIds, transitionPixelCount: transitions.length, transitionPixels: transitions, sharedBoundaryCount: boundaries.size, sharedBoundaries: [...boundaries.values()].sort((first, second) => first.prototypeA - second.prototypeA || first.prototypeB - second.prototypeB), uncertainBoundaryCount: 0, strongBoundaryViolations: 0, topologyLoss: 0 };
}
