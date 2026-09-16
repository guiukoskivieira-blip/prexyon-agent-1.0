export interface RgbaBitmap {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export interface RegionPoint {
  x: number;
  y: number;
}

export interface RegionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RegionColor {
  r: number;
  g: number;
  b: number;
  a: number;
  key: string;
}

export interface RegionMask {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  data: Uint8Array;
}

export interface ConnectedRegion {
  id: string;
  color: RegionColor;
  pixelCount: number;
  bounds: RegionBounds;
  coverage: number;
  pixels: number[];
  mask: RegionMask;
  adjacentRegionIds: string[];
  classification: 'significant' | 'small-legitimate' | 'probable-noise';
}

export interface RegionContour {
  points: RegionPoint[];
  signedArea: number;
}

export interface RegionObject {
  id: string;
  fillColor: RegionColor;
  outer: RegionContour;
  holes: RegionContour[];
  compoundPath: string;
  fillRule: 'evenodd';
  bounds: RegionBounds;
  pixelCount: number;
  pixelCoverage: number;
  sourceRegionId: string;
}

export interface RegionFirstOptions {
  /** Maximum direct perceptual distance used to collapse compression noise. */
  colorTolerance?: number;
  /** Maximum distance from the line between two dominant colors for AA classification. */
  antialiasTolerance?: number;
  /** A color cluster must cover this ratio to be considered an AA endpoint. */
  dominantColorRatio?: number;
  /** Maximum contour deviation in source pixels. */
  simplifyTolerancePx?: number;
}

export interface RegionFirstMetrics {
  rawPathCount: number;
  logicalRegionCount: number;
  significantConnectedRegionCount: number;
  experimentalObjectCount: number;
  subpathCount: number;
  nodeCount: number;
  uniqueColors: number;
  microObjectCount: number;
  unexpectedHoles: number;
  preservedHoles: number;
  colorRegionCount: number;
  opaqueOrVisiblePixels: number;
  svgBytes: number;
  executionTimeMs: number;
  approximateMemoryBytes: number;
  silhouetteAreaDifferenceRatio: number;
  fragmentationRatio: number;
}

export interface RegionFirstResult {
  normalized: NormalizedRegionRaster;
  regions: ConnectedRegion[];
  objects: RegionObject[];
  svg: string;
  metrics: RegionFirstMetrics;
}

export interface NormalizedRegionRaster {
  width: number;
  height: number;
  pixels: Array<RegionColor | null>;
  palette: RegionColor[];
}

interface LabColor {
  l: number;
  a: number;
  b: number;
}

interface ColorBucket {
  color: RegionColor;
  lab: LabColor;
  count: number;
}

interface MutableCluster extends ColorBucket {
  sourceKeys: string[];
}

interface BoundaryEdge {
  start: RegionPoint;
  end: RegionPoint;
  used: boolean;
}

const DEFAULT_OPTIONS: Required<RegionFirstOptions> = {
  colorTolerance: 0.035,
  antialiasTolerance: 0.028,
  dominantColorRatio: 0.08,
  simplifyTolerancePx: 0.6,
};

function colorKey(r: number, g: number, b: number, a: number): string {
  return `${r},${g},${b},${a}`;
}

function srgbToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function toOklab(color: RegionColor): LabColor {
  const red = srgbToLinear(color.r);
  const green = srgbToLinear(color.g);
  const blue = srgbToLinear(color.b);
  const l = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue;
  const m = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue;
  const s = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue;
  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);
  return {
    l: 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    a: 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  };
}

function labDistance(first: LabColor, second: LabColor): number {
  return Math.hypot(first.l - second.l, first.a - second.a, first.b - second.b);
}

function pointToSegmentDistance(point: LabColor, start: LabColor, end: LabColor): { distance: number; position: number } {
  const vx = end.l - start.l;
  const vy = end.a - start.a;
  const vz = end.b - start.b;
  const lengthSquared = vx * vx + vy * vy + vz * vz;
  if (lengthSquared === 0) return { distance: labDistance(point, start), position: 0 };
  const projection = ((point.l - start.l) * vx + (point.a - start.a) * vy + (point.b - start.b) * vz) / lengthSquared;
  const position = Math.max(0, Math.min(1, projection));
  const projected = {
    l: start.l + vx * position,
    a: start.a + vy * position,
    b: start.b + vz * position,
  };
  return { distance: labDistance(point, projected), position };
}

function nearestCluster(bucket: ColorBucket, clusters: readonly MutableCluster[]): { cluster: MutableCluster; distance: number } | undefined {
  let selected: MutableCluster | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const cluster of clusters) {
    if (Math.abs(bucket.color.a - cluster.color.a) > 16) continue;
    const candidateDistance = labDistance(bucket.lab, cluster.lab);
    if (candidateDistance < distance) {
      selected = cluster;
      distance = candidateDistance;
    }
  }
  return selected ? { cluster: selected, distance } : undefined;
}

function consolidateFragmentedAdjacentColors(
  bitmap: RgbaBitmap,
  assignments: Map<string, MutableCluster | null>,
  clusters: readonly MutableCluster[],
  options: Required<RegionFirstOptions>,
): void {
  const assignedKeys: Array<string | null> = new Array(bitmap.width * bitmap.height).fill(null);
  const assignedPixelCounts = new Map<string, number>();
  for (let index = 0; index < assignedKeys.length; index++) {
    const offset = index * 4;
    const alpha = bitmap.data[offset + 3];
    if (alpha === 0) continue;
    const sourceKey = colorKey(bitmap.data[offset], bitmap.data[offset + 1], bitmap.data[offset + 2], alpha);
    const assigned = assignments.get(sourceKey);
    if (!assigned) continue;
    assignedKeys[index] = assigned.color.key;
    assignedPixelCounts.set(assigned.color.key, (assignedPixelCounts.get(assigned.color.key) ?? 0) + 1);
  }

  const visited = new Uint8Array(assignedKeys.length);
  const componentCounts = new Map<string, number>();
  const adjacentPairs = new Set<string>();
  for (let seed = 0; seed < assignedKeys.length; seed++) {
    const seedKey = assignedKeys[seed];
    if (!seedKey || visited[seed]) continue;
    componentCounts.set(seedKey, (componentCounts.get(seedKey) ?? 0) + 1);
    const queue = [seed];
    visited[seed] = 1;
    let cursor = 0;
    while (cursor < queue.length) {
      const index = queue[cursor++];
      const x = index % bitmap.width;
      const y = Math.floor(index / bitmap.width);
      for (const neighbour of [
        x > 0 ? index - 1 : -1,
        x + 1 < bitmap.width ? index + 1 : -1,
        y > 0 ? index - bitmap.width : -1,
        y + 1 < bitmap.height ? index + bitmap.width : -1,
      ]) {
        if (neighbour < 0) continue;
        const neighbourKey = assignedKeys[neighbour];
        if (neighbourKey && neighbourKey !== seedKey) {
          adjacentPairs.add([seedKey, neighbourKey].sort().join('|'));
        }
        if (!visited[neighbour] && neighbourKey === seedKey) {
          visited[neighbour] = 1;
          queue.push(neighbour);
        }
      }
    }
  }

  const clusterByKey = new Map(clusters.map((cluster) => [cluster.color.key, cluster]));
  const parent = new Map([...assignedPixelCounts.keys()].map((key) => [key, key]));
  const find = (key: string): string => {
    let root = parent.get(key) ?? key;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root) ?? root;
    parent.set(key, root);
    return root;
  };
  const union = (firstKey: string, secondKey: string): void => {
    const firstRoot = find(firstKey);
    const secondRoot = find(secondKey);
    if (firstRoot === secondRoot) return;
    const firstCount = assignedPixelCounts.get(firstRoot) ?? 0;
    const secondCount = assignedPixelCounts.get(secondRoot) ?? 0;
    if (firstCount > secondCount || (firstCount === secondCount && firstRoot < secondRoot)) parent.set(secondRoot, firstRoot);
    else parent.set(firstRoot, secondRoot);
  };

  for (const pair of adjacentPairs) {
    const [firstKey, secondKey] = pair.split('|');
    const first = clusterByKey.get(firstKey);
    const second = clusterByKey.get(secondKey);
    if (!first || !second || Math.abs(first.color.a - second.color.a) > 16) continue;
    const repeatedFragments = (componentCounts.get(firstKey) ?? 0) + (componentCounts.get(secondKey) ?? 0);
    if (repeatedFragments < 8) continue;
    if (labDistance(first.lab, second.lab) <= options.colorTolerance * 1.75) union(firstKey, secondKey);
  }

  for (const [sourceKey, assigned] of assignments) {
    if (!assigned) continue;
    const root = find(assigned.color.key);
    assignments.set(sourceKey, clusterByKey.get(root) ?? assigned);
  }
}

function countExactColorComponents(bitmap: RgbaBitmap): Map<string, number> {
  const keys: Array<string | null> = new Array(bitmap.width * bitmap.height).fill(null);
  for (let index = 0; index < keys.length; index++) {
    const offset = index * 4;
    const alpha = bitmap.data[offset + 3];
    if (alpha > 0) keys[index] = colorKey(bitmap.data[offset], bitmap.data[offset + 1], bitmap.data[offset + 2], alpha);
  }
  const counts = new Map<string, number>();
  const visited = new Uint8Array(keys.length);
  for (let seed = 0; seed < keys.length; seed++) {
    const key = keys[seed];
    if (!key || visited[seed]) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const queue = [seed];
    visited[seed] = 1;
    let cursor = 0;
    while (cursor < queue.length) {
      const index = queue[cursor++];
      const x = index % bitmap.width;
      const y = Math.floor(index / bitmap.width);
      for (const neighbour of [
        x > 0 ? index - 1 : -1,
        x + 1 < bitmap.width ? index + 1 : -1,
        y > 0 ? index - bitmap.width : -1,
        y + 1 < bitmap.height ? index + bitmap.width : -1,
      ]) {
        if (neighbour >= 0 && !visited[neighbour] && keys[neighbour] === key) {
          visited[neighbour] = 1;
          queue.push(neighbour);
        }
      }
    }
  }
  return counts;
}

function normalizeColors(bitmap: RgbaBitmap, options: Required<RegionFirstOptions>): RegionFirstResult['normalized'] {
  const expectedLength = bitmap.width * bitmap.height * 4;
  if (!Number.isInteger(bitmap.width) || !Number.isInteger(bitmap.height) || bitmap.width <= 0 || bitmap.height <= 0) {
    throw new Error('Region-First requer dimensões raster positivas e inteiras.');
  }
  if (bitmap.data.length !== expectedLength) {
    throw new Error(`Buffer RGBA inválido: esperado ${expectedLength}, recebido ${bitmap.data.length}.`);
  }

  const histogram = new Map<string, ColorBucket>();
  let visiblePixels = 0;
  for (let index = 0; index < bitmap.width * bitmap.height; index++) {
    const offset = index * 4;
    const alpha = bitmap.data[offset + 3];
    if (alpha === 0) continue;
    visiblePixels++;
    const color: RegionColor = {
      r: bitmap.data[offset],
      g: bitmap.data[offset + 1],
      b: bitmap.data[offset + 2],
      a: alpha,
      key: colorKey(bitmap.data[offset], bitmap.data[offset + 1], bitmap.data[offset + 2], alpha),
    };
    const existing = histogram.get(color.key);
    if (existing) existing.count++;
    else histogram.set(color.key, { color, lab: toOklab(color), count: 1 });
  }

  const buckets = [...histogram.values()].sort((first, second) => second.count - first.count || first.color.key.localeCompare(second.color.key));
  const exactComponentCounts = countExactColorComponents(bitmap);
  const clusters: MutableCluster[] = [];
  const initialAssignment = new Map<string, MutableCluster>();
  for (const bucket of buckets) {
    const nearest = nearestCluster(bucket, clusters);
    const coherentRegion = bucket.count >= 4 && exactComponentCounts.get(bucket.color.key) === 1;
    if (nearest && nearest.distance <= options.colorTolerance && !coherentRegion) {
      nearest.cluster.count += bucket.count;
      nearest.cluster.sourceKeys.push(bucket.color.key);
      initialAssignment.set(bucket.color.key, nearest.cluster);
    } else {
      const cluster = { ...bucket, sourceKeys: [bucket.color.key] };
      clusters.push(cluster);
      initialAssignment.set(bucket.color.key, cluster);
    }
  }

  const dominant = clusters.filter((cluster) => cluster.count / Math.max(1, visiblePixels) >= options.dominantColorRatio);
  const finalAssignment = new Map<string, MutableCluster | null>();
  for (const bucket of buckets) {
    const initial = initialAssignment.get(bucket.color.key);
    if (!initial) continue;
    if (dominant.includes(initial) || dominant.length === 0) {
      finalAssignment.set(bucket.color.key, initial);
      continue;
    }

    let bestEndpoint: MutableCluster | undefined;
    let bestResidual = Number.POSITIVE_INFINITY;
    for (let firstIndex = 0; firstIndex < dominant.length; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < dominant.length; secondIndex++) {
        const first = dominant[firstIndex];
        const second = dominant[secondIndex];
        if (Math.abs(first.color.a - second.color.a) > 16 || Math.abs(bucket.color.a - first.color.a) > 16) continue;
        const projection = pointToSegmentDistance(bucket.lab, first.lab, second.lab);
        if (projection.position <= 0.02 || projection.position >= 0.98 || projection.distance > bestResidual) continue;
        bestResidual = projection.distance;
        bestEndpoint = projection.position < 0.5 ? first : second;
      }
    }
    if (bestEndpoint && bestResidual <= options.antialiasTolerance) {
      finalAssignment.set(bucket.color.key, bestEndpoint);
      continue;
    }

    const sameColorDominant = dominant
      .map((cluster) => ({ cluster, distance: labDistance(bucket.lab, cluster.lab) }))
      .filter(({ distance }) => distance <= options.colorTolerance)
      .sort((first, second) => first.distance - second.distance)[0];
    if (sameColorDominant && bucket.color.a < sameColorDominant.cluster.color.a) {
      finalAssignment.set(
        bucket.color.key,
        bucket.color.a >= sameColorDominant.cluster.color.a / 2 ? sameColorDominant.cluster : null,
      );
    } else {
      finalAssignment.set(bucket.color.key, initial);
    }
  }

  consolidateFragmentedAdjacentColors(bitmap, finalAssignment, clusters, options);

  const normalizedPixels: Array<RegionColor | null> = new Array(bitmap.width * bitmap.height).fill(null);
  const paletteByKey = new Map<string, RegionColor>();
  for (let index = 0; index < normalizedPixels.length; index++) {
    const offset = index * 4;
    const alpha = bitmap.data[offset + 3];
    if (alpha === 0) continue;
    const originalKey = colorKey(bitmap.data[offset], bitmap.data[offset + 1], bitmap.data[offset + 2], alpha);
    const assigned = finalAssignment.get(originalKey);
    if (!assigned) continue;
    normalizedPixels[index] = assigned.color;
    paletteByKey.set(assigned.color.key, assigned.color);
  }
  return { width: bitmap.width, height: bitmap.height, pixels: normalizedPixels, palette: [...paletteByKey.values()] };
}

function buildConnectedRegions(normalized: RegionFirstResult['normalized']): { regions: ConnectedRegion[]; labels: Int32Array } {
  const totalPixels = normalized.width * normalized.height;
  const labels = new Int32Array(totalPixels);
  labels.fill(-1);
  const regions: ConnectedRegion[] = [];
  const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

  for (let seed = 0; seed < totalPixels; seed++) {
    const seedColor = normalized.pixels[seed];
    if (!seedColor || labels[seed] !== -1) continue;
    const regionIndex = regions.length;
    const pixels: number[] = [];
    const queue = [seed];
    labels[seed] = regionIndex;
    let cursor = 0;
    let minX = normalized.width;
    let minY = normalized.height;
    let maxX = -1;
    let maxY = -1;
    while (cursor < queue.length) {
      const index = queue[cursor++];
      pixels.push(index);
      const x = index % normalized.width;
      const y = Math.floor(index / normalized.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (const [dx, dy] of neighbours) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= normalized.width || ny >= normalized.height) continue;
        const neighbourIndex = ny * normalized.width + nx;
        const neighbourColor = normalized.pixels[neighbourIndex];
        if (labels[neighbourIndex] === -1 && neighbourColor?.key === seedColor.key) {
          labels[neighbourIndex] = regionIndex;
          queue.push(neighbourIndex);
        }
      }
    }
    const bounds = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
    const mask = new Uint8Array(bounds.width * bounds.height);
    for (const index of pixels) {
      const x = index % normalized.width;
      const y = Math.floor(index / normalized.width);
      mask[(y - bounds.y) * bounds.width + x - bounds.x] = 255;
    }
    const coverage = pixels.length / totalPixels;
    regions.push({
      id: `region-${regionIndex + 1}`,
      color: seedColor,
      pixelCount: pixels.length,
      bounds,
      coverage,
      pixels,
      mask: { width: bounds.width, height: bounds.height, offsetX: bounds.x, offsetY: bounds.y, data: mask },
      adjacentRegionIds: [],
      classification: pixels.length <= 4 && coverage < 0.005 ? 'small-legitimate' : 'significant',
    });
  }

  const adjacency = regions.map(() => new Set<number>());
  for (let y = 0; y < normalized.height; y++) {
    for (let x = 0; x < normalized.width; x++) {
      const index = y * normalized.width + x;
      const label = labels[index];
      if (label < 0) continue;
      for (const neighbourIndex of [x + 1 < normalized.width ? index + 1 : -1, y + 1 < normalized.height ? index + normalized.width : -1]) {
        if (neighbourIndex < 0) continue;
        const neighbourLabel = labels[neighbourIndex];
        if (neighbourLabel >= 0 && neighbourLabel !== label) {
          adjacency[label].add(neighbourLabel);
          adjacency[neighbourLabel].add(label);
        }
      }
    }
  }
  regions.forEach((region, index) => {
    region.adjacentRegionIds = [...adjacency[index]].sort((a, b) => a - b).map((adjacent) => regions[adjacent].id);
    if (region.pixelCount <= 4 && region.coverage < 0.005) {
      const regionLab = toOklab(region.color);
      const closeAdjacentColor = [...adjacency[index]].some((adjacent) => (
        labDistance(regionLab, toOklab(regions[adjacent].color)) <= DEFAULT_OPTIONS.colorTolerance * 1.75
      ));
      region.classification = closeAdjacentColor ? 'probable-noise' : 'small-legitimate';
    }
  });
  return { regions, labels };
}

function pointKey(point: RegionPoint): string {
  return `${point.x},${point.y}`;
}

function directionIndex(edge: BoundaryEdge): number {
  const dx = edge.end.x - edge.start.x;
  const dy = edge.end.y - edge.start.y;
  if (dx > 0) return 0;
  if (dy > 0) return 1;
  if (dx < 0) return 2;
  return 3;
}

function signedArea(points: readonly RegionPoint[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function pointInPolygon(point: RegionPoint, polygon: readonly RegionPoint[]): boolean {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const first = polygon[current];
    const second = polygon[previous];
    const crosses = (first.y > point.y) !== (second.y > point.y)
      && point.x < ((second.x - first.x) * (point.y - first.y)) / (second.y - first.y) + first.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function removeCollinear(points: readonly RegionPoint[]): RegionPoint[] {
  if (points.length <= 3) return [...points];
  return points.filter((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    return (point.x - previous.x) * (next.y - point.y) !== (point.y - previous.y) * (next.x - point.x);
  });
}

function distanceToLine(point: RegionPoint, start: RegionPoint, end: RegionPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / Math.hypot(dx, dy);
}

function simplifyOpen(points: readonly RegionPoint[], tolerance: number): RegionPoint[] {
  if (points.length <= 2) return [...points];
  let farthestIndex = -1;
  let farthestDistance = tolerance;
  for (let index = 1; index < points.length - 1; index++) {
    const distance = distanceToLine(points[index], points[0], points[points.length - 1]);
    if (distance > farthestDistance) {
      farthestDistance = distance;
      farthestIndex = index;
    }
  }
  if (farthestIndex === -1) return [points[0], points[points.length - 1]];
  const left = simplifyOpen(points.slice(0, farthestIndex + 1), tolerance);
  const right = simplifyOpen(points.slice(farthestIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

function simplifyClosed(points: readonly RegionPoint[], tolerance: number): RegionPoint[] {
  const collinearReduced = removeCollinear(points);
  if (collinearReduced.length <= 4 || tolerance <= 0) return collinearReduced;
  const start = collinearReduced[0];
  let splitIndex = 1;
  let maximumDistance = -1;
  for (let index = 1; index < collinearReduced.length; index++) {
    const distance = Math.hypot(collinearReduced[index].x - start.x, collinearReduced[index].y - start.y);
    if (distance > maximumDistance) {
      maximumDistance = distance;
      splitIndex = index;
    }
  }
  const firstHalf = simplifyOpen(collinearReduced.slice(0, splitIndex + 1), tolerance);
  const secondHalf = simplifyOpen([...collinearReduced.slice(splitIndex), start], tolerance);
  return removeCollinear([...firstHalf.slice(0, -1), ...secondHalf.slice(0, -1)]);
}

function extractContours(regionIndex: number, labels: Int32Array, width: number, height: number, tolerance: number): RegionContour[] {
  const edges: BoundaryEdge[] = [];
  const add = (start: RegionPoint, end: RegionPoint): void => { edges.push({ start, end, used: false }); };
  for (let index = 0; index < labels.length; index++) {
    if (labels[index] !== regionIndex) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    if (y === 0 || labels[index - width] !== regionIndex) add({ x, y }, { x: x + 1, y });
    if (x === width - 1 || labels[index + 1] !== regionIndex) add({ x: x + 1, y }, { x: x + 1, y: y + 1 });
    if (y === height - 1 || labels[index + width] !== regionIndex) add({ x: x + 1, y: y + 1 }, { x, y: y + 1 });
    if (x === 0 || labels[index - 1] !== regionIndex) add({ x, y: y + 1 }, { x, y });
  }

  const outgoing = new Map<string, number[]>();
  edges.forEach((edge, index) => {
    const key = pointKey(edge.start);
    const bucket = outgoing.get(key) ?? [];
    bucket.push(index);
    outgoing.set(key, bucket);
  });
  const contours: RegionContour[] = [];
  for (let seed = 0; seed < edges.length; seed++) {
    if (edges[seed].used) continue;
    const points: RegionPoint[] = [];
    let edgeIndex = seed;
    const origin = edges[seed].start;
    while (!edges[edgeIndex].used) {
      const edge = edges[edgeIndex];
      edge.used = true;
      points.push(edge.start);
      if (edge.end.x === origin.x && edge.end.y === origin.y) break;
      const candidates = (outgoing.get(pointKey(edge.end)) ?? []).filter((candidate) => !edges[candidate].used);
      if (candidates.length === 0) break;
      const incomingDirection = directionIndex(edge);
      const turnPriority = [1, 0, 3, 2];
      candidates.sort((first, second) => {
        const firstTurn = (directionIndex(edges[first]) - incomingDirection + 4) % 4;
        const secondTurn = (directionIndex(edges[second]) - incomingDirection + 4) % 4;
        return turnPriority.indexOf(firstTurn) - turnPriority.indexOf(secondTurn) || first - second;
      });
      edgeIndex = candidates[0];
    }
    if (points.length >= 3) {
      const simplified = simplifyClosed(points, tolerance);
      if (simplified.length >= 3) contours.push({ points: simplified, signedArea: signedArea(simplified) });
    }
  }
  return contours.sort((first, second) => Math.abs(second.signedArea) - Math.abs(first.signedArea));
}

function contourPath(contour: RegionContour): string {
  const [first, ...rest] = contour.points;
  return `M${first.x} ${first.y}${rest.map((point) => `L${point.x} ${point.y}`).join('')}Z`;
}

function toHex(color: RegionColor): string {
  return `#${[color.r, color.g, color.b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function buildSvg(width: number, height: number, objects: readonly RegionObject[]): string {
  const paths = objects.map((object) => {
    const opacity = object.fillColor.a < 255 ? ` fill-opacity="${(object.fillColor.a / 255).toFixed(3)}"` : '';
    return `<path d="${object.compoundPath}" fill="${toHex(object.fillColor)}"${opacity} fill-rule="evenodd"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${paths}</svg>`;
}

export function reconstructRegionFirst(bitmap: RgbaBitmap, requestedOptions: RegionFirstOptions = {}): RegionFirstResult {
  const startedAt = performance.now();
  const options = { ...DEFAULT_OPTIONS, ...requestedOptions };
  const normalized = normalizeColors(bitmap, options);
  const { regions, labels } = buildConnectedRegions(normalized);
  const objects: RegionObject[] = [];
  for (let regionIndex = 0; regionIndex < regions.length; regionIndex++) {
    const region = regions[regionIndex];
    const contours = extractContours(regionIndex, labels, bitmap.width, bitmap.height, options.simplifyTolerancePx);
    if (contours.length === 0) continue;
    const outer = contours[0];
    const holes = contours.slice(1).filter((contour) => pointInPolygon(contour.points[0], outer.points));
    objects.push({
      id: `region-object-${objects.length + 1}`,
      fillColor: region.color,
      outer,
      holes,
      compoundPath: [outer, ...holes].map(contourPath).join(''),
      fillRule: 'evenodd',
      bounds: region.bounds,
      pixelCount: region.pixelCount,
      pixelCoverage: region.coverage,
      sourceRegionId: region.id,
    });
  }
  const svg = buildSvg(bitmap.width, bitmap.height, objects);
  const preservedHoles = objects.reduce((total, object) => total + object.holes.length, 0);
  const nodeCount = objects.reduce(
    (total, object) => total + object.outer.points.length + object.holes.reduce((holeTotal, hole) => holeTotal + hole.points.length, 0),
    0,
  );
  const visiblePixels = normalized.pixels.reduce((count, color) => count + (color ? 1 : 0), 0);
  const vectorArea = objects.reduce(
    (total, object) => total + Math.abs(object.outer.signedArea) - object.holes.reduce((holeArea, hole) => holeArea + Math.abs(hole.signedArea), 0),
    0,
  );
  const maskBytes = regions.reduce((total, region) => total + region.mask.data.byteLength, 0);
  const significantConnectedRegionCount = regions.length;
  const experimentalObjectCount = objects.length;
  const metrics: RegionFirstMetrics = {
    rawPathCount: objects.length,
    logicalRegionCount: regions.length,
    significantConnectedRegionCount,
    experimentalObjectCount,
    subpathCount: objects.length + preservedHoles,
    nodeCount,
    uniqueColors: new Set(objects.map((object) => object.fillColor.key)).size,
    microObjectCount: objects.filter((object) => object.pixelCount <= 4).length,
    unexpectedHoles: 0,
    preservedHoles,
    colorRegionCount: regions.length,
    opaqueOrVisiblePixels: visiblePixels,
    svgBytes: new TextEncoder().encode(svg).byteLength,
    executionTimeMs: Number((performance.now() - startedAt).toFixed(3)),
    approximateMemoryBytes: bitmap.data.byteLength + bitmap.width * bitmap.height * 8 + labels.byteLength + maskBytes + nodeCount * 16,
    silhouetteAreaDifferenceRatio: visiblePixels === 0 ? 0 : Math.abs(vectorArea - visiblePixels) / visiblePixels,
    fragmentationRatio: significantConnectedRegionCount === 0 ? 0 : experimentalObjectCount / significantConnectedRegionCount,
  };
  return { normalized, regions, objects, svg, metrics };
}
