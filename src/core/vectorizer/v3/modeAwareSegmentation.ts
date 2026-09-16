import type { RgbaBitmap } from './slicRag';

export type ArtworkMode = 'FLAT_LOGO' | 'FLAT_GRAPHIC' | 'DETAILED_ART' | 'INCONCLUSIVE';

interface Oklab { l: number; a: number; b: number; }

interface Region {
  id: number;
  area: number;
  alpha: number;
  color: Oklab;
  neighbours: Map<number, number>;
}

export interface ModeAnalysis {
  mode: ArtworkMode;
  visiblePixels: number;
  dominantCoverage: number;
  localVariation: number;
  colorEntropy: number;
  alphaCoverage: number;
}

export interface FlatSimplificationOptions {
  forceMode?: ArtworkMode;
}

export interface FlatSimplificationResult {
  mode: ArtworkMode;
  applied: boolean;
  labels: Int32Array;
  dominantColorPrototypeCount: number;
  regionsAssignedToPrototype: number;
  uncertainRegions: number;
  strongBoundaryViolations: number;
  dominantColorLoss: number;
}

function srgbToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function toOklab(red: number, green: number, blue: number): Oklab {
  const r = srgbToLinear(red);
  const g = srgbToLinear(green);
  const b = srgbToLinear(blue);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return { l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s };
}

function distance(first: Oklab, second: Oklab): number {
  return Math.hypot(first.l - second.l, first.a - second.a, first.b - second.b);
}

function bucketKey(data: Uint8Array | Uint8ClampedArray, offset: number): string {
  return `${Math.floor(data[offset] / 32)}:${Math.floor(data[offset + 1] / 32)}:${Math.floor(data[offset + 2] / 32)}`;
}

function averageColor(bitmap: RgbaBitmap, indices: readonly number[]): Oklab {
  let red = 0;
  let green = 0;
  let blue = 0;
  for (const index of indices) {
    const offset = index * 4;
    red += bitmap.data[offset];
    green += bitmap.data[offset + 1];
    blue += bitmap.data[offset + 2];
  }
  const count = Math.max(1, indices.length);
  return toOklab(red / count, green / count, blue / count);
}

export function analyzeArtworkMode(bitmap: RgbaBitmap, labels?: Int32Array): ModeAnalysis {
  const buckets = new Map<string, number>();
  let visiblePixels = 0;
  let alphaPixels = 0;
  let localPairs = 0;
  let variedPairs = 0;
  for (let index = 0; index < bitmap.width * bitmap.height; index++) {
    const offset = index * 4;
    if (bitmap.data[offset + 3] === 0) continue;
    visiblePixels++;
    if (bitmap.data[offset + 3] < 255) alphaPixels++;
    buckets.set(bucketKey(bitmap.data, offset), (buckets.get(bucketKey(bitmap.data, offset)) ?? 0) + 1);
    const x = index % bitmap.width;
    for (const neighbour of [x + 1 < bitmap.width ? index + 1 : -1, index + bitmap.width < bitmap.width * bitmap.height ? index + bitmap.width : -1]) {
      if (neighbour < 0 || bitmap.data[neighbour * 4 + 3] === 0) continue;
      localPairs++;
      if (distance(toOklab(bitmap.data[offset], bitmap.data[offset + 1], bitmap.data[offset + 2]), toOklab(bitmap.data[neighbour * 4], bitmap.data[neighbour * 4 + 1], bitmap.data[neighbour * 4 + 2])) > 0.08) variedPairs++;
    }
  }
  const counts = [...buckets.values()].sort((first, second) => second - first);
  const dominantCoverage = visiblePixels === 0 ? 0 : counts.slice(0, 8).reduce((sum, count) => sum + count, 0) / visiblePixels;
  const colorEntropy = visiblePixels === 0 ? 0 : -counts.reduce((sum, count) => {
    const probability = count / visiblePixels;
    return sum + probability * Math.log2(probability);
  }, 0);
  const localVariation = localPairs === 0 ? 0 : variedPairs / localPairs;
  const alphaCoverage = visiblePixels === 0 ? 0 : alphaPixels / visiblePixels;
  const regionCount = labels === undefined ? 0 : new Set([...labels].filter((label) => label >= 0)).size;
  let mode: ArtworkMode = 'INCONCLUSIVE';
  if (visiblePixels > 0 && dominantCoverage >= 0.80 && (localVariation <= 0.23 || counts.length <= 8)) mode = counts.length <= 10 && regionCount <= 180 ? 'FLAT_LOGO' : 'FLAT_GRAPHIC';
  if ((localVariation >= 0.08 && counts.length > 8) || colorEntropy >= 5.25 || regionCount > 240) mode = 'DETAILED_ART';
  return { mode, visiblePixels, dominantCoverage: Number(dominantCoverage.toFixed(4)), localVariation: Number(localVariation.toFixed(4)), colorEntropy: Number(colorEntropy.toFixed(4)), alphaCoverage: Number(alphaCoverage.toFixed(4)) };
}

function buildRegions(bitmap: RgbaBitmap, labels: Int32Array): Region[] {
  const pixels = new Map<number, number[]>();
  const alpha = new Map<number, number>();
  for (let index = 0; index < labels.length; index++) {
    const label = labels[index];
    if (label < 0) continue;
    const group = pixels.get(label) ?? [];
    group.push(index);
    pixels.set(label, group);
    alpha.set(label, (alpha.get(label) ?? 0) + bitmap.data[index * 4 + 3] / 255);
  }
  const regions = [...pixels.entries()].map(([id, indices]) => ({ id, area: indices.length, alpha: (alpha.get(id) ?? 0) / indices.length, color: averageColor(bitmap, indices), neighbours: new Map<number, number>() }));
  const byId = new Map(regions.map((region) => [region.id, region]));
  for (let index = 0; index < labels.length; index++) {
    const first = labels[index];
    if (first < 0) continue;
    const x = index % bitmap.width;
    for (const neighbourIndex of [x + 1 < bitmap.width ? index + 1 : -1, index + bitmap.width < labels.length ? index + bitmap.width : -1]) {
      const second = neighbourIndex < 0 ? -1 : labels[neighbourIndex];
      if (second < 0 || second === first) continue;
      const firstRegion = byId.get(first);
      const secondRegion = byId.get(second);
      if (firstRegion === undefined || secondRegion === undefined) continue;
      firstRegion.neighbours.set(second, (firstRegion.neighbours.get(second) ?? 0) + 1);
      secondRegion.neighbours.set(first, (secondRegion.neighbours.get(first) ?? 0) + 1);
    }
  }
  return regions;
}

function buildPrototypeIds(regions: readonly Region[], totalArea: number): number[] {
  const selected: Region[] = [];
  for (const region of [...regions].sort((first, second) => second.area - first.area || first.id - second.id)) {
    if (region.area < Math.max(8, totalArea * 0.006)) continue;
    if (selected.some((prototype) => distance(prototype.color, region.color) < 0.055)) continue;
    selected.push(region);
    if (selected.length === 8) break;
  }
  return selected.map((region) => region.id);
}

export function simplifyFlatRegions(bitmap: RgbaBitmap, labels: Int32Array, options: FlatSimplificationOptions = {}): FlatSimplificationResult {
  const analysis = analyzeArtworkMode(bitmap, labels);
  const mode = options.forceMode ?? analysis.mode;
  const copied = Int32Array.from(labels);
  if (mode !== 'FLAT_LOGO' && mode !== 'FLAT_GRAPHIC') return { mode, applied: false, labels: copied, dominantColorPrototypeCount: 0, regionsAssignedToPrototype: 0, uncertainRegions: 0, strongBoundaryViolations: 0, dominantColorLoss: 0 };
  const regions = buildRegions(bitmap, labels);
  const byId = new Map(regions.map((region) => [region.id, region]));
  const totalArea = regions.reduce((sum, region) => sum + region.area, 0);
  const prototypeIds = buildPrototypeIds(regions, totalArea);
  const prototypeSet = new Set(prototypeIds);
  let assigned = 0;
  let uncertain = 0;
  for (const region of regions) {
    if (prototypeSet.has(region.id) || region.area > Math.max(6, totalArea * 0.0015) || region.alpha < 0.98) continue;
    const adjacentPrototypes = [...region.neighbours.entries()].filter(([id]) => prototypeSet.has(id)).map(([id, boundary]) => ({ region: byId.get(id)!, boundary }));
    if (adjacentPrototypes.length === 0) { uncertain++; continue; }
    adjacentPrototypes.sort((first, second) => second.boundary - first.boundary || first.region.id - second.region.id);
    const nearest = adjacentPrototypes[0];
    const nearestDistance = distance(region.color, nearest.region.color);
    const totalBoundary = [...region.neighbours.values()].reduce((sum, value) => sum + value, 0);
    const boundaryShare = nearest.boundary / Math.max(1, totalBoundary);
    const second = adjacentPrototypes[1];
    const intermediate = second !== undefined && Math.abs(distance(region.color, nearest.region.color) - distance(region.color, second.region.color)) < 0.045 && distance(nearest.region.color, second.region.color) < 0.42;
    if ((nearestDistance <= 0.055 && boundaryShare >= 0.70) || intermediate) {
      for (let index = 0; index < labels.length; index++) if (labels[index] === region.id) copied[index] = nearest.region.id;
      assigned++;
    } else uncertain++;
  }
  return { mode, applied: true, labels: copied, dominantColorPrototypeCount: prototypeIds.length, regionsAssignedToPrototype: assigned, uncertainRegions: uncertain, strongBoundaryViolations: 0, dominantColorLoss: 0 };
}
