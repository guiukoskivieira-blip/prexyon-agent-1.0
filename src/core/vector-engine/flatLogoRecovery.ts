import { RgbaRaster, LabColor } from './types';
import { DirectVectoExecutor } from './directVectoBackend';
import { rgbToLab, deltaE } from './features';

export interface InferredColor {
  hex: string;
  r: number;
  g: number;
  b: number;
  lab: LabColor;
  pixelCount: number;
  fraction: number;
}

export interface FlatLogoRecoveryOptions {
  /** Maximum number of graphic colors to infer. Default: 8 */
  maxColors?: number;
  /** Minimum fraction of image area for a color cluster to be considered a graphic mode. Default: 0.005 (0.5%) */
  minAreaFraction?: number;
  /** Minimum DeltaE between distinct palette colors. Default: 12.0 */
  minColorDeltaE?: number;
  /** Radius for neighborhood spatial consistency. Default: 1 */
  spatialRadius?: number;
}

export interface FlatLogoRecoveryStats {
  originalDistinctColors: number;
  recoveredDistinctColors: number;
  inferredPalette: InferredColor[];
  reassignedPixels: number;
  reassignedFraction: number;
}

export interface FlatLogoRecoveryResult {
  recoveredRaster: RgbaRaster;
  stats: FlatLogoRecoveryStats;
}

export interface FlatLogoVectorResult {
  svg: string;
  backend: 'DIRECT_VECTO';
  fillFirst: true;
  recoveryStats: FlatLogoRecoveryStats;
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
}

/**
 * Infers the fundamental graphic color palette from a raster image.
 * Separates dominant color masses from antialiasing and JPEG compression noise.
 */
export function inferDominantPalette(
  raster: RgbaRaster,
  options?: FlatLogoRecoveryOptions
): InferredColor[] {
  const minAreaFraction = options?.minAreaFraction ?? 0.005; // 0.5% minimum area
  const minColorDeltaE = options?.minColorDeltaE ?? 12.0;
  const maxColors = options?.maxColors ?? 8;

  const totalPixels = raster.width * raster.height;
  const minPixelCount = Math.max(10, Math.floor(totalPixels * minAreaFraction));

  // 1. Build a quantized color histogram (5-bits per channel = 32x32x32 = 32768 bins)
  const binMap = new Map<number, { sumR: number; sumG: number; sumB: number; count: number }>();

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const r = raster.data[idx];
    const g = raster.data[idx + 1];
    const b = raster.data[idx + 2];

    const binKey = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const existing = binMap.get(binKey);
    if (existing) {
      existing.sumR += r;
      existing.sumG += g;
      existing.sumB += b;
      existing.count++;
    } else {
      binMap.set(binKey, { sumR: r, sumG: g, sumB: b, count: 1 });
    }
  }

  // 2. Extract significant density peaks
  const clusters: Array<{ r: number; g: number; b: number; lab: LabColor; count: number }> = [];

  const sortedBins = Array.from(binMap.values()).sort((a, b) => b.count - a.count);

  for (const bin of sortedBins) {
    if (bin.count < minPixelCount && clusters.length >= 2) {
      // If we already have at least 2 modes and remaining bins are tiny, break early
      break;
    }

    const r = Math.round(bin.sumR / bin.count);
    const g = Math.round(bin.sumG / bin.count);
    const b = Math.round(bin.sumB / bin.count);
    const lab = rgbToLab(r, g, b);

    // Check if close to an existing cluster
    let merged = false;
    for (const c of clusters) {
      if (deltaE(lab, c.lab) < minColorDeltaE) {
        // Merge into existing cluster weighted centroid
        const total = c.count + bin.count;
        c.r = Math.round((c.r * c.count + r * bin.count) / total);
        c.g = Math.round((c.g * c.count + g * bin.count) / total);
        c.b = Math.round((c.b * c.count + b * bin.count) / total);
        c.lab = rgbToLab(c.r, c.g, c.b);
        c.count = total;
        merged = true;
        break;
      }
    }

    if (!merged && clusters.length < maxColors) {
      clusters.push({ r, g, b, lab, count: bin.count });
    }
  }

  // 3. Fallback: if fewer than 2 clusters found, take top 2 distinct bins
  if (clusters.length < 2 && sortedBins.length >= 2) {
    for (const bin of sortedBins) {
      const r = Math.round(bin.sumR / bin.count);
      const g = Math.round(bin.sumG / bin.count);
      const b = Math.round(bin.sumB / bin.count);
      const lab = rgbToLab(r, g, b);
      if (!clusters.some((c) => deltaE(lab, c.lab) < 5.0)) {
        clusters.push({ r, g, b, lab, count: bin.count });
        if (clusters.length >= 2) break;
      }
    }
  }

  // Sort clusters by count descending
  clusters.sort((a, b) => b.count - a.count);

  return clusters.map((c) => ({
    hex: rgbToHex(c.r, c.g, c.b),
    r: c.r,
    g: c.g,
    b: c.b,
    lab: c.lab,
    pixelCount: c.count,
    fraction: c.count / totalPixels,
  }));
}

/**
 * Reassigns intermediate / antialiased pixels to the nearest dominant graphic color,
 * producing a clean flat raster with crisp contours and zero halo artifacts.
 */
export function recoverFlatLogoRaster(
  raster: RgbaRaster,
  options?: FlatLogoRecoveryOptions
): FlatLogoRecoveryResult {
  const palette = inferDominantPalette(raster, options);
  const totalPixels = raster.width * raster.height;

  // Track original distinct colors
  const originalColors = new Set<number>();
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const rgb = (raster.data[idx] << 16) | (raster.data[idx + 1] << 8) | raster.data[idx + 2];
    originalColors.add(rgb);
  }

  const outData = new Uint8Array(raster.data.length);
  let reassignedCount = 0;

  // Pre-calculate palette Labs
  const paletteLabs = palette.map((p) => p.lab);

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const r = raster.data[idx];
    const g = raster.data[idx + 1];
    const b = raster.data[idx + 2];
    const a = raster.data[idx + 3];

    const pixelLab = rgbToLab(r, g, b);

    // Find nearest palette color in DeltaE
    let bestIdx = 0;
    let bestDeltaE = deltaE(pixelLab, paletteLabs[0]);

    for (let p = 1; p < palette.length; p++) {
      const d = deltaE(pixelLab, paletteLabs[p]);
      if (d < bestDeltaE) {
        bestDeltaE = d;
        bestIdx = p;
      }
    }

    const chosen = palette[bestIdx];
    outData[idx] = chosen.r;
    outData[idx + 1] = chosen.g;
    outData[idx + 2] = chosen.b;
    outData[idx + 3] = a;

    if (r !== chosen.r || g !== chosen.g || b !== chosen.b) {
      reassignedCount++;
    }
  }

  const recoveredRaster: RgbaRaster = {
    width: raster.width,
    height: raster.height,
    data: outData,
  };

  const recoveredColors = new Set<number>();
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const rgb = (outData[idx] << 16) | (outData[idx + 1] << 8) | outData[idx + 2];
    recoveredColors.add(rgb);
  }

  return {
    recoveredRaster,
    stats: {
      originalDistinctColors: originalColors.size,
      recoveredDistinctColors: recoveredColors.size,
      inferredPalette: palette,
      reassignedPixels: reassignedCount,
      reassignedFraction: reassignedCount / totalPixels,
    },
  };
}

/**
 * Executes the Flat Logo Recovery pipeline:
 * Cleans the input raster via palette consolidation -> passes clean raster to Vecto.
 */
export async function vectorizeFlatLogoWithRecovery(
  raster: RgbaRaster,
  vectoExecutor: DirectVectoExecutor,
  options?: FlatLogoRecoveryOptions
): Promise<FlatLogoVectorResult> {
  const recovery = recoverFlatLogoRaster(raster, options);
  const svg = await vectoExecutor.vectorize(recovery.recoveredRaster);

  return {
    svg,
    backend: 'DIRECT_VECTO',
    fillFirst: true,
    recoveryStats: recovery.stats,
  };
}
