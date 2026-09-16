import type { RgbaBitmap } from './slicRag';

export type ResidualRegionClass = 'STRUCTURAL_COLOR_REGION' | 'EDGE_TRANSITION_REGION' | 'SHADING_REGION' | 'LEGITIMATE_DETAIL' | 'UNCERTAIN';

interface Region { area: number; r: number; g: number; b: number; alpha: number; neighbours: Map<number, number>; }

export interface ResidualConsolidationResult {
  labels: Int32Array;
  classifications: ResidualRegionClass[];
  counts: Record<ResidualRegionClass, number>;
  consolidatedRegionCount: number;
}

function colorDistance(first: Region, second: Region): number {
  return Math.hypot(first.r - second.r, first.g - second.g, first.b - second.b) / 441.673;
}

function distanceToSegment(point: Region, first: Region, second: Region): number {
  const vx = second.r - first.r; const vy = second.g - first.g; const vz = second.b - first.b;
  const length = vx * vx + vy * vy + vz * vz;
  if (length === 0) return colorDistance(point, first);
  const t = Math.max(0, Math.min(1, ((point.r - first.r) * vx + (point.g - first.g) * vy + (point.b - first.b) * vz) / length));
  return Math.hypot(point.r - (first.r + vx * t), point.g - (first.g + vy * t), point.b - (first.b + vz * t)) / 441.673;
}

function buildRegions(bitmap: RgbaBitmap, labels: Int32Array): Region[] {
  const regions: Array<Region & { sr: number; sg: number; sb: number; sa: number }> = [];
  for (let index = 0; index < labels.length; index++) {
    const label = labels[index]; if (label < 0) continue;
    const region = regions[label] ??= { area: 0, r: 0, g: 0, b: 0, alpha: 0, sr: 0, sg: 0, sb: 0, sa: 0, neighbours: new Map() };
    const offset = index * 4; region.area++; region.sr += bitmap.data[offset]; region.sg += bitmap.data[offset + 1]; region.sb += bitmap.data[offset + 2]; region.sa += bitmap.data[offset + 3];
  }
  regions.forEach((region) => { region.r = region.sr / region.area; region.g = region.sg / region.area; region.b = region.sb / region.area; region.alpha = region.sa / region.area; });
  for (let index = 0; index < labels.length; index++) {
    const label = labels[index]; if (label < 0) continue; const x = index % bitmap.width;
    for (const adjacent of [x + 1 < bitmap.width ? index + 1 : -1, index + bitmap.width < labels.length ? index + bitmap.width : -1]) {
      const other = adjacent < 0 ? -1 : labels[adjacent];
      if (other >= 0 && other !== label) regions[label].neighbours.set(other, (regions[label].neighbours.get(other) ?? 0) + 1), regions[other].neighbours.set(label, (regions[other].neighbours.get(label) ?? 0) + 1);
    }
  }
  return regions;
}

export function consolidateResidualRegions(bitmap: RgbaBitmap, sourceLabels: Int32Array): ResidualConsolidationResult {
  const regions = buildRegions(bitmap, sourceLabels);
  const smallArea = Math.max(4, Math.floor(bitmap.width * bitmap.height / 10000));
  const classifications: ResidualRegionClass[] = regions.map((region) => {
    const neighbours = [...region.neighbours.keys()].map((key) => ({ key, region: regions[key], shared: region.neighbours.get(key) ?? 0 }));
    if (region.area > smallArea) return neighbours.some(({ region: other }) => colorDistance(region, other) < 0.08) ? 'SHADING_REGION' : 'STRUCTURAL_COLOR_REGION';
    if (region.alpha < 250) return 'UNCERTAIN';
    if (neighbours.length < 2) return neighbours.length === 1 && colorDistance(region, neighbours[0].region) >= 0.55 ? 'LEGITIMATE_DETAIL' : 'UNCERTAIN';
    const [first, second] = neighbours.sort((a, b) => b.shared - a.shared);
    const intermediate = distanceToSegment(region, first.region, second.region) <= 0.06;
    const compatible = Math.min(colorDistance(region, first.region), colorDistance(region, second.region)) < 0.45;
    const neighbourContrast = colorDistance(first.region, second.region);
    const ownContrast = Math.max(...neighbours.map(({ region: other }) => colorDistance(region, other)));
    if (intermediate && compatible && neighbourContrast >= 0.12 && neighbourContrast < 0.65 && ownContrast < 0.7) return 'EDGE_TRANSITION_REGION';
    if (ownContrast >= 0.55 && neighbourContrast < 0.05) return 'LEGITIMATE_DETAIL';
    return 'UNCERTAIN';
  });
  const labels = new Int32Array(sourceLabels);
  classifications.forEach((classification, id) => {
    if (classification !== 'EDGE_TRANSITION_REGION') return;
    const region = regions[id];
    const destination = [...region.neighbours.entries()].map(([key, shared]) => ({ key, shared, distance: colorDistance(region, regions[key]) })).filter(({ distance }) => distance < 0.45).sort((a, b) => b.shared - a.shared || a.distance - b.distance)[0];
    if (!destination) return;
    for (let index = 0; index < labels.length; index++) if (labels[index] === id) labels[index] = destination.key;
  });
  const counts: Record<ResidualRegionClass, number> = { STRUCTURAL_COLOR_REGION: 0, EDGE_TRANSITION_REGION: 0, SHADING_REGION: 0, LEGITIMATE_DETAIL: 0, UNCERTAIN: 0 };
  classifications.forEach((classification) => counts[classification]++);
  return { labels, classifications, counts, consolidatedRegionCount: new Set([...labels].filter((label) => label >= 0)).size };
}
