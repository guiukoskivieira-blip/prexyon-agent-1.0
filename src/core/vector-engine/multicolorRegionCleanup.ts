/**
 * PRYX ETAPA 8.9A — Multicolor Region Cleanup
 * 
 * Surgical vector post-processor designed to eliminate spurious chromatic residue,
 * degenerate 1D/2D boundary slivers, and JPEG antialiasing micro-islands at color seams
 * WITHOUT modifying or deforming legitimate graphic curves and regions.
 */

export interface MulticolorCleanupOptions {
  /**
   * Minimum area in square pixels for standalone colored paths to be considered legitimate.
   * Degenerate slivers and ringing residue below this threshold are removed.
   * Default: 25.0 px²
   */
  minAreaThreshold?: number;
}

export interface PathAnalysis {
  pathIndex: number;
  rawSvgTag: string;
  fill: string;
  opacity: string;
  d: string;
  area: number;
  subpathCount: number;
  isSpurious: boolean;
  reason?: string;
}

export interface MulticolorCleanupResult {
  cleanedSvg: string;
  removedCount: number;
  preservedCount: number;
  removedPaths: PathAnalysis[];
  preservedPaths: PathAnalysis[];
}

/**
 * Numerically computes the signed area contribution of a cubic Bézier curve segment
 * using polygon chord integration.
 */
function sampleBezierArea(
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
  steps = 16
): number {
  let area = 0;
  let prevX = x0;
  let prevY = y0;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const mt = 1 - t;
    const x = mt * mt * mt * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3;
    const y = mt * mt * mt * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3;
    area += 0.5 * (prevX * y - x * prevY);
    prevX = x;
    prevY = y;
  }
  return area;
}

/**
 * Parses SVG path `d` attribute and computes total absolute area.
 */
export function computePathArea(d: string): { area: number; subpaths: number } {
  // Tokenize path commands
  const commands = d.match(/([a-df-zA-DF-Z])([^a-df-zA-DF-Z]*)/g) || [];
  let totalArea = 0;
  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;
  let subpaths = 0;

  for (const cmdStr of commands) {
    const type = cmdStr[0];
    const args = cmdStr.slice(1).trim().split(/[\s,]+/).map(Number).filter((n) => !isNaN(n));

    if (type === 'M' || type === 'm') {
      subpaths++;
      let x = args[0];
      let y = args[1];
      if (type === 'm') {
        x += currentX;
        y += currentY;
      }
      currentX = x;
      currentY = y;
      startX = x;
      startY = y;
    } else if (type === 'L' || type === 'l') {
      for (let i = 0; i < args.length; i += 2) {
        let x = args[i];
        let y = args[i + 1];
        if (type === 'l') {
          x += currentX;
          y += currentY;
        }
        totalArea += 0.5 * (currentX * y - x * currentY);
        currentX = x;
        currentY = y;
      }
    } else if (type === 'C' || type === 'c') {
      for (let i = 0; i < args.length; i += 6) {
        let x1 = args[i];
        let y1 = args[i + 1];
        let x2 = args[i + 2];
        let y2 = args[i + 3];
        let x3 = args[i + 4];
        let y3 = args[i + 5];
        if (type === 'c') {
          x1 += currentX;
          y1 += currentY;
          x2 += currentX;
          y2 += currentY;
          x3 += currentX;
          y3 += currentY;
        }

        totalArea += sampleBezierArea(currentX, currentY, x1, y1, x2, y2, x3, y3, 16);
        currentX = x3;
        currentY = y3;
      }
    } else if (type === 'Z' || type === 'z') {
      totalArea += 0.5 * (currentX * startY - startX * currentY);
      currentX = startX;
      currentY = startY;
    }
  }

  return { area: Math.abs(totalArea), subpaths };
}

/**
 * Cleans up spurious boundary slivers and chromatic residue from an SVG string.
 */
export function cleanupMulticolorSpuriousRegions(
  svgString: string,
  options: MulticolorCleanupOptions = {}
): MulticolorCleanupResult {
  const minArea = options.minAreaThreshold ?? 25.0;

  // Extract all <path ... /> elements
  const pathRegex = /<path([^>]+)\/>|<path([^>]+)>[\s\S]*?<\/path>/gi;
  const matches = Array.from(svgString.matchAll(pathRegex));

  const removedPaths: PathAnalysis[] = [];
  const preservedPaths: PathAnalysis[] = [];

  let newSvg = svgString;

  for (let idx = 0; idx < matches.length; idx++) {
    const match = matches[idx];
    const rawTag = match[0];
    const attributes = match[1] || match[2] || '';

    const fillMatch = attributes.match(/fill="([^"]+)"/i);
    const fill = fillMatch ? fillMatch[1].toLowerCase() : '#000000';

    const opacityMatch = attributes.match(/opacity="([^"]+)"/i);
    const opacity = opacityMatch ? opacityMatch[1] : '1.00';

    const dMatch = attributes.match(/d="([^"]+)"/i);
    const d = dMatch ? dMatch[1] : '';

    const { area, subpaths } = computePathArea(d);

    // Criteria for spurious boundary sliver:
    // 1. Standalone single-subpath element (subpaths <= 1)
    // 2. Area is below minArea threshold (< 25 px²)
    // 3. Not the primary background (which has multiple subpaths and large area)
    const isSpurious = subpaths <= 1 && area < minArea;

    const analysis: PathAnalysis = {
      pathIndex: idx + 1,
      rawSvgTag: rawTag,
      fill,
      opacity,
      d,
      area,
      subpathCount: subpaths,
      isSpurious,
      reason: isSpurious ? `Micro boundary sliver (area: ${area.toFixed(2)} px² < ${minArea} px²)` : undefined,
    };

    if (isSpurious) {
      removedPaths.push(analysis);
      newSvg = newSvg.replace(rawTag, '');
    } else {
      preservedPaths.push(analysis);
    }
  }

  // Clean up any double blank lines in SVG
  newSvg = newSvg.replace(/(\r?\n){3,}/g, '\n\n').trim() + '\n';

  return {
    cleanedSvg: newSvg,
    removedCount: removedPaths.length,
    preservedCount: preservedPaths.length,
    removedPaths,
    preservedPaths,
  };
}
