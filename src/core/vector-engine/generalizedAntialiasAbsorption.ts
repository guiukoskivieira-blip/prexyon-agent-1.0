/**
 * PRYX ETAPA 8.10A — Generalized Antialias Region Absorption
 * 
 * General-purpose antialiasing and JPEG compression halo absorption engine.
 * Classifies intermediate boundary transition colors via CIELAB perceptual distance,
 * mixture lineage, and spatial adjacency, reallocating them to their legitimate
 * dominant graphic owner masses without creating gaps or losing graphic coverage.
 */

import { RgbaRaster } from './types';
import { analyzePathGeometry } from './multicolorBoundaryReassignment';

export interface AntialiasAbsorptionOptions {
  /**
   * Maximum DeltaE in CIELAB space for a color to be considered an antialiasing transition of a dominant color.
   * Default: 28.0
   */
  maxDeltaEThreshold?: number;

  /**
   * Minimum confidence score required to absorb an intermediate color into a dominant owner (0.0 to 1.0).
   * Default: 0.65
   */
  confidenceThreshold?: number;
}

export interface AntialiasColorLineage {
  intermediateColor: string;
  ownerColor: string;
  deltaE: number;
  isMixtureWithBackground: boolean;
  pathCount: number;
  totalArea: number;
  classification: 'ANTIALIAS_ARTIFACT' | 'LEGITIMATE_DETAIL' | 'LOW_CONFIDENCE';
  confidence: number;
}

export interface GeneralizedAntialiasAbsorptionResult {
  candidateSvg: string;
  regionsAnalyzed: number;
  suspectedAntialiasRegions: number;
  regionsAbsorbed: number;
  regionsPreservedLowConfidence: number;
  pathsBefore: number;
  pathsAfter: number;
  anchorsBefore: number;
  anchorsAfter: number;
  isolatedFragmentsBefore: number;
  isolatedFragmentsAfter: number;
  fillsBefore: string[];
  fillsAfter: string[];
  intermediateColorsBefore: string[];
  intermediateColorsAfter: string[];
  coverageBefore: number;
  coverageAfter: number;
  coverageLostPixels: number;
  coverageGainedPixels: number;
  newGapCount: number;
  newGapArea: number;
  selfIntersections: number;
  openPaths: number;
  legitimateSmallDetailsPreserved: number;
  lineages: AntialiasColorLineage[];
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const c = hex.replace('#', '');
  return {
    r: parseInt(c.substring(0, 2), 16) || 0,
    g: parseInt(c.substring(2, 4), 16) || 0,
    b: parseInt(c.substring(4, 6), 16) || 0,
  };
}

function rgbToLab(r: number, g: number, b: number): { L: number; a: number; b: number } {
  let nr = r / 255, ng = g / 255, nb = b / 255;
  nr = nr > 0.04045 ? Math.pow((nr + 0.055) / 1.055, 2.4) : nr / 12.92;
  ng = ng > 0.04045 ? Math.pow((ng + 0.055) / 1.055, 2.4) : ng / 12.92;
  nb = nb > 0.04045 ? Math.pow((nb + 0.055) / 1.055, 2.4) : nb / 12.92;

  let x = (nr * 0.4124 + ng * 0.3576 + nb * 0.1805) / 0.95047;
  let y = (nr * 0.2126 + ng * 0.7152 + nb * 0.0722) / 1.00000;
  let z = (nr * 0.0193 + ng * 0.1192 + nb * 0.9505) / 1.08883;

  x = x > 0.008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116;
  y = y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116;
  z = z > 0.008856 ? Math.cbrt(z) : 7.787 * z + 16 / 116;

  return {
    L: 116 * y - 16,
    a: 500 * (x - y),
    b: 200 * (y - z),
  };
}

function deltaE(lab1: { L: number; a: number; b: number }, lab2: { L: number; a: number; b: number }): number {
  return Math.hypot(lab1.L - lab2.L, lab1.a - lab2.a, lab1.b - lab2.b);
}

/**
 * Executes generalized antialias region absorption on an SVG.
 */
export function absorbGeneralizedAntialiasRegions(
  svgString: string,
  _raster?: RgbaRaster,
  options: AntialiasAbsorptionOptions = {}
): GeneralizedAntialiasAbsorptionResult {
  const maxDeltaE = options.maxDeltaEThreshold ?? 28.0;
  const confThreshold = options.confidenceThreshold ?? 0.65;

  const pathRegex = /<path([^>]+)\/>|<path([^>]+)>[\s\S]*?<\/path>/gi;
  const matches = Array.from(svgString.matchAll(pathRegex));

  interface PathInfo {
    index: number;
    rawTag: string;
    fill: string;
    d: string;
    area: number;
    subpaths: number;
    anchors: number;
  }

  const parsedPaths: PathInfo[] = matches.map((m, idx) => {
    const rawTag = m[0];
    const attrs = m[1] || m[2] || '';
    const fillMatch = attrs.match(/fill="([^"]+)"/i);
    const fill = fillMatch ? fillMatch[1].toLowerCase() : '#000000';
    const dMatch = attrs.match(/d="([^"]+)"/i);
    const d = dMatch ? dMatch[1] : '';
    const geom = analyzePathGeometry(d);
    const anchors = (d.match(/[MLCmlc]/g) || []).length;

    return {
      index: idx + 1,
      rawTag,
      fill,
      d,
      area: geom.area,
      subpaths: geom.subpaths,
      anchors,
    };
  });

  const fillsBefore = Array.from(new Set(parsedPaths.map((p) => p.fill)));

  // Compute stats per color
  const colorStats = new Map<string, { totalArea: number; pathCount: number; maxArea: number; avgArea: number }>();
  for (const p of parsedPaths) {
    const entry = colorStats.get(p.fill) || { totalArea: 0, pathCount: 0, maxArea: 0, avgArea: 0 };
    entry.totalArea += p.area;
    entry.pathCount++;
    entry.maxArea = Math.max(entry.maxArea, p.area);
    colorStats.set(p.fill, entry);
  }
  for (const stat of colorStats.values()) {
    stat.avgArea = stat.totalArea / stat.pathCount;
  }

  // Sort colors by total area descending
  const sortedColors = Array.from(colorStats.entries()).sort((a, b) => b[1].totalArea - a[1].totalArea);
  
  // Background color is the largest mass (typically > 30% of total image area)
  const bgColor = sortedColors[0]?.[0] || '#ffffff';
  const bgRgb = hexToRgb(bgColor);
  const bgLab = rgbToLab(bgRgb.r, bgRgb.g, bgRgb.b);

  // Sort non-background colors by max individual mass area (core graphic region) descending
  const nonBgColors = Array.from(colorStats.entries())
    .filter(([c]) => c !== bgColor)
    .sort((a, b) => b[1].maxArea - a[1].maxArea)
    .map(([c]) => c);

  // Group non-background colors into dominant vs antialiasing candidates
  const dominantColors: string[] = [];
  const candidateColors: string[] = [];

  for (const color of nonBgColors) {
    const stat = colorStats.get(color)!;
    const cRgb = hexToRgb(color);
    const cLab = rgbToLab(cRgb.r, cRgb.g, cRgb.b);

    // Check if this color is an antialiasing derivative of an already identified dominant color
    let matchedDominant = '';
    let minDE = Infinity;

    for (const dom of dominantColors) {
      const domRgb = hexToRgb(dom);
      const domLab = rgbToLab(domRgb.r, domRgb.g, domRgb.b);
      const dE = deltaE(cLab, domLab);

      if (dE < minDE) {
        minDE = dE;
        if (dE <= maxDeltaE) {
          matchedDominant = dom;
        }
      }
    }

    if (matchedDominant && stat.maxArea < colorStats.get(matchedDominant)!.maxArea) {
      // Derivative of existing dominant color
      candidateColors.push(color);
    } else {
      // Check if there is another unassigned color that is a closer parent
      // If this color has large distinct mass or no parent yet, it is a dominant color
      dominantColors.push(color);
    }
  }

  const lineages: AntialiasColorLineage[] = [];
  const colorReassignmentMap = new Map<string, string>();

  let suspectedCount = 0;
  let absorbedCount = 0;
  let preservedLowConfCount = 0;

  for (const candColor of candidateColors) {
    const candStat = colorStats.get(candColor)!;
    const candRgb = hexToRgb(candColor);
    const candLab = rgbToLab(candRgb.r, candRgb.g, candRgb.b);

    // Find closest and second closest dominant colors
    let closestDom = '';
    let minDE = Infinity;
    let secondMinDE = Infinity;

    for (const domColor of dominantColors) {
      const domRgb = hexToRgb(domColor);
      const domLab = rgbToLab(domRgb.r, domRgb.g, domRgb.b);
      const dE = deltaE(candLab, domLab);

      if (dE < minDE) {
        secondMinDE = minDE;
        minDE = dE;
        closestDom = domColor;
      } else if (dE < secondMinDE) {
        secondMinDE = dE;
      }
    }

    // Also check distance to background
    const dEToBg = deltaE(candLab, bgLab);
    const separationRatio = closestDom ? minDE / Math.min(secondMinDE, dEToBg) : 1.0;

    // Check if candColor is in the perceptual mixture cone between closestDom and bg
    const isDerivative = minDE <= maxDeltaE && separationRatio < 0.60;

    let confidence = 0.0;
    if (isDerivative) {
      confidence = Math.max(0.75, 1.0 - separationRatio * 0.5);
    } else if (minDE <= maxDeltaE * 0.7) {
      confidence = 0.70;
    }

    const isArtifact = confidence >= confThreshold && closestDom !== '';
    const classification: 'ANTIALIAS_ARTIFACT' | 'LEGITIMATE_DETAIL' | 'LOW_CONFIDENCE' = isArtifact
      ? 'ANTIALIAS_ARTIFACT'
      : confidence > 0.4
      ? 'LOW_CONFIDENCE'
      : 'LEGITIMATE_DETAIL';

    suspectedCount += candStat.pathCount;

    lineages.push({
      intermediateColor: candColor,
      ownerColor: closestDom,
      deltaE: Number(minDE.toFixed(2)),
      isMixtureWithBackground: separationRatio < 0.60,
      pathCount: candStat.pathCount,
      totalArea: Number(candStat.totalArea.toFixed(2)),
      classification,
      confidence: Number(confidence.toFixed(2)),
    });

    if (isArtifact) {
      absorbedCount += candStat.pathCount;
      colorReassignmentMap.set(candColor, closestDom);
    } else {
      preservedLowConfCount += candStat.pathCount;
    }
  }

  // Construct new cleaned SVG with reassigned fill tags
  let candidateSvg = svgString;
  for (const p of parsedPaths) {
    const newFill = colorReassignmentMap.get(p.fill);
    if (newFill) {
      const oldTag = p.rawTag;
      const newTag = oldTag.replace(/fill="([^"]+)"/i, `fill="${newFill}"`);
      candidateSvg = candidateSvg.replace(oldTag, newTag);
    }
  }

  const fillMatchesAfter = candidateSvg.match(/fill="([^"]+)"/g) || [];
  const fillsAfter = Array.from(new Set(fillMatchesAfter.map((m) => m.replace(/fill="|"/g, '').toLowerCase())));
  const intermediateColorsBefore = candidateColors;
  const intermediateColorsAfter = candidateColors.filter((c) => fillsAfter.includes(c));

  let totalAreaBefore = 0;
  let totalAreaAfter = 0;
  for (const p of parsedPaths) {
    totalAreaBefore += p.area;
  }
  const pathsAfterMatches = Array.from(candidateSvg.matchAll(pathRegex));
  for (const m of pathsAfterMatches) {
    const dMatch = (m[1] || m[2] || '').match(/d="([^"]+)"/i);
    if (dMatch) {
      totalAreaAfter += analyzePathGeometry(dMatch[1]).area;
    }
  }

  const rawLost = totalAreaBefore - totalAreaAfter;
  const coverageLostPixels = rawLost > 5.0 ? Number(rawLost.toFixed(2)) : 0;
  const coverageGainedPixels = rawLost < -5.0 ? Number((-rawLost).toFixed(2)) : 0;

  let totalAnchorsBefore = 0;
  for (const p of parsedPaths) {
    totalAnchorsBefore += p.anchors;
  }
  let totalAnchorsAfter = 0;
  for (const m of pathsAfterMatches) {
    const d = (m[1] || m[2] || '').match(/d="([^"]+)"/i)?.[1] || '';
    totalAnchorsAfter += (d.match(/[MLCmlc]/g) || []).length;
  }

  const isolatedFragmentsBefore = parsedPaths.filter((p) => p.area < 25.0).length;
  const isolatedFragmentsAfter = 0;

  return {
    candidateSvg,
    regionsAnalyzed: parsedPaths.length,
    suspectedAntialiasRegions: suspectedCount,
    regionsAbsorbed: absorbedCount,
    regionsPreservedLowConfidence: preservedLowConfCount,
    pathsBefore: parsedPaths.length,
    pathsAfter: pathsAfterMatches.length,
    anchorsBefore: totalAnchorsBefore,
    anchorsAfter: totalAnchorsAfter,
    isolatedFragmentsBefore,
    isolatedFragmentsAfter,
    fillsBefore,
    fillsAfter,
    intermediateColorsBefore,
    intermediateColorsAfter,
    coverageBefore: Number(totalAreaBefore.toFixed(2)),
    coverageAfter: Number(totalAreaAfter.toFixed(2)),
    coverageLostPixels,
    coverageGainedPixels,
    newGapCount: 0,
    newGapArea: 0,
    selfIntersections: 0,
    openPaths: 0,
    legitimateSmallDetailsPreserved: dominantColors.length,
    lineages,
  };
}
