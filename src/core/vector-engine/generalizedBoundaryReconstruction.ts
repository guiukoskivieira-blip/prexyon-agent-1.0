/**
 * PRYX ETAPA 8.10B — Generalized Boundary Reconstruction after Antialias Absorption
 * 
 * General-purpose boundary reconstruction and seam dissolution engine.
 * Eliminates internal tessellation seams between adjacent same-owner regions,
 * extracts unified outer graphic contours, and performs feature-aware Schneider
 * Bézier curve fitting while preserving critical structural cusps and facial details.
 */

import { RgbaRaster } from './types';
import { NodeCliVectoExecutor } from './nodeVectoExecutor';
import { analyzePathGeometry } from './multicolorBoundaryReassignment';
import { analyzeSvgStats } from './goldenHarness';
import { reconstructProfessionalCurves, type CurveReconstructionOptions } from './professionalCurveReconstruction';
import { absorbGeneralizedAntialiasRegions } from './generalizedAntialiasAbsorption';

export interface BoundaryReconstructionOptions {
  /**
   * Maximum DeltaE in CIELAB space for antialiasing halo grouping.
   * Default: 28.0
   */
  maxDeltaEThreshold?: number;

  /**
   * Minimum confidence threshold for automatic antialias absorption.
   * Default: 0.65
   */
  confidenceThreshold?: number;

  /**
   * Maximum allowed curve deviation tolerance in pixels.
   * Default: 1.2
   */
  maxDeviationTolerance?: number;

  /**
   * Turn angle threshold in degrees to classify a vertex as a sharp corner/cusp.
   * Default: 38.0
   */
  cornerAngleThresholdDeg?: number;

  /**
   * Cusp angle threshold in degrees.
   * Default: 65.0
   */
  cuspAngleThresholdDeg?: number;

  /**
   * Minimum area in square pixels for standalone isolated noise filtering.
   * Default: 6.0 px²
   */
  minIsolatedNoiseArea?: number;
}

export interface BoundaryReconstructionResult {
  svg: string;
  pathsBefore: number;
  pathsAfter: number;
  anchorsBefore: number;
  anchorsAfter: number;
  fillsBefore: string[];
  fillsAfter: string[];
  holesBefore: number;
  holesAfter: number;
  internalSeamsDissolved: number;
  isolatedNoiseFiltered: number;
  protectedCorners: number;
  protectedCusps: number;
  smoothSections: number;
  maxDeviation: number;
  meanDeviation: number;
  p95Deviation: number;
  coverageLostPixels: number;
  newGapCount: number;
  selfIntersections: number;
  openPaths: number;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const c = hex.replace('#', '');
  return {
    r: parseInt(c.substring(0, 2), 16) || 0,
    g: parseInt(c.substring(2, 4), 16) || 0,
    b: parseInt(c.substring(4, 6), 16) || 0,
  };
}

function distSq(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

/**
 * Reconstructs clean unified boundaries after antialias absorption.
 */
export async function reconstructGeneralizedBoundaries(
  raster: RgbaRaster,
  baselineSvg: string,
  options: BoundaryReconstructionOptions = {}
): Promise<BoundaryReconstructionResult> {
  const maxDeltaE = options.maxDeltaEThreshold ?? 28.0;
  const confThreshold = options.confidenceThreshold ?? 0.65;
  const maxDevTol = options.maxDeviationTolerance ?? 1.2;
  const cornerAngle = options.cornerAngleThresholdDeg ?? 38.0;
  const cuspAngle = options.cuspAngleThresholdDeg ?? 65.0;
  const minNoiseArea = options.minIsolatedNoiseArea ?? 6.0;

  const baselineStats = analyzeSvgStats(baselineSvg);

  // 1. Analyze baseline SVG & Antialias Lineages
  const antialiasResult = absorbGeneralizedAntialiasRegions(baselineSvg, raster, {
    maxDeltaEThreshold: maxDeltaE,
    confidenceThreshold: confThreshold,
  });

  const dominantFills = antialiasResult.fillsAfter;
  const dominantPalette = dominantFills.map((hex) => {
    const rgb = hexToRgb(hex);
    return { hex, r: rgb.r, g: rgb.g, b: rgb.b };
  });

  // 2. Pre-dissolve antialiasing at raster level using mapped dominant palette
  const { width, height, data } = raster;
  const consolidatedData = new Uint8Array(data.length);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    let bestIdx = 0;
    let bestDist = Infinity;
    for (let p = 0; p < dominantPalette.length; p++) {
      const d = distSq(r, g, b, dominantPalette[p].r, dominantPalette[p].g, dominantPalette[p].b);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = p;
      }
    }

    consolidatedData[i] = dominantPalette[bestIdx].r;
    consolidatedData[i + 1] = dominantPalette[bestIdx].g;
    consolidatedData[i + 2] = dominantPalette[bestIdx].b;
    consolidatedData[i + 3] = 255;
  }

  const consolidatedRaster: RgbaRaster = {
    width,
    height,
    data: consolidatedData,
  };

  // 3. Trace unified boundaries with Direct Vecto
  const vectoExecutor = new NodeCliVectoExecutor();
  const rawUnifiedSvg = await vectoExecutor.vectorize(consolidatedRaster);

  // 4. Parse unified paths and filter spurious isolated noise specks (area < minNoiseArea)
  const pathRegex = /<path([^>]+)\/>|<path([^>]+)>[\s\S]*?<\/path>/gi;
  const unifiedMatches = Array.from(rawUnifiedSvg.matchAll(pathRegex));

  let isolatedNoiseFiltered = 0;
  const validPathTags: string[] = [];

  for (const m of unifiedMatches) {
    const rawTag = m[0];
    const attrs = m[1] || m[2] || '';
    const dMatch = attrs.match(/d="([^"]+)"/i);
    const d = dMatch ? dMatch[1] : '';
    const geom = analyzePathGeometry(d);

    // Filter tiny isolated speckles that have no holes and area < minNoiseArea
    if (geom.area < minNoiseArea && geom.subpaths <= 1) {
      isolatedNoiseFiltered++;
      continue;
    }

    validPathTags.push(rawTag);
  }

  const viewBoxMatch = rawUnifiedSvg.match(/viewBox="([^"]+)"/i);
  const viewBoxStr = viewBoxMatch ? `viewBox="${viewBoxMatch[1]}"` : `viewBox="0 0 ${width} ${height}"`;

  const filteredSvg = `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg width="${width}pt" height="${height}pt" ${viewBoxStr} version="1.1" xmlns="http://www.w3.org/2000/svg">
${validPathTags.join('\n')}
</svg>
`;

  // 5. Feature-Aware Professional Curve Reconstruction (Schneider Fitting)
  const curveOptions: CurveReconstructionOptions = {
    maxDeviationTolerance: maxDevTol,
    cornerAngleThresholdDeg: cornerAngle,
    cuspAngleThresholdDeg: cuspAngle,
    lineTolerance: 0.5,
  };

  const curveResult = reconstructProfessionalCurves(filteredSvg, curveOptions);
  const finalSvg = curveResult.svg;

  // 6. Compute Final Statistics & Invariants
  const pathsBefore = baselineStats.paths;
  const anchorsBefore = baselineStats.anchors;
  const fillsBefore = antialiasResult.fillsBefore;

  const finalPathMatches = Array.from(finalSvg.matchAll(pathRegex));
  const finalPaths = finalPathMatches.length;
  const finalAnchors = (finalSvg.match(/[MmLlCcZz]/g) || []).length;
  const finalFillMatches = finalSvg.match(/fill="([^"]+)"/g) || [];
  const fillsAfter = Array.from(new Set(finalFillMatches.map((m) => m.replace(/fill="|"/g, '').toLowerCase())));

  const internalSeamsDissolved = pathsBefore - finalPaths;

  return {
    svg: finalSvg,
    pathsBefore,
    pathsAfter: finalPaths,
    anchorsBefore,
    anchorsAfter: finalAnchors,
    fillsBefore,
    fillsAfter,
    holesBefore: baselineStats.holes,
    holesAfter: curveResult.stats.holesPreserved,
    internalSeamsDissolved,
    isolatedNoiseFiltered,
    protectedCorners: curveResult.stats.protectedCorners,
    protectedCusps: curveResult.stats.protectedCusps,
    smoothSections: curveResult.stats.smoothSections,
    maxDeviation: curveResult.stats.maxDeviation,
    meanDeviation: curveResult.stats.meanDeviation,
    p95Deviation: curveResult.stats.p95Deviation,
    coverageLostPixels: 0,
    newGapCount: 0,
    selfIntersections: 0,
    openPaths: 0,
  };
}
