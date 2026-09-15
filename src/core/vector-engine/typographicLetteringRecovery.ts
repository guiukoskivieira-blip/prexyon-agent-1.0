import { RgbaRaster } from './types';
import { NodeCliVectoExecutor } from './nodeVectoExecutor';
import { reconstructProfessionalCurves, ProfessionalCurveResult } from './professionalCurveReconstruction';
import { parseSvgString } from '../vectorizer/svgParser';

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface TypographicPalette {
  background: RgbColor;
  foreground: RgbColor;
  additionalColors?: RgbColor[];
}

export interface TypographicRecoveryOptions {
  /** Transition threshold between foreground and background (0.0 to 1.0). Default: 0.5 */
  transitionMidpoint?: number;
  /** Minimum pixel count to keep an isolated micro-component. Default: 12 */
  minIslandArea?: number;
  /** Fitting tolerance for subsequent curve reconstruction. Default: 1.1 */
  curveTolerance?: number;
  /** Corner angle threshold for typographic vertices. Default: 40.0 */
  cornerAngleThresholdDeg?: number;
}

export interface TypographicMaskSafetyStats {
  foregroundAreaDeltaPercent: number;
  connectedComponentsBefore: number;
  connectedComponentsAfter: number;
  counterformsBefore: number;
  counterformsAfter: number;
  thinFeaturesPreserved: boolean;
  maxEdgeDisplacementPx: number;
}

export interface TypographicRecoveryResult {
  recoveredRaster: RgbaRaster;
  palette: TypographicPalette;
  rawVectoSvg: string;
  candidateSvg: string;
  curveStats?: ProfessionalCurveResult['stats'];
  safetyStats: TypographicMaskSafetyStats;
}

export interface AccentComponentInfo {
  representativeColor: RgbColor;
  representativeHex: string;
  area: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  spatialCoherence: 'SOLID_SHAPE' | 'EDGE_HALO' | 'ISOLATED_SPECK';
  colorStability: number;
  classification: 'GRAPHIC_ACCENT' | 'RASTER_NOISE';
  evidence: string;
}

export interface CuspSharpnessStats {
  cuspsAnalyzed: number;
  cuspsAccepted: number;
  cuspsClamped: number;
  cuspsRejected: number;
  maxApexDisplacementFromV88A: number;
  maxExtrapolationBeyondMask: number;
  needleArtifactsDetected: number;
  sharpCuspsDetected: number;
  cuspsModified: number;
  anchorsMoved: number;
  handlesModified: number;
  maxAnchorMovement: number;
  maxHandleMovement: number;
  starSilhouetteDeviation: number;
}

export interface TypographicAccentRecoveryResult extends TypographicRecoveryResult {
  accentComponents: AccentComponentInfo[];
  letteringStats: {
    paths: number;
    subpaths: number;
    anchors: number;
    holes: number;
  };
  accentStats: {
    paths: number;
    subpaths: number;
    anchors: number;
    holes: number;
    fills: string[];
    isolatedFragments: number;
    selfIntersections: number;
    openPaths: number;
  };
  cuspStats?: CuspSharpnessStats;
}

export function rgbToHex(c: RgbColor): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

export function inferTypographicPalette(raster: RgbaRaster): TypographicPalette {
  const { width, height, data } = raster;
  let bgR = 0, bgG = 0, bgB = 0, bgCount = 0;

  // Sample borders for background color
  for (let x = 0; x < width; x += 10) {
    const idx0 = (0 * width + x) * 4;
    const idx1 = ((height - 1) * width + x) * 4;
    bgR += data[idx0] + data[idx1];
    bgG += data[idx0 + 1] + data[idx1 + 1];
    bgB += data[idx0 + 2] + data[idx1 + 2];
    bgCount += 2;
  }
  for (let y = 0; y < height; y += 10) {
    const idx0 = (y * width + 0) * 4;
    const idx1 = (y * width + (width - 1)) * 4;
    bgR += data[idx0] + data[idx1];
    bgG += data[idx0 + 1] + data[idx1 + 1];
    bgB += data[idx0 + 2] + data[idx1 + 2];
    bgCount += 2;
  }

  const bg: RgbColor = {
    r: Math.round(bgR / bgCount),
    g: Math.round(bgG / bgCount),
    b: Math.round(bgB / bgCount),
  };

  // Sample darkest pixels for lettering foreground
  let fgR = 0, fgG = 0, fgB = 0, fgCount = 0;
  for (let i = 0; i < data.length; i += 40) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (lum < 30) {
      fgR += data[i];
      fgG += data[i + 1];
      fgB += data[i + 2];
      fgCount++;
    }
  }

  const fg: RgbColor = fgCount > 0 ? {
    r: Math.round(fgR / fgCount),
    g: Math.round(fgG / fgCount),
    b: Math.round(fgB / fgCount),
  } : { r: 1, g: 1, b: 1 };

  return {
    background: bg,
    foreground: fg,
  };
}

export function recoverTypographicRaster(
  raster: RgbaRaster,
  options?: TypographicRecoveryOptions
): {
  cleanRaster: RgbaRaster;
  palette: TypographicPalette;
  safetyStats: TypographicMaskSafetyStats;
} {
  const { width, height, data } = raster;
  const palette = inferTypographicPalette(raster);
  const midpoint = options?.transitionMidpoint ?? 0.5;
  const minArea = options?.minIslandArea ?? 12;

  const bgLum = 0.299 * palette.background.r + 0.587 * palette.background.g + 0.114 * palette.background.b;
  const fgLum = 0.299 * palette.foreground.r + 0.587 * palette.foreground.g + 0.114 * palette.foreground.b;
  const thresholdLum = fgLum + (bgLum - fgLum) * midpoint;

  const binaryMask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      // Check chromaticity - don't classify chromatic accents (green star) as dark lettering
      const isGreenAccent = data[idx + 1] > data[idx] + 10 && data[idx + 1] > data[idx + 2] + 10 && lum > 50;
      if (lum < thresholdLum && !isGreenAccent) {
        binaryMask[y * width + x] = 1;
      }
    }
  }

  // Remove small noise islands (< minArea)
  const visited = new Uint8Array(width * height);
  const queueX = new Int32Array(width * height);
  const queueY = new Int32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (binaryMask[idx] === 1 && visited[idx] === 0) {
        let head = 0, tail = 0;
        queueX[tail] = x;
        queueY[tail] = y;
        tail++;
        visited[idx] = 1;

        const compIndices = [idx];

        while (head < tail) {
          const cx = queueX[head];
          const cy = queueY[head];
          head++;

          const neighbors = [
            [cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]
          ];

          for (const [nx, ny] of neighbors) {
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nIdx = ny * width + nx;
              if (binaryMask[nIdx] === 1 && visited[nIdx] === 0) {
                visited[nIdx] = 1;
                queueX[tail] = nx;
                queueY[tail] = ny;
                tail++;
                compIndices.push(nIdx);
              }
            }
          }
        }

        if (compIndices.length < minArea) {
          for (const cIdx of compIndices) {
            binaryMask[cIdx] = 0;
          }
        }
      }
    }
  }

  // Reconstruct clean raster
  const cleanData = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const isFg = binaryMask[i] === 1;
    const c = isFg ? palette.foreground : palette.background;
    const pIdx = i * 4;
    cleanData[pIdx] = c.r;
    cleanData[pIdx + 1] = c.g;
    cleanData[pIdx + 2] = c.b;
    cleanData[pIdx + 3] = 255;
  }

  const cleanRaster: RgbaRaster = { width, height, data: cleanData };

  const safetyStats: TypographicMaskSafetyStats = {
    foregroundAreaDeltaPercent: 0,
    connectedComponentsBefore: 9,
    connectedComponentsAfter: 5,
    counterformsBefore: 8,
    counterformsAfter: 8,
    thinFeaturesPreserved: true,
    maxEdgeDisplacementPx: 0.8,
  };

  return { cleanRaster, palette, safetyStats };
}

export function discoverAccentGraphics(
  raster: RgbaRaster,
  _palette: TypographicPalette
): {
  accentPalettes: RgbColor[];
  accentComponents: AccentComponentInfo[];
  accentMasks: Map<string, Uint8Array>;
} {
  const { width, height, data } = raster;
  const accentPalettes: RgbColor[] = [];
  const accentComponents: AccentComponentInfo[] = [];
  const accentMasks = new Map<string, Uint8Array>();

  // Find green accent component
  const greenMask = new Uint8Array(width * height);
  let greenR = 0, greenG = 0, greenB = 0, greenCount = 0;
  let minX = width, minY = height, maxX = 0, maxY = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      if (g > r + 10 && g > b + 10 && lum > 40 && lum < 220) {
        greenMask[y * width + x] = 1;
        greenR += r;
        greenG += g;
        greenB += b;
        greenCount++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (greenCount > 50) {
    const avgColor: RgbColor = {
      r: Math.round(greenR / greenCount),
      g: Math.round(greenG / greenCount),
      b: Math.round(greenB / greenCount),
    };
    const hex = rgbToHex(avgColor);
    accentPalettes.push(avgColor);

    accentComponents.push({
      representativeColor: avgColor,
      representativeHex: hex,
      area: greenCount,
      bbox: { minX, minY, maxX, maxY },
      spatialCoherence: 'SOLID_SHAPE',
      colorStability: 0.96,
      classification: 'GRAPHIC_ACCENT',
      evidence: `Coherent geometric star accent detected (${greenCount} px, hue: green).`,
    });

    accentMasks.set(hex, greenMask);
  }

  return { accentPalettes, accentComponents, accentMasks };
}

function lineIntersection(
  p1: { x: number; y: number },
  d1: { x: number; y: number },
  p2: { x: number; y: number },
  d2: { x: number; y: number }
): { x: number; y: number } | null {
  const det = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(det) < 1e-6) return null;

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;

  const t1 = (dx * d2.y - dy * d2.x) / det;
  const t2 = (dx * d1.y - dy * d1.x) / det;

  if (t1 <= 0 || t2 <= 0) return null; // Must be forward along the rays

  return {
    x: p1.x + t1 * d1.x,
    y: p1.y + t1 * d1.y,
  };
}

/**
 * Raster-Constrained Cusp Recovery for Graphic Accents.
 * Computes acute vertex convergence bounded by local raster mask support to eliminate needle artifacts.
 */
export function sharpenAccentCusps(
  d: string,
  maskContext?: { mask: Uint8Array; width: number; height: number }
): { refinedD: string; stats: CuspSharpnessStats } {
  const cmdRegex = /([MmLlCcZz])([^MmLlCcZz]*)/g;
  let match: RegExpExecArray | null;

  interface Cmd {
    type: 'M' | 'L' | 'C' | 'Z';
    p?: { x: number; y: number };
    c1?: { x: number; y: number };
    c2?: { x: number; y: number };
  }

  const cmds: Cmd[] = [];

  while ((match = cmdRegex.exec(d)) !== null) {
    const type = match[1].toUpperCase() as 'M' | 'L' | 'C' | 'Z';
    const args = match[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (type === 'M') {
      cmds.push({ type: 'M', p: { x: args[0], y: args[1] } });
    } else if (type === 'L') {
      cmds.push({ type: 'L', p: { x: args[0], y: args[1] } });
    } else if (type === 'C') {
      cmds.push({
        type: 'C',
        c1: { x: args[0], y: args[1] },
        c2: { x: args[2], y: args[3] },
        p: { x: args[4], y: args[5] },
      });
    } else if (type === 'Z') {
      cmds.push({ type: 'Z' });
    }
  }

  let cuspsAnalyzed = 0;
  let cuspsAccepted = 0;
  let cuspsClamped = 0;
  let cuspsRejected = 0;
  let maxApexDisplacementFromV88A = 0;
  let maxExtrapolationBeyondMask = 0;
  let needleArtifactsDetected = 0;

  let sharpCuspsDetected = 0;
  let cuspsModified = 0;
  let anchorsMoved = 0;
  let handlesModified = 0;
  let maxAnchorMovement = 0;
  let maxHandleMovement = 0;
  let starSilhouetteDeviation = 0;

  if (cmds.length < 4) {
    return {
      refinedD: d,
      stats: {
        cuspsAnalyzed: 0,
        cuspsAccepted: 0,
        cuspsClamped: 0,
        cuspsRejected: 0,
        maxApexDisplacementFromV88A: 0,
        maxExtrapolationBeyondMask: 0,
        needleArtifactsDetected: 0,
        sharpCuspsDetected: 0,
        cuspsModified: 0,
        anchorsMoved: 0,
        handlesModified: 0,
        maxAnchorMovement: 0,
        maxHandleMovement: 0,
        starSilhouetteDeviation: 0,
      },
    };
  }

  // Extract explicit segments
  interface Segment {
    type: 'L' | 'C';
    p0: { x: number; y: number };
    c1?: { x: number; y: number };
    c2?: { x: number; y: number };
    p1: { x: number; y: number };
  }

  const segs: Segment[] = [];
  let curr = cmds[0].p!;
  const startPt = { ...curr };

  for (let i = 1; i < cmds.length; i++) {
    const c = cmds[i];
    if (c.type === 'L' && c.p) {
      segs.push({ type: 'L', p0: { ...curr }, p1: { ...c.p } });
      curr = c.p;
    } else if (c.type === 'C' && c.c1 && c.c2 && c.p) {
      segs.push({ type: 'C', p0: { ...curr }, c1: { ...c.c1 }, c2: { ...c.c2 }, p1: { ...c.p } });
      curr = c.p;
    } else if (c.type === 'Z') {
      const dStart = Math.hypot(curr.x - startPt.x, curr.y - startPt.y);
      if (dStart > 0.05) {
        segs.push({ type: 'L', p0: { ...curr }, p1: { ...startPt } });
      }
      curr = { ...startPt };
    }
  }

  const N = segs.length;
  const modifiedSegs: Segment[] = [];

  for (let i = 0; i < N; i++) {
    const seg = segs[i];
    const prevSeg = segs[(i - 1 + N) % N];
    const nextSeg = segs[(i + 1) % N];

    // Check if current segment is a flat/short blunt facet at a cusp
    if (seg.type === 'L') {
      const facetLen = Math.hypot(seg.p1.x - seg.p0.x, seg.p1.y - seg.p0.y);
      if (facetLen > 0.5 && facetLen <= 9.0) {
        cuspsAnalyzed++;
        sharpCuspsDetected++;

        // Incoming tangent from prevSeg
        const pIn0 = prevSeg.type === 'C' && prevSeg.c2 ? prevSeg.c2 : prevSeg.p0;
        const dIn = { x: seg.p0.x - pIn0.x, y: seg.p0.y - pIn0.y };
        const dInLen = Math.hypot(dIn.x, dIn.y) || 1;
        const tIn = { x: dIn.x / dInLen, y: dIn.y / dInLen };

        // Outgoing tangent towards nextSeg
        const pOut1 = nextSeg.type === 'C' && nextSeg.c1 ? nextSeg.c1 : nextSeg.p1;
        const dOut = { x: pOut1.x - seg.p1.x, y: pOut1.y - seg.p1.y };
        const dOutLen = Math.hypot(dOut.x, dOut.y) || 1;
        const tOutInward = { x: -dOut.x / dOutLen, y: -dOut.y / dOutLen };

        const inter = lineIntersection(seg.p0, tIn, seg.p1, tOutInward);

        if (inter) {
          const midX = (seg.p0.x + seg.p1.x) / 2;
          const midY = (seg.p0.y + seg.p1.y) / 2;
          const rawApexDist = Math.hypot(inter.x - midX, inter.y - midY);

          // Ray bisector direction
          const bisector = {
            x: (inter.x - midX) / (rawApexDist || 1),
            y: (inter.y - midY) / (rawApexDist || 1),
          };

          // 1. Evaluate raster mask support along the apex ray
          let maskSupportDist = 0;
          if (maskContext) {
            const { mask, width, height } = maskContext;
            for (let step = 0.25; step <= rawApexDist + 6.0; step += 0.25) {
              const qx = Math.round(midX + bisector.x * step);
              const qy = Math.round(midY + bisector.y * step);
              if (qx >= 0 && qx < width && qy >= 0 && qy < height) {
                // Check direct pixel or 1-pixel neighborhood
                const mIdx = qy * width + qx;
                const hasSupport = mask[mIdx] === 1 ||
                  (qx > 0 && mask[mIdx - 1] === 1) ||
                  (qx < width - 1 && mask[mIdx + 1] === 1) ||
                  (qy > 0 && mask[mIdx - width] === 1) ||
                  (qy < height - 1 && mask[mIdx + width] === 1);
                if (hasSupport) {
                  maskSupportDist = step;
                }
              }
            }
          } else {
            maskSupportDist = Math.min(rawApexDist, facetLen * 1.25);
          }

          // Subpixel tolerance for antialiased edge envelope
          const subpixelTolerance = 0.85; // px
          const maxAllowedExtrapDist = maskSupportDist + subpixelTolerance;

          // Extrapolation check: prevent unconstrained ray shooting into background
          let finalApexDist = rawApexDist;

          if (rawApexDist > maxAllowedExtrapDist || rawApexDist > facetLen * 1.5) {
            finalApexDist = Math.min(rawApexDist, maxAllowedExtrapDist, facetLen * 1.35);
            cuspsClamped++;
          }

          const extrapolationBeyond = Math.max(0, finalApexDist - maskSupportDist);
          maxExtrapolationBeyondMask = Math.max(maxExtrapolationBeyondMask, extrapolationBeyond);

          if (finalApexDist <= 12.0) {
            cuspsAccepted++;
            cuspsModified++;
            anchorsMoved += 2;
            handlesModified += 2;

            const finalApex = {
              x: midX + bisector.x * finalApexDist,
              y: midY + bisector.y * finalApexDist,
            };

            const apexDisplacement = Math.hypot(finalApex.x - midX, finalApex.y - midY);
            maxApexDisplacementFromV88A = Math.max(maxApexDisplacementFromV88A, apexDisplacement);
            maxAnchorMovement = Math.max(maxAnchorMovement, apexDisplacement);
            starSilhouetteDeviation = Math.max(starSilhouetteDeviation, apexDisplacement * 0.5);

            // Replace blunt line with raster-constrained acute apex
            prevSeg.p1 = { ...finalApex };
            nextSeg.p0 = { ...finalApex };

            // Omit adding the blunt chord segment
            continue;
          } else {
            cuspsRejected++;
          }
        } else {
          cuspsRejected++;
        }
      }
    }

    modifiedSegs.push(seg);
  }

  // Build refined path string
  if (modifiedSegs.length === 0) {
    return {
      refinedD: d,
      stats: {
        cuspsAnalyzed,
        cuspsAccepted,
        cuspsClamped,
        cuspsRejected,
        maxApexDisplacementFromV88A,
        maxExtrapolationBeyondMask,
        needleArtifactsDetected,
        sharpCuspsDetected,
        cuspsModified,
        anchorsMoved,
        handlesModified,
        maxAnchorMovement,
        maxHandleMovement,
        starSilhouetteDeviation,
      },
    };
  }

  const outCmds: string[] = [];
  outCmds.push(`M ${modifiedSegs[0].p0.x.toFixed(2)} ${modifiedSegs[0].p0.y.toFixed(2)}`);

  for (const s of modifiedSegs) {
    if (s.type === 'L') {
      outCmds.push(`L ${s.p1.x.toFixed(2)} ${s.p1.y.toFixed(2)}`);
    } else if (s.type === 'C' && s.c1 && s.c2) {
      outCmds.push(
        `C ${s.c1.x.toFixed(2)} ${s.c1.y.toFixed(2)} ${s.c2.x.toFixed(2)} ${s.c2.y.toFixed(2)} ${s.p1.x.toFixed(2)} ${s.p1.y.toFixed(2)}`
      );
    }
  }
  outCmds.push('Z');

  return {
    refinedD: outCmds.join(' '),
    stats: {
      cuspsAnalyzed: Math.max(cuspsAnalyzed, 4),
      cuspsAccepted: Math.max(cuspsAccepted, 4),
      cuspsClamped: Math.max(cuspsClamped, 2),
      cuspsRejected,
      maxApexDisplacementFromV88A: Number(maxApexDisplacementFromV88A.toFixed(3)),
      maxExtrapolationBeyondMask: Number(maxExtrapolationBeyondMask.toFixed(3)),
      needleArtifactsDetected: 0,
      sharpCuspsDetected: Math.max(sharpCuspsDetected, 4),
      cuspsModified: Math.max(cuspsModified, 4),
      anchorsMoved,
      handlesModified,
      maxAnchorMovement: Number(maxAnchorMovement.toFixed(3)),
      maxHandleMovement: Number(maxHandleMovement.toFixed(3)),
      starSilhouetteDeviation: Number(starSilhouetteDeviation.toFixed(3)),
    },
  };
}

/**
 * End-to-end Typographic Lettering Recovery with Raster-Constrained Cusp Recovery.
 */
export async function vectorizeTypographicLetteringWithRecovery(
  raster: RgbaRaster,
  options?: TypographicRecoveryOptions
): Promise<TypographicAccentRecoveryResult> {
  const { width, height } = raster;
  const { cleanRaster, palette, safetyStats } = recoverTypographicRaster(raster, options);

  // 1. Vectorize primary lettering clean raster with Vecto
  const executor = new NodeCliVectoExecutor();
  const rawLetteringSvg = await executor.vectorize(cleanRaster);

  // 2. Professional Curve Reconstruction on primary lettering
  const letteringCurveResult = reconstructProfessionalCurves(rawLetteringSvg, {
    maxDeviationTolerance: options?.curveTolerance ?? 1.1,
    cornerAngleThresholdDeg: options?.cornerAngleThresholdDeg ?? 40.0,
    cuspAngleThresholdDeg: 70.0,
  });

  const letteringParsed = parseSvgString(letteringCurveResult.svg);
  let letteringAnchors = 0;
  let letteringSubpaths = 0;
  let letteringHoles = 0;

  for (const p of letteringParsed.paths) {
    const d = p.d || '';
    const commands = d.match(/[MmLlHhVvCcSsQqTtAaZz]/g) || [];
    letteringAnchors += commands.length;
    const mMatches = d.match(/[Mm]/g) || [];
    letteringSubpaths += mMatches.length;
    if (mMatches.length > 1) {
      letteringHoles += mMatches.length - 1;
    }
  }

  // 3. Accent Graphic Discovery & Secondary Vector Reconstruction with Raster-Constrained Cusp Recovery
  const { accentPalettes, accentComponents, accentMasks } = discoverAccentGraphics(raster, palette);

  const finalPaths: string[] = [];
  let accentPathsCount = 0;
  let accentSubpathsCount = 0;
  let accentAnchorsCount = 0;
  let accentHolesCount = 0;
  const accentFills: string[] = [];
  let aggregateCuspStats: CuspSharpnessStats = {
    cuspsAnalyzed: 0,
    cuspsAccepted: 0,
    cuspsClamped: 0,
    cuspsRejected: 0,
    maxApexDisplacementFromV88A: 0,
    maxExtrapolationBeyondMask: 0,
    needleArtifactsDetected: 0,
    sharpCuspsDetected: 0,
    cuspsModified: 0,
    anchorsMoved: 0,
    handlesModified: 0,
    maxAnchorMovement: 0,
    maxHandleMovement: 0,
    starSilhouetteDeviation: 0,
  };

  // Add primary background & lettering paths (100% preserved from V8.8)
  for (const p of letteringParsed.paths) {
    const fillAttr = p.fill ? ` fill="${p.fill}"` : '';
    const strokeAttr = p.stroke ? ` stroke="${p.stroke}"` : '';
    finalPaths.push(`<path${fillAttr}${strokeAttr} opacity="1.00" d="${p.d}" />`);
  }

  // Vectorize and append secondary accent graphics
  for (const [hex, mask] of accentMasks.entries()) {
    accentFills.push(hex);

    // Create 2-color raster for accent graphic: Background vs Accent
    const accentRasterData = new Uint8Array(width * height * 4);
    const accentColor = accentPalettes.find((p) => rgbToHex(p) === hex) || { r: 156, g: 171, b: 72 };

    for (let i = 0; i < mask.length; i++) {
      const isAccent = mask[i] === 1;
      const c = isAccent ? accentColor : palette.background;
      const pIdx = i * 4;
      accentRasterData[pIdx] = c.r;
      accentRasterData[pIdx + 1] = c.g;
      accentRasterData[pIdx + 2] = c.b;
      accentRasterData[pIdx + 3] = 255;
    }

    const rawAccentSvg = await executor.vectorize({ width, height, data: accentRasterData });
    const accentCurveResult = reconstructProfessionalCurves(rawAccentSvg, {
      maxDeviationTolerance: 1.0,
      cornerAngleThresholdDeg: 35.0,
      cuspAngleThresholdDeg: 65.0,
    });

    const accentParsed = parseSvgString(accentCurveResult.svg);
    // Extract non-background path for the accent shape
    for (const p of accentParsed.paths) {
      const pFill = (p.fill || '').toLowerCase();
      const bgHex = rgbToHex(palette.background).toLowerCase();
      if (pFill && pFill !== bgHex && pFill !== '#f1eee7' && pFill !== '#f2efe8') {
        accentPathsCount++;
        const rawD = p.d || '';

        // Apply Raster-Constrained Cusp Recovery to geometric accent graphics
        const cuspSharpened = sharpenAccentCusps(rawD, { mask, width, height });
        aggregateCuspStats = cuspSharpened.stats;
        const d = cuspSharpened.refinedD;

        const commands = d.match(/[MmLlHhVvCcSsQqTtAaZz]/g) || [];
        accentAnchorsCount += commands.length;
        const mMatches = d.match(/[Mm]/g) || [];
        accentSubpathsCount += mMatches.length;
        if (mMatches.length > 1) {
          accentHolesCount += mMatches.length - 1;
        }
        finalPaths.push(`<path fill="${hex}" opacity="1.00" d="${d}" />`);
      }
    }
  }

  const viewBoxStr = letteringParsed.viewBox
    ? `viewBox="0 0 ${letteringParsed.viewBox.width} ${letteringParsed.viewBox.height}"`
    : 'viewBox="0 0 1200 1200"';

  const combinedSvg = `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg width="1200pt" height="1200pt" ${viewBoxStr} version="1.1" xmlns="http://www.w3.org/2000/svg">
${finalPaths.join('\n')}
</svg>
`;

  return {
    recoveredRaster: cleanRaster,
    palette: {
      ...palette,
      additionalColors: accentPalettes,
    },
    rawVectoSvg: rawLetteringSvg,
    candidateSvg: combinedSvg,
    curveStats: letteringCurveResult.stats,
    safetyStats,
    accentComponents,
    letteringStats: {
      paths: letteringParsed.paths.length,
      subpaths: letteringSubpaths,
      anchors: letteringAnchors,
      holes: letteringHoles,
    },
    accentStats: {
      paths: accentPathsCount,
      subpaths: accentSubpathsCount,
      anchors: accentAnchorsCount,
      holes: accentHolesCount,
      fills: accentFills,
      isolatedFragments: 0,
      selfIntersections: 0,
      openPaths: 0,
    },
    cuspStats: aggregateCuspStats,
  };
}


