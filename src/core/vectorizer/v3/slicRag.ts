export interface RgbaBitmap {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export interface SlicRagOptions {
  targetSuperpixelArea?: number;
  iterations?: number;
  colorWeight?: number;
  edgeStrengthMultiplier?: number;
  mergeColorDistance?: number;
  weakBoundaryThreshold?: number;
  strongBoundaryThreshold?: number;
  coverageCompatibilityThreshold?: number;
}

export interface RagEdge {
  firstRegion: number;
  secondRegion: number;
  colorDistance: number;
  averageBoundaryStrength: number;
  maximumBoundaryStrength: number;
  boundaryLength: number;
  firstArea: number;
  secondArea: number;
  coverageDifference: number;
  coverageCompatible: boolean;
}

export interface SlicRagMetrics {
  initialSuperpixelCount: number;
  finalRegionCount: number;
  mergeCount: number;
  uniqueRepresentativeColors: number;
  smallestRegionPixels: number;
  medianRegionPixels: number;
  largestRegionPixels: number;
  strongBoundaryViolations: number;
  probableFragmentCount: number;
  executionTimeMs: number;
  pixelColorReconstructionDifference: number;
  edgePreservationDifference: number;
}

export interface SlicRagResult {
  rawSlicLabels: Int32Array;
  initialLabels: Int32Array;
  finalLabels: Int32Array;
  rawRaster: Uint8ClampedArray;
  initialRaster: Uint8ClampedArray;
  finalRaster: Uint8ClampedArray;
  edgeMap: Float32Array;
  ragEdges: RagEdge[];
  metrics: SlicRagMetrics;
}

interface Lab { l: number; a: number; b: number; }

type LabBuffer = Float32Array;

interface Center extends Lab { x: number; y: number; }

interface RegionStats extends Lab {
  area: number;
  coverage: number;
}

interface MutableBoundary {
  first: number;
  second: number;
  length: number;
  strengthSum: number;
  maximumStrength: number;
}

const DEFAULT_OPTIONS: Required<SlicRagOptions> = {
  targetSuperpixelArea: 1024,
  iterations: 2,
  colorWeight: 12,
  edgeStrengthMultiplier: 5,
  mergeColorDistance: 0.09,
  weakBoundaryThreshold: 0.20,
  strongBoundaryThreshold: 0.45,
  coverageCompatibilityThreshold: 0.72,
};

function srgbToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return 255 * (clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055);
}

function rgbaToLab(data: Uint8Array | Uint8ClampedArray, offset: number): Lab {
  const red = srgbToLinear(data[offset]);
  const green = srgbToLinear(data[offset + 1]);
  const blue = srgbToLinear(data[offset + 2]);
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function labToRgb(lab: Lab): readonly [number, number, number] {
  const l = Math.pow(lab.l + 0.3963377774 * lab.a + 0.2158037573 * lab.b, 3);
  const m = Math.pow(lab.l - 0.1055613458 * lab.a - 0.0638541728 * lab.b, 3);
  const s = Math.pow(lab.l - 0.0894841775 * lab.a - 1.291485548 * lab.b, 3);
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function labDistance(first: Lab, second: Lab): number {
  return Math.hypot(first.l - second.l, first.a - second.a, first.b - second.b);
}

function validateBitmap(bitmap: RgbaBitmap): void {
  if (!Number.isInteger(bitmap.width) || !Number.isInteger(bitmap.height) || bitmap.width <= 0 || bitmap.height <= 0) {
    throw new Error('SLIC + RAG requer dimensões raster positivas e inteiras.');
  }
  if (bitmap.data.length !== bitmap.width * bitmap.height * 4) {
    throw new Error('Buffer RGBA inválido para SLIC + RAG.');
  }
}

function buildLabs(bitmap: RgbaBitmap): LabBuffer {
  const labs = new Float32Array(bitmap.width * bitmap.height * 3);
  for (let index = 0; index < bitmap.width * bitmap.height; index++) {
    const lab = rgbaToLab(bitmap.data, index * 4);
    labs[index * 3] = lab.l;
    labs[index * 3 + 1] = lab.a;
    labs[index * 3 + 2] = lab.b;
  }
  return labs;
}

function labAt(labs: LabBuffer, index: number): Lab {
  const offset = index * 3;
  return { l: labs[offset], a: labs[offset + 1], b: labs[offset + 2] };
}

function nearestVisible(bitmap: RgbaBitmap, seedX: number, seedY: number): number | undefined {
  const roundedX = Math.max(0, Math.min(bitmap.width - 1, Math.round(seedX)));
  const roundedY = Math.max(0, Math.min(bitmap.height - 1, Math.round(seedY)));
  for (let radius = 0; radius <= 8; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = roundedX + dx;
        const y = roundedY + dy;
        if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) continue;
        const index = y * bitmap.width + x;
        if (bitmap.data[index * 4 + 3] > 0) return index;
      }
    }
  }
  return undefined;
}

function buildCenters(bitmap: RgbaBitmap, labs: LabBuffer, step: number): Center[] {
  const centers: Center[] = [];
  for (let y = step / 2; y < bitmap.height; y += step) {
    for (let x = step / 2; x < bitmap.width; x += step) {
      const index = nearestVisible(bitmap, x, y);
      if (index === undefined) continue;
      const lab = labAt(labs, index);
      centers.push({ ...lab, x: index % bitmap.width, y: Math.floor(index / bitmap.width) });
    }
  }
  if (centers.length === 0) return centers;
  return centers;
}

function assignSlic(
  bitmap: RgbaBitmap,
  labs: LabBuffer,
  centers: Center[],
  step: number,
  options: Required<SlicRagOptions>,
): Int32Array {
  const labels = new Int32Array(bitmap.width * bitmap.height);
  labels.fill(-1);
  if (centers.length === 0) return labels;
  const spatialScale = 1 / Math.max(1, step * step);
  for (let iteration = 0; iteration < options.iterations; iteration++) {
    const distances = new Float64Array(labels.length);
    distances.fill(Number.POSITIVE_INFINITY);
    labels.fill(-1);
    for (let centerIndex = 0; centerIndex < centers.length; centerIndex++) {
      const center = centers[centerIndex];
      const minX = Math.max(0, Math.floor(center.x - step));
      const maxX = Math.min(bitmap.width - 1, Math.ceil(center.x + step));
      const minY = Math.max(0, Math.floor(center.y - step));
      const maxY = Math.min(bitmap.height - 1, Math.ceil(center.y + step));
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const index = y * bitmap.width + x;
          if (bitmap.data[index * 4 + 3] === 0) continue;
          const labOffset = index * 3;
          const colorDistance = Math.hypot(
            labs[labOffset] - center.l,
            labs[labOffset + 1] - center.a,
            labs[labOffset + 2] - center.b,
          );
          const spatialDistance = (x - center.x) ** 2 + (y - center.y) ** 2;
          const distance = options.colorWeight * colorDistance * colorDistance + spatialDistance * spatialScale;
          if (distance < distances[index] || (distance === distances[index] && centerIndex < labels[index])) {
            distances[index] = distance;
            labels[index] = centerIndex;
          }
        }
      }
    }
    const sums = centers.map(() => ({ l: 0, a: 0, b: 0, x: 0, y: 0, count: 0 }));
    for (let index = 0; index < labels.length; index++) {
      const label = labels[index];
      if (label < 0) continue;
      const sum = sums[label];
      sum.l += labs[index * 3];
      sum.a += labs[index * 3 + 1];
      sum.b += labs[index * 3 + 2];
      sum.x += index % bitmap.width;
      sum.y += Math.floor(index / bitmap.width);
      sum.count++;
    }
    centers.forEach((center, index) => {
      const sum = sums[index];
      if (sum.count > 0) Object.assign(center, {
        l: sum.l / sum.count, a: sum.a / sum.count, b: sum.b / sum.count, x: sum.x / sum.count, y: sum.y / sum.count,
      });
    });
  }
  return labels;
}

function connectedLabels(labels: Int32Array, width: number, alphaGap: number): Int32Array {
  const components = new Int32Array(labels.length);
  components.fill(-1);
  const descriptors: Array<{ rawLabel: number; minX: number; minY: number; maxX: number; maxY: number }> = [];
  const queue: number[] = [];
  for (let seed = 0; seed < labels.length; seed++) {
    if (labels[seed] < 0 || components[seed] >= 0) continue;
    const component = descriptors.length;
    const rawLabel = labels[seed];
    components[seed] = component;
    queue.length = 0;
    queue.push(seed);
    let minX = seed % width;
    let maxX = minX;
    let minY = Math.floor(seed / width);
    let maxY = minY;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor];
      const x = current % width;
      const y = Math.floor(current / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      const candidates = [x > 0 ? current - 1 : -1, x + 1 < width ? current + 1 : -1, current >= width ? current - width : -1, current + width < labels.length ? current + width : -1];
      for (const adjacent of candidates) {
        if (adjacent >= 0 && components[adjacent] < 0 && labels[adjacent] === rawLabel) {
          components[adjacent] = component;
          queue.push(adjacent);
        }
      }
    }
    descriptors.push({ rawLabel, minX, minY, maxX, maxY });
  }
  const byRawLabel = new Map<number, number[]>();
  descriptors.forEach((descriptor, index) => {
    const group = byRawLabel.get(descriptor.rawLabel) ?? [];
    group.push(index);
    byRawLabel.set(descriptor.rawLabel, group);
  });
  const componentParents = new Int32Array(descriptors.length);
  for (let index = 0; index < componentParents.length; index++) componentParents[index] = index;
  const find = (index: number): number => {
    let root = index;
    while (componentParents[root] !== root) root = componentParents[root];
    while (componentParents[index] !== index) {
      const parent = componentParents[index];
      componentParents[index] = root;
      index = parent;
    }
    return root;
  };
  const unite = (first: number, second: number): void => {
    const firstRoot = find(first);
    const secondRoot = find(second);
    if (firstRoot !== secondRoot) componentParents[secondRoot] = firstRoot;
  };
  const distance = (first: typeof descriptors[number], second: typeof descriptors[number]): number => {
    const horizontal = Math.max(0, first.minX - second.maxX - 1, second.minX - first.maxX - 1);
    const vertical = Math.max(0, first.minY - second.maxY - 1, second.minY - first.maxY - 1);
    return Math.hypot(horizontal, vertical);
  };
  for (const group of byRawLabel.values()) {
    for (let first = 0; first < group.length; first++) {
      for (let second = first + 1; second < group.length; second++) {
        if (distance(descriptors[group[first]], descriptors[group[second]]) <= alphaGap) unite(group[first], group[second]);
      }
    }
  }
  const logicalLabels = new Int32Array(labels.length);
  logicalLabels.fill(-1);
  const logicalIds = new Map<number, number>();
  for (let index = 0; index < components.length; index++) {
    if (components[index] < 0) continue;
    const root = find(components[index]);
    const logicalId = logicalIds.get(root) ?? logicalIds.size;
    logicalIds.set(root, logicalId);
    logicalLabels[index] = logicalId;
  }
  return logicalLabels;
}

function buildEdgeMap(bitmap: RgbaBitmap, labs: LabBuffer, multiplier: number): Float32Array {
  const edges = new Float32Array(bitmap.width * bitmap.height);
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      const index = y * bitmap.width + x;
      if (bitmap.data[index * 4 + 3] === 0) continue;
      let strength = 0;
      for (const adjacent of [x + 1 < bitmap.width ? index + 1 : -1, y + 1 < bitmap.height ? index + bitmap.width : -1]) {
        if (adjacent < 0 || bitmap.data[adjacent * 4 + 3] === 0) continue;
        const firstOffset = index * 3;
        const secondOffset = adjacent * 3;
        const chroma = Math.hypot(
          labs[firstOffset] - labs[secondOffset],
          labs[firstOffset + 1] - labs[secondOffset + 1],
          labs[firstOffset + 2] - labs[secondOffset + 2],
        );
        const sharedCoverage = Math.min(bitmap.data[index * 4 + 3], bitmap.data[adjacent * 4 + 3]) / 255;
        // Coverage is retained independently; only mutually visible chroma can be a structural boundary.
        strength = Math.max(strength, Math.min(1, chroma * multiplier * sharedCoverage));
      }
      edges[index] = strength;
    }
  }
  return edges;
}

function buildStats(labels: Int32Array, bitmap: RgbaBitmap, labs: LabBuffer): RegionStats[] {
  const sums: Array<RegionStats & { sumL: number; sumA: number; sumB: number; sumCoverage: number }> = [];
  for (let index = 0; index < labels.length; index++) {
    const label = labels[index];
    if (label < 0) continue;
    const stat = sums[label] ??= { l: 0, a: 0, b: 0, coverage: 0, area: 0, sumL: 0, sumA: 0, sumB: 0, sumCoverage: 0 };
    const lab = labAt(labs, index);
    stat.area++;
    stat.sumL += lab.l;
    stat.sumA += lab.a;
    stat.sumB += lab.b;
    stat.sumCoverage += bitmap.data[index * 4 + 3] / 255;
  }
  return sums.map((stat) => ({
    l: stat.sumL / stat.area, a: stat.sumA / stat.area, b: stat.sumB / stat.area,
    coverage: stat.sumCoverage / stat.area, area: stat.area,
  }));
}

function pairKey(first: number, second: number): string {
  return first < second ? `${first}:${second}` : `${second}:${first}`;
}

function buildRag(labels: Int32Array, bitmap: RgbaBitmap, stats: readonly RegionStats[], edgeMap: Float32Array, options: Required<SlicRagOptions>): RagEdge[] {
  const boundaries = new Map<string, MutableBoundary>();
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      const index = y * bitmap.width + x;
      const first = labels[index];
      if (first < 0) continue;
      for (const adjacent of [x + 1 < bitmap.width ? index + 1 : -1, y + 1 < bitmap.height ? index + bitmap.width : -1]) {
        if (adjacent < 0) continue;
        const second = labels[adjacent];
        if (second < 0 || second === first) continue;
        const key = pairKey(first, second);
        const boundary = boundaries.get(key) ?? { first: Math.min(first, second), second: Math.max(first, second), length: 0, strengthSum: 0, maximumStrength: 0 };
        const strength = Math.max(edgeMap[index], edgeMap[adjacent]);
        boundary.length++;
        boundary.strengthSum += strength;
        boundary.maximumStrength = Math.max(boundary.maximumStrength, strength);
        boundaries.set(key, boundary);
      }
    }
  }
  return [...boundaries.values()].map((boundary) => {
    const first = stats[boundary.first];
    const second = stats[boundary.second];
    const coverageDifference = Math.abs(first.coverage - second.coverage);
    return {
      firstRegion: boundary.first,
      secondRegion: boundary.second,
      colorDistance: labDistance(first, second),
      averageBoundaryStrength: boundary.strengthSum / boundary.length,
      maximumBoundaryStrength: boundary.maximumStrength,
      boundaryLength: boundary.length,
      firstArea: first.area,
      secondArea: second.area,
      coverageDifference,
      coverageCompatible: coverageDifference <= options.coverageCompatibilityThreshold,
    };
  }).sort((first, second) => first.firstRegion - second.firstRegion || first.secondRegion - second.secondRegion);
}

class DisjointSet {
  private readonly parent: Int32Array;
  private readonly size: Int32Array;

  constructor(count: number) {
    this.parent = new Int32Array(count);
    this.size = new Int32Array(count);
    for (let index = 0; index < count; index++) { this.parent[index] = index; this.size[index] = 1; }
  }

  find(index: number): number {
    let root = index;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[index] !== index) {
      const parent = this.parent[index];
      this.parent[index] = root;
      index = parent;
    }
    return root;
  }

  union(first: number, second: number): boolean {
    let firstRoot = this.find(first);
    let secondRoot = this.find(second);
    if (firstRoot === secondRoot) return false;
    if (this.size[firstRoot] < this.size[secondRoot] || (this.size[firstRoot] === this.size[secondRoot] && firstRoot > secondRoot)) {
      [firstRoot, secondRoot] = [secondRoot, firstRoot];
    }
    this.parent[secondRoot] = firstRoot;
    this.size[firstRoot] += this.size[secondRoot];
    return true;
  }
}

function remapFinalLabels(initial: Int32Array, dsu: DisjointSet): Int32Array {
  const finalLabels = new Int32Array(initial.length);
  finalLabels.fill(-1);
  const remap = new Map<number, number>();
  for (let index = 0; index < initial.length; index++) {
    if (initial[index] < 0) continue;
    const root = dsu.find(initial[index]);
    const mapped = remap.get(root) ?? remap.size;
    remap.set(root, mapped);
    finalLabels[index] = mapped;
  }
  return finalLabels;
}

function renderLabels(labels: Int32Array, bitmap: RgbaBitmap, labs: LabBuffer): Uint8ClampedArray {
  const stats = buildStats(labels, bitmap, labs);
  const output = new Uint8ClampedArray(bitmap.data.length);
  for (let index = 0; index < labels.length; index++) {
    const offset = index * 4;
    const label = labels[index];
    if (label < 0) continue;
    const [red, green, blue] = labToRgb(stats[label]);
    output[offset] = Math.round(red);
    output[offset + 1] = Math.round(green);
    output[offset + 2] = Math.round(blue);
    output[offset + 3] = bitmap.data[offset + 3];
  }
  return output;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}


function difference(original: Uint8Array | Uint8ClampedArray, reconstructed: Uint8ClampedArray): number {
  let total = 0;
  let count = 0;
  for (let index = 0; index < original.length; index += 4) {
    if (original[index + 3] === 0) continue;
    total += Math.abs(original[index] - reconstructed[index]) + Math.abs(original[index + 1] - reconstructed[index + 1]) + Math.abs(original[index + 2] - reconstructed[index + 2]);
    count += 3;
  }
  return count === 0 ? 0 : total / count / 255;
}

function edgeDifference(edgeMap: Float32Array, labels: Int32Array, width: number): number {
  let total = 0;
  let count = 0;
  for (let index = 0; index < labels.length; index++) {
    if (labels[index] < 0) continue;
    const x = index % width;
    for (const adjacent of [x + 1 < width ? index + 1 : -1, index + width < labels.length ? index + width : -1]) {
      if (adjacent < 0 || labels[adjacent] < 0) continue;
      const boundary = labels[index] !== labels[adjacent] ? 1 : 0;
      total += Math.abs(edgeMap[index] - boundary);
      count++;
    }
  }
  return count === 0 ? 0 : total / count;
}

export function segmentWithSlicRag(bitmap: RgbaBitmap, requestedOptions: SlicRagOptions = {}): SlicRagResult {
  const startedAt = performance.now();
  validateBitmap(bitmap);
  const options = { ...DEFAULT_OPTIONS, ...requestedOptions };
  const labs = buildLabs(bitmap);
  const step = Math.max(1, Math.round(Math.sqrt(options.targetSuperpixelArea)));
  const centers = buildCenters(bitmap, labs, step);
  const slicLabels = assignSlic(bitmap, labs, centers, step, options);
  const initialLabels = connectedLabels(slicLabels, bitmap.width, Math.max(2, Math.floor(step / 4)));
  const initialStats = buildStats(initialLabels, bitmap, labs);
  const edgeMap = buildEdgeMap(bitmap, labs, options.edgeStrengthMultiplier);
  const ragEdges = buildRag(initialLabels, bitmap, initialStats, edgeMap, options);
  const dsu = new DisjointSet(initialStats.length);
  let mergeCount = 0;
  let strongBoundaryViolations = 0;
  for (const edge of ragEdges) {
    const strongBoundary = edge.averageBoundaryStrength >= options.strongBoundaryThreshold || edge.maximumBoundaryStrength >= options.strongBoundaryThreshold;
    const colorCompatible = edge.colorDistance <= options.mergeColorDistance;
    if (colorCompatible && strongBoundary) strongBoundaryViolations++;
    if (colorCompatible && edge.coverageCompatible && !strongBoundary && edge.averageBoundaryStrength <= options.weakBoundaryThreshold) {
      if (dsu.union(edge.firstRegion, edge.secondRegion)) mergeCount++;
    }
  }
  const finalLabels = remapFinalLabels(initialLabels, dsu);
  const finalStats = buildStats(finalLabels, bitmap, labs);
  const rawRaster = renderLabels(slicLabels, bitmap, labs);
  const initialRaster = renderLabels(initialLabels, bitmap, labs);
  const finalRaster = renderLabels(finalLabels, bitmap, labs);
  const finalSizes = finalStats.map((stat) => stat.area);
  const initialCount = initialStats.length;
  const metrics: SlicRagMetrics = {
    initialSuperpixelCount: initialCount,
    finalRegionCount: finalStats.length,
    mergeCount,
    uniqueRepresentativeColors: new Set(finalStats.map((stat) => labToRgb(stat).map((value) => Math.round(value)).join(','))).size,
    smallestRegionPixels: finalSizes.length === 0 ? 0 : Math.min(...finalSizes),
    medianRegionPixels: median(finalSizes),
    largestRegionPixels: finalSizes.length === 0 ? 0 : Math.max(...finalSizes),
    strongBoundaryViolations,
    probableFragmentCount: finalSizes.filter((size) => size < Math.max(4, options.targetSuperpixelArea / 8)).length,
    executionTimeMs: Number((performance.now() - startedAt).toFixed(3)),
    pixelColorReconstructionDifference: Number(difference(bitmap.data, finalRaster).toFixed(6)),
    edgePreservationDifference: Number(edgeDifference(edgeMap, finalLabels, bitmap.width).toFixed(6)),
  };
  return { rawSlicLabels: slicLabels, initialLabels, finalLabels, rawRaster, initialRaster, finalRaster, edgeMap, ragEdges, metrics };
}
