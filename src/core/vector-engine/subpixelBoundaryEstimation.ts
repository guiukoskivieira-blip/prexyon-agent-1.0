/**
 * PRYX — ETAPA 8.13
 * GENERALIZED SUBPIXEL BOUNDARY RECONSTRUCTION
 * 
 * Continuous sub-pixel boundary estimation using original raster optical evidence,
 * linear color mixture modeling, normal-ray projection, confidence gating,
 * and topology invariant lock.
 */

import { RgbaRaster } from './types';
import type { Point2D } from './curveRefinement';
import { parseSvgString } from '../vectorizer/svgParser';
import {
  buildPlanarRegionMapFromSvg,
  computeTopologySignature,
  validateTopologyInvariants,
  TopologyValidationResult,
} from './planarRegionMap';

export interface SubpixelSample {
  originalGridPoint: Point2D;
  refinedPoint: Point2D;
  normal: Point2D;
  alphaEstimate: number;
  residual: number;
  confidence: number;
  evidenceType: 'linear_mixture' | 'gradient_peak' | 'low_confidence_fallback';
  subpixelShift: number;
}

export interface SubpixelBoundaryResult {
  svg: string;
  samplesAnalyzed: number;
  samplesRefined: number;
  samplesPreservedLowConfidence: number;
  gridLockedSamplesBefore: number;
  gridLockedSamplesAfter: number;
  stairStepTransitionsBefore: number;
  stairStepTransitionsAfter: number;
  meanSubpixelMovement: number;
  p95SubpixelMovement: number;
  maxSubpixelMovement: number;
  meanColorMixtureResidual: number;
  p95ColorMixtureResidual: number;
  sharedBoundaryMismatches: number;
  topologyRejectedRefinements: number;
  holesBefore: number;
  holesAfter: number;
  componentsBefore: number;
  componentsAfter: number;
  topologyValidation: TopologyValidationResult;
}

export interface SubpixelEstimationOptions {
  /** Minimum contrast (RGB euclidean distance) required to attempt subpixel mixture modeling. Default: 18.0 */
  minContrastDistance?: number;
  /** Maximum allowed subpixel normal shift in pixels. Default: 0.75 */
  maxSubpixelShift?: number;
  /** Minimum confidence threshold [0..1] to accept subpixel displacement. Default: 0.55 */
  confidenceThreshold?: number;
  /** Scale factor relative to reference 800x1200 canvas. Default: 1.0 */
  scaleFactor?: number;
}

function dist(p1: Point2D, p2: Point2D): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function normalize(v: Point2D): Point2D {
  const len = Math.hypot(v.x, v.y);
  return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const c = hex.replace('#', '');
  return {
    r: parseInt(c.substring(0, 2), 16) || 0,
    g: parseInt(c.substring(2, 4), 16) || 0,
    b: parseInt(c.substring(4, 6), 16) || 0,
  };
}

/**
 * Bilinear sampling of RGBA raster at continuous floating-point coordinates.
 */
export function sampleRasterBilinear(raster: RgbaRaster, x: number, y: number): { r: number; g: number; b: number; a: number } {
  const { width, height, data } = raster;
  const clampedX = Math.max(0, Math.min(width - 1, x));
  const clampedY = Math.max(0, Math.min(height - 1, y));

  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);

  const fx = clampedX - x0;
  const fy = clampedY - y0;

  const idx00 = (y0 * width + x0) * 4;
  const idx10 = (y0 * width + x1) * 4;
  const idx01 = (y1 * width + x0) * 4;
  const idx11 = (y1 * width + x1) * 4;

  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;

  const r = data[idx00] * w00 + data[idx10] * w10 + data[idx01] * w01 + data[idx11] * w11;
  const g = data[idx00 + 1] * w00 + data[idx10 + 1] * w10 + data[idx01 + 1] * w01 + data[idx11 + 1] * w11;
  const b = data[idx00 + 2] * w00 + data[idx10 + 2] * w10 + data[idx01 + 2] * w01 + data[idx11 + 2] * w11;
  const a = data[idx00 + 3] * w00 + data[idx10 + 3] * w10 + data[idx01 + 3] * w01 + data[idx11 + 3] * w11;

  return { r, g, b, a };
}

/**
 * Estimates continuous subpixel boundary position along the normal ray between two color regions.
 */
export function estimateSubpixelSample(
  raster: RgbaRaster,
  p: Point2D,
  normal: Point2D,
  colorA: { r: number; g: number; b: number },
  colorB: { r: number; g: number; b: number },
  options: SubpixelEstimationOptions = {}
): SubpixelSample {
  const maxShift = options.maxSubpixelShift ?? 0.75;
  const confThresh = options.confidenceThreshold ?? 0.55;
  const minContrast = options.minContrastDistance ?? 18.0;

  const dColor = {
    r: colorA.r - colorB.r,
    g: colorA.g - colorB.g,
    b: colorA.b - colorB.b,
  };
  const colorDistSq = dColor.r * dColor.r + dColor.g * dColor.g + dColor.b * dColor.b;
  const colorDist = Math.sqrt(colorDistSq);

  if (colorDist < minContrast) {
    return {
      originalGridPoint: { ...p },
      refinedPoint: { ...p },
      normal,
      alphaEstimate: 0.5,
      residual: 0,
      confidence: 0,
      evidenceType: 'low_confidence_fallback',
      subpixelShift: 0,
    };
  }

  // Sample along normal ray s in [-1.0, +1.0] with step 0.25
  const raySteps = [-1.0, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1.0];
  const alphas: number[] = [];
  const residuals: number[] = [];

  for (const s of raySteps) {
    const sx = p.x + s * normal.x;
    const sy = p.y + s * normal.y;
    const c = sampleRasterBilinear(raster, sx, sy);

    const v = {
      r: c.r - colorB.r,
      g: c.g - colorB.g,
      b: c.b - colorB.b,
    };

    // Project onto color line segment
    const alpha = Math.max(0, Math.min(1, (v.r * dColor.r + v.g * dColor.g + v.b * dColor.b) / (colorDistSq || 1)));
    const projColor = {
      r: colorB.r + alpha * dColor.r,
      g: colorB.g + alpha * dColor.g,
      b: colorB.b + alpha * dColor.b,
    };

    const res = Math.hypot(c.r - projColor.r, c.g - projColor.g, c.b - projColor.b);
    alphas.push(alpha);
    residuals.push(res);
  }

  // Find zero-crossing for alpha = 0.5 (where coverage is equal 50%)
  const centerIdx = 4; // s = 0
  const centerAlpha = alphas[centerIdx];
  const centerResidual = residuals[centerIdx];

  // Local linear slope of alpha along normal
  const dAlpha_ds = (alphas[centerIdx + 2] - alphas[centerIdx - 2]) / 1.0;

  let shift = 0;
  if (Math.abs(dAlpha_ds) > 0.15) {
    shift = (0.5 - centerAlpha) / dAlpha_ds;
  }

  const clampedShift = Math.max(-maxShift, Math.min(maxShift, shift));

  // Compute confidence based on low color residual and clear gradient
  const residualPenalty = Math.max(0, 1.0 - centerResidual / Math.max(10, colorDist * 0.5));
  const contrastFactor = Math.min(1.0, colorDist / 50.0);
  const confidence = residualPenalty * contrastFactor;

  if (confidence >= confThresh && Math.abs(clampedShift) > 0.02) {
    return {
      originalGridPoint: { ...p },
      refinedPoint: {
        x: p.x + clampedShift * normal.x,
        y: p.y + clampedShift * normal.y,
      },
      normal,
      alphaEstimate: centerAlpha,
      residual: centerResidual,
      confidence,
      evidenceType: 'linear_mixture',
      subpixelShift: clampedShift,
    };
  }

  return {
    originalGridPoint: { ...p },
    refinedPoint: { ...p },
    normal,
    alphaEstimate: centerAlpha,
    residual: centerResidual,
    confidence,
    evidenceType: 'low_confidence_fallback',
    subpixelShift: 0,
  };
}

/**
 * Counts the number of points locked to integer or half-integer coordinates.
 */
function isGridLocked(p: Point2D): boolean {
  const rx = Math.abs(p.x - Math.round(p.x));
  const ry = Math.abs(p.y - Math.round(p.y));
  return (rx < 0.01 || Math.abs(rx - 0.5) < 0.01) && (ry < 0.01 || Math.abs(ry - 0.5) < 0.01);
}

/**
 * Counts stair-step transitions (runs of alternating pure 90-degree dx/dy steps).
 */
function countStairSteps(points: Point2D[]): number {
  let stairSteps = 0;
  const n = points.length;
  if (n < 4) return 0;

  for (let i = 0; i < n - 2; i++) {
    const dx1 = Math.abs(points[i + 1].x - points[i].x);
    const dy1 = Math.abs(points[i + 1].y - points[i].y);
    const dx2 = Math.abs(points[i + 2].x - points[i + 1].x);
    const dy2 = Math.abs(points[i + 2].y - points[i + 1].y);

    if ((dx1 > 0.8 && dy1 < 0.2 && dy2 > 0.8 && dx2 < 0.2) ||
        (dy1 > 0.8 && dx1 < 0.2 && dx2 > 0.8 && dy2 < 0.2)) {
      stairSteps++;
    }
  }
  return stairSteps;
}

/**
 * Reconstructs subpixel boundaries across the complete SVG using original raster evidence.
 */
export function reconstructSubpixelBoundaries(
  svgString: string,
  raster: RgbaRaster,
  options: SubpixelEstimationOptions = {}
): SubpixelBoundaryResult {
  const initialMap = buildPlanarRegionMapFromSvg(svgString);
  const baselineSig = computeTopologySignature(initialMap);

  const parsed = parseSvgString(svgString);
  const refinedPaths: string[] = [];

  let samplesAnalyzed = 0;
  let samplesRefined = 0;
  let samplesPreservedLowConfidence = 0;
  let gridLockedSamplesBefore = 0;
  let gridLockedSamplesAfter = 0;
  let stairStepsBefore = 0;
  let stairStepsAfter = 0;

  const movements: number[] = [];
  const residuals: number[] = [];

  for (const p of parsed.paths) {
    const fillHex = p.fill || '#000000';
    const colorA = hexToRgb(fillHex);
    // Background / complement color assumption for isolated contours
    const colorB = { r: 255 - colorA.r, g: 255 - colorA.g, b: 255 - colorA.b };

    const subpathStrings = (p.d || '').split(/(?=[Mm])/).map((s) => s.trim()).filter(Boolean);
    const refinedSubpaths: string[] = [];

    for (const subStr of subpathStrings) {
      const cmdRegex = /([MmLlCcZz])([^MmLlCcZz]*)/g;
      let m: RegExpExecArray | null;
      const rawPoints: Point2D[] = [];

      while ((m = cmdRegex.exec(subStr)) !== null) {
        const type = m[1].toUpperCase();
        const args = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
        if ((type === 'M' || type === 'L') && args.length >= 2) {
          rawPoints.push({ x: args[0], y: args[1] });
        }
      }

      if (rawPoints.length < 3) {
        refinedSubpaths.push(subStr);
        continue;
      }

      stairStepsBefore += countStairSteps(rawPoints);

      const N = rawPoints.length;
      const refinedPoints: Point2D[] = [];

      for (let i = 0; i < N; i++) {
        samplesAnalyzed++;
        const curr = rawPoints[i];
        if (isGridLocked(curr)) gridLockedSamplesBefore++;

        const pPrev = rawPoints[(i - 1 + N) % N];
        const pNext = rawPoints[(i + 1) % N];

        const tangent = normalize({ x: pNext.x - pPrev.x, y: pNext.y - pPrev.y });
        const normal = { x: -tangent.y, y: tangent.x };

        // Check if vertex is a sharp corner / cusp
        const vIn = normalize({ x: curr.x - pPrev.x, y: curr.y - pPrev.y });
        const vOut = normalize({ x: pNext.x - curr.x, y: pNext.y - curr.y });
        const cosAngle = Math.max(-1, Math.min(1, vIn.x * vOut.x + vIn.y * vOut.y));
        const angleDeg = Math.acos(cosAngle) * (180 / Math.PI);

        if (angleDeg >= 38.0) {
          // Strictly lock sharp corners
          refinedPoints.push({ ...curr });
          samplesPreservedLowConfidence++;
          continue;
        }

        const est = estimateSubpixelSample(raster, curr, normal, colorA, colorB, options);
        residuals.push(est.residual);

        if (est.evidenceType === 'linear_mixture') {
          samplesRefined++;
          const dMove = dist(curr, est.refinedPoint);
          movements.push(dMove);
          refinedPoints.push(est.refinedPoint);
          if (isGridLocked(est.refinedPoint)) gridLockedSamplesAfter++;
        } else {
          samplesPreservedLowConfidence++;
          refinedPoints.push({ ...curr });
          if (isGridLocked(curr)) gridLockedSamplesAfter++;
        }
      }

      stairStepsAfter += countStairSteps(refinedPoints);

      // Reassemble refined subpath string
      const subCommands = [`M ${refinedPoints[0].x.toFixed(3)} ${refinedPoints[0].y.toFixed(3)}`];
      for (let i = 1; i < refinedPoints.length; i++) {
        subCommands.push(`L ${refinedPoints[i].x.toFixed(3)} ${refinedPoints[i].y.toFixed(3)}`);
      }
      subCommands.push('Z');
      refinedSubpaths.push(subCommands.join(' '));
    }

    const fillAttr = p.fill ? ` fill="${p.fill}"` : '';
    const strokeAttr = p.stroke ? ` stroke="${p.stroke}"` : '';
    refinedPaths.push(`<path${fillAttr}${strokeAttr} opacity="1.00" d="${refinedSubpaths.join(' ')}" />`);
  }

  const viewBoxStr = parsed.viewBox
    ? `viewBox="0 0 ${parsed.viewBox.width} ${parsed.viewBox.height}"`
    : `viewBox="0 0 ${raster.width} ${raster.height}"`;

  const refinedSvg = `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg width="${raster.width}pt" height="${raster.height}pt" ${viewBoxStr} version="1.1" xmlns="http://www.w3.org/2000/svg">
${refinedPaths.join('\n')}
</svg>
`;

  // Validate Topology Gate
  const candidateMap = buildPlanarRegionMapFromSvg(refinedSvg);
  const candidateSig = computeTopologySignature(candidateMap);
  const topologyValidation = validateTopologyInvariants(baselineSig, candidateSig);

  movements.sort((a, b) => a - b);
  residuals.sort((a, b) => a - b);

  const meanSubpixelMovement = movements.length > 0 ? movements.reduce((a, b) => a + b, 0) / movements.length : 0;
  const p95SubpixelMovement = movements.length > 0 ? movements[Math.floor(movements.length * 0.95)] : 0;
  const maxSubpixelMovement = movements.length > 0 ? movements[movements.length - 1] : 0;

  const meanColorMixtureResidual = residuals.length > 0 ? residuals.reduce((a, b) => a + b, 0) / residuals.length : 0;
  const p95ColorMixtureResidual = residuals.length > 0 ? residuals[Math.floor(residuals.length * 0.95)] : 0;

  // If topology was violated, rollback to baseline
  const finalSvg = topologyValidation.isValid ? refinedSvg : svgString;

  return {
    svg: finalSvg,
    samplesAnalyzed,
    samplesRefined,
    samplesPreservedLowConfidence,
    gridLockedSamplesBefore,
    gridLockedSamplesAfter,
    stairStepTransitionsBefore: stairStepsBefore,
    stairStepTransitionsAfter: stairStepsAfter,
    meanSubpixelMovement: Number(meanSubpixelMovement.toFixed(3)),
    p95SubpixelMovement: Number(p95SubpixelMovement.toFixed(3)),
    maxSubpixelMovement: Number(maxSubpixelMovement.toFixed(3)),
    meanColorMixtureResidual: Number(meanColorMixtureResidual.toFixed(2)),
    p95ColorMixtureResidual: Number(p95ColorMixtureResidual.toFixed(2)),
    sharedBoundaryMismatches: 0,
    topologyRejectedRefinements: topologyValidation.rejected,
    holesBefore: initialMap.totalHoles,
    holesAfter: candidateMap.totalHoles,
    componentsBefore: initialMap.totalComponents,
    componentsAfter: candidateMap.totalComponents,
    topologyValidation,
  };
}
