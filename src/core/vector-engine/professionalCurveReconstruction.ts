import { parseSvgString } from '../vectorizer/svgParser';
import type { Point2D } from './curveRefinement';

export interface CurveReconstructionOptions {
  /** Maximum allowed deviation from original contour in pixels. Default: 1.2 */
  maxDeviationTolerance?: number;
  /** Turn angle threshold in degrees to classify a vertex as a sharp corner/cusp. Default: 35.0 */
  cornerAngleThresholdDeg?: number;
  /** Cusp angle threshold in degrees. Default: 70.0 */
  cuspAngleThresholdDeg?: number;
  /** Line collinearity tolerance in pixels. Default: 0.5 */
  lineTolerance?: number;
}

export interface CurveReconstructionStats {
  originalAnchors: number;
  reconstructedAnchors: number;
  originalSegments: number;
  reconstructedSegments: number;
  protectedCorners: number;
  protectedCusps: number;
  smoothSections: number;
  maxDeviation: number;
  meanDeviation: number;
  p95Deviation: number;
  holesPreserved: number;
  selfIntersections: number;
  openPaths: number;
}

export interface ProfessionalCurveResult {
  svg: string;
  stats: CurveReconstructionStats;
}

interface PathCmd {
  type: 'M' | 'L' | 'C' | 'Z';
  p?: Point2D;
  c1?: Point2D;
  c2?: Point2D;
}

function dist(p1: Point2D, p2: Point2D): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function normalize(v: Point2D): Point2D {
  const len = Math.hypot(v.x, v.y);
  return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}

function dot(v1: Point2D, v2: Point2D): number {
  return v1.x * v2.x + v1.y * v2.y;
}

function lerp(p1: Point2D, p2: Point2D, t: number): Point2D {
  return {
    x: p1.x + (p2.x - p1.x) * t,
    y: p1.y + (p2.y - p1.y) * t,
  };
}

function evaluateCubic(p0: Point2D, c1: Point2D, c2: Point2D, p1: Point2D, t: number): Point2D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x: mt3 * p0.x + 3 * mt2 * t * c1.x + 3 * mt * t2 * c2.x + t3 * p1.x,
    y: mt3 * p0.y + 3 * mt2 * t * c1.y + 3 * mt * t2 * c2.y + t3 * p1.y,
  };
}

function pointToLineDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(p, a);

  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const proj = { x: a.x + t * dx, y: a.y + t * dy };
  return dist(p, proj);
}

/**
 * Fits a single cubic Bezier curve to a sequence of points using Schneider least-squares.
 * tangentStart: unit tangent vector at points[0] pointing INTO the curve.
 * tangentEndInward: unit tangent vector at points[last] pointing INTO the curve (towards p0).
 */
function fitSingleCubic(
  points: Point2D[],
  tangentStart: Point2D,
  tangentEndInward: Point2D
): { c1: Point2D; c2: Point2D; maxDev: number; splitIdx: number } {
  const p0 = points[0];
  const p1 = points[points.length - 1];
  const n = points.length;

  if (n <= 2) {
    const third = dist(p0, p1) / 3;
    return {
      c1: { x: p0.x + tangentStart.x * third, y: p0.y + tangentStart.y * third },
      c2: { x: p1.x + tangentEndInward.x * third, y: p1.y + tangentEndInward.y * third },
      maxDev: 0,
      splitIdx: 1,
    };
  }

  // Chord length parameterization
  const u: number[] = [0];
  for (let i = 1; i < n; i++) {
    u.push(u[i - 1] + dist(points[i], points[i - 1]));
  }
  const totalChord = u[n - 1] || 1;
  for (let i = 1; i < n; i++) u[i] /= totalChord;

  // Least squares fit for alpha1 and alpha2
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;

  for (let i = 0; i < n; i++) {
    const t = u[i];
    const mt = 1 - t;
    const b0 = mt * mt * mt;
    const b1 = 3 * mt * mt * t;
    const b2 = 3 * mt * t * t;
    const b3 = t * t * t;

    const a1 = { x: tangentStart.x * b1, y: tangentStart.y * b1 };
    const a2 = { x: tangentEndInward.x * b2, y: tangentEndInward.y * b2 };

    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);

    // Residual without control handle offsets
    const tmp = {
      x: points[i].x - ((b0 + b1) * p0.x + (b2 + b3) * p1.x),
      y: points[i].y - ((b0 + b1) * p0.y + (b2 + b3) * p1.y),
    };

    x0 += dot(a1, tmp);
    x1 += dot(a2, tmp);
  }

  const det = c00 * c11 - c01 * c01;
  let alpha1 = 0;
  let alpha2 = 0;

  if (Math.abs(det) > 1e-9) {
    alpha1 = (x0 * c11 - x1 * c01) / det;
    alpha2 = (c00 * x1 - c01 * x0) / det;
  }

  const chordLen = dist(p0, p1);
  if (alpha1 <= 0 || alpha2 <= 0 || alpha1 > chordLen * 2.0 || alpha2 > chordLen * 2.0) {
    alpha1 = chordLen / 3;
    alpha2 = chordLen / 3;
  }

  const c1 = { x: p0.x + tangentStart.x * alpha1, y: p0.y + tangentStart.y * alpha1 };
  const c2 = { x: p1.x + tangentEndInward.x * alpha2, y: p1.y + tangentEndInward.y * alpha2 };

  // Calculate max deviation and split index
  let maxDev = 0;
  let splitIdx = Math.floor(n / 2);

  for (let i = 1; i < n - 1; i++) {
    const curvePt = evaluateCubic(p0, c1, c2, p1, u[i]);
    const d = dist(points[i], curvePt);
    if (d > maxDev) {
      maxDev = d;
      splitIdx = i;
    }
  }

  return { c1, c2, maxDev, splitIdx };
}

/**
 * Recursively fits minimal cubic Bezier segments or straight lines to a smooth point sequence.
 */
function fitCurveSpanRecursive(
  points: Point2D[],
  tangentStart: Point2D,
  tangentEndInward: Point2D,
  tolerance: number,
  lineTol: number,
  depth = 0
): Array<{ type: 'L' | 'C'; c1?: Point2D; c2?: Point2D; p1: Point2D }> {
  if (points.length < 2) return [];

  const p0 = points[0];
  const p1 = points[points.length - 1];

  // Check if entire span is a straight line
  let isLine = true;
  for (let i = 1; i < points.length - 1; i++) {
    if (pointToLineDistance(points[i], p0, p1) > lineTol) {
      isLine = false;
      break;
    }
  }

  if (isLine || points.length <= 2) {
    return [{ type: 'L', p1 }];
  }

  const fit = fitSingleCubic(points, tangentStart, tangentEndInward);

  // If within tolerance, collapse the whole run of fragmented nodes into 1 single cubic Bezier!
  if (fit.maxDev <= tolerance || depth >= 5 || points.length <= 4) {
    return [{ type: 'C', c1: fit.c1, c2: fit.c2, p1 }];
  }

  // Otherwise, split at maximum deviation point and recursively fit
  const split = Math.max(1, Math.min(points.length - 2, fit.splitIdx));

  // Compute smooth G1 tangent at split point
  const tLeft = points[Math.max(0, split - 2)];
  const tRight = points[Math.min(points.length - 1, split + 2)];
  const tangentSplitForward = normalize({ x: tRight.x - tLeft.x, y: tRight.y - tLeft.y });
  const tangentSplitInward = { x: -tangentSplitForward.x, y: -tangentSplitForward.y };

  const leftSegs = fitCurveSpanRecursive(
    points.slice(0, split + 1),
    tangentStart,
    tangentSplitInward,
    tolerance,
    lineTol,
    depth + 1
  );

  const rightSegs = fitCurveSpanRecursive(
    points.slice(split),
    tangentSplitForward,
    tangentEndInward,
    tolerance,
    lineTol,
    depth + 1
  );

  return [...leftSegs, ...rightSegs];
}

/**
 * Reconstructs a single closed subpath by converting fragmented piecewise commands
 * into long, sweeping, organic cubic Bézier curves and clean lines.
 */
function reconstructSubpath(
  subStr: string,
  options: CurveReconstructionOptions,
  deviationsList: number[],
  statsAccumulator: {
    protectedCorners: number;
    protectedCusps: number;
    smoothSections: number;
    reconstructedSegments: number;
  }
): string {
  const cmdRegex = /([MmLlCcZz])([^MmLlCcZz]*)/g;
  let match: RegExpExecArray | null;
  const cmds: PathCmd[] = [];

  while ((match = cmdRegex.exec(subStr)) !== null) {
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

  if (cmds.length < 3) return subStr;

  // Extract explicit command segments with exact geometry
  interface SegmentInfo {
    type: 'L' | 'C';
    p0: Point2D;
    c1?: Point2D;
    c2?: Point2D;
    p1: Point2D;
  }

  const segments: SegmentInfo[] = [];
  let curr = cmds[0].p!;
  const startPt = { ...curr };

  for (let i = 1; i < cmds.length; i++) {
    const c = cmds[i];
    if (c.type === 'L' && c.p) {
      segments.push({ type: 'L', p0: { ...curr }, p1: { ...c.p } });
      curr = c.p;
    } else if (c.type === 'C' && c.c1 && c.c2 && c.p) {
      segments.push({ type: 'C', p0: { ...curr }, c1: { ...c.c1 }, c2: { ...c.c2 }, p1: { ...c.p } });
      curr = c.p;
    } else if (c.type === 'Z') {
      if (dist(curr, startPt) > 0.05) {
        segments.push({ type: 'L', p0: { ...curr }, p1: { ...startPt } });
      }
      curr = { ...startPt };
    }
  }

  const M = segments.length;
  if (M < 2) return subStr;

  const cornerAngleThresh = options.cornerAngleThresholdDeg ?? 45.0;
  const cuspAngleThresh = options.cuspAngleThresholdDeg ?? 70.0;
  const tolerance = options.maxDeviationTolerance ?? 1.2;
  const lineTol = options.lineTolerance ?? 0.5;

  // 1. Detect and PIN structural feature corners on segment junctions
  const cornerIndices: number[] = [];
  for (let i = 0; i < M; i++) {
    const prevSeg = segments[(i - 1 + M) % M];
    const currSeg = segments[i];
    const junction = currSeg.p0;

    // Incoming tangent at junction
    const tIn = prevSeg.type === 'C' && prevSeg.c2
      ? normalize({ x: junction.x - prevSeg.c2.x, y: junction.y - prevSeg.c2.y })
      : normalize({ x: junction.x - prevSeg.p0.x, y: junction.y - prevSeg.p0.y });

    // Outgoing tangent at junction
    const tOut = currSeg.type === 'C' && currSeg.c1
      ? normalize({ x: currSeg.c1.x - junction.x, y: currSeg.c1.y - junction.y })
      : normalize({ x: currSeg.p1.x - junction.x, y: currSeg.p1.y - junction.y });

    const cosA = Math.max(-1, Math.min(1, dot(tIn, tOut)));
    const angleDeg = Math.acos(cosA) * (180 / Math.PI);

    if (angleDeg >= cornerAngleThresh) {
      cornerIndices.push(i);
      if (angleDeg >= cuspAngleThresh) {
        statsAccumulator.protectedCusps++;
      } else {
        statsAccumulator.protectedCorners++;
      }
    }
  }

  // If no sharp corners (e.g. circle/oval), pick 2 diametric anchors
  if (cornerIndices.length === 0) {
    cornerIndices.push(0, Math.floor(M / 2));
  } else if (cornerIndices.length === 1) {
    cornerIndices.push((cornerIndices[0] + Math.floor(M / 2)) % M);
    cornerIndices.sort((a, b) => a - b);
  }

  statsAccumulator.smoothSections += cornerIndices.length;

  // 2. Reconstruct smooth macro-spans between structural feature corners
  const subpathCommands: string[] = [];
  const firstCornerIdx = cornerIndices[0];
  const firstCornerPt = segments[firstCornerIdx].p0;
  subpathCommands.push(`M ${firstCornerPt.x.toFixed(2)} ${firstCornerPt.y.toFixed(2)}`);

  let currentPen = { ...firstCornerPt };

  for (let c = 0; c < cornerIndices.length; c++) {
    const idx1 = cornerIndices[c];
    const idx2 = cornerIndices[(c + 1) % cornerIndices.length];

    // Collect segments belonging to this macro-span
    const spanSegs: SegmentInfo[] = [];
    if (idx2 > idx1) {
      for (let i = idx1; i < idx2; i++) spanSegs.push(segments[i]);
    } else {
      for (let i = idx1; i < M; i++) spanSegs.push(segments[i]);
      for (let i = 0; i < idx2; i++) spanSegs.push(segments[i]);
    }

    // Dense sampling along the exact curved trajectory of the macro-span
    const densePoints: Point2D[] = [];
    densePoints.push({ ...spanSegs[0].p0 });

    for (const seg of spanSegs) {
      if (seg.type === 'L') {
        const d = dist(seg.p0, seg.p1);
        const steps = Math.max(2, Math.ceil(d / 4.0));
        for (let s = 1; s <= steps; s++) {
          densePoints.push(lerp(seg.p0, seg.p1, s / steps));
        }
      } else if (seg.type === 'C' && seg.c1 && seg.c2) {
        const chord = dist(seg.p0, seg.c1) + dist(seg.c1, seg.c2) + dist(seg.c2, seg.p1);
        const steps = Math.max(4, Math.ceil(chord / 4.0));
        for (let s = 1; s <= steps; s++) {
          densePoints.push(evaluateCubic(seg.p0, seg.c1, seg.c2, seg.p1, s / steps));
        }
      }
    }

    if (densePoints.length < 2) continue;

    const pStart = densePoints[0];
    const pEnd = densePoints[densePoints.length - 1];

    // Compute precise initial and final tangents at the exact boundary
    const firstSeg = spanSegs[0];
    let tangentStart: Point2D;
    if (firstSeg.type === 'C' && firstSeg.c1 && dist(firstSeg.p0, firstSeg.c1) > 0.1) {
      tangentStart = normalize({ x: firstSeg.c1.x - firstSeg.p0.x, y: firstSeg.c1.y - firstSeg.p0.y });
    } else if (densePoints.length > 1) {
      tangentStart = normalize({ x: densePoints[1].x - pStart.x, y: densePoints[1].y - pStart.y });
    } else {
      tangentStart = { x: 1, y: 0 };
    }

    const lastSeg = spanSegs[spanSegs.length - 1];
    let tangentEndInward: Point2D;
    if (lastSeg.type === 'C' && lastSeg.c2 && dist(lastSeg.p1, lastSeg.c2) > 0.1) {
      tangentEndInward = normalize({ x: lastSeg.c2.x - lastSeg.p1.x, y: lastSeg.c2.y - lastSeg.p1.y });
    } else if (densePoints.length > 1) {
      const pPrev = densePoints[densePoints.length - 2];
      tangentEndInward = normalize({ x: pPrev.x - pEnd.x, y: pPrev.y - pEnd.y });
    } else {
      tangentEndInward = { x: -1, y: 0 };
    }

    const fitted = fitCurveSpanRecursive(
      densePoints,
      tangentStart,
      tangentEndInward,
      tolerance,
      lineTol
    );

    // Measure orthogonal geometric error against dense points with fine resolution
    for (const rawPt of densePoints) {
      let minD = 9999;
      let segStart = currentPen;
      for (const seg of fitted) {
        if (seg.type === 'L') {
          minD = Math.min(minD, pointToLineDistance(rawPt, segStart, seg.p1));
        } else if (seg.type === 'C' && seg.c1 && seg.c2) {
          const segLen = dist(segStart, seg.c1) + dist(seg.c1, seg.c2) + dist(seg.c2, seg.p1);
          const sampleSteps = Math.max(32, Math.min(128, Math.ceil(segLen * 2)));
          for (let step = 0; step <= sampleSteps; step++) {
            const cp = evaluateCubic(segStart, seg.c1, seg.c2, seg.p1, step / sampleSteps);
            minD = Math.min(minD, dist(rawPt, cp));
          }
        }
        segStart = seg.p1;
      }
      deviationsList.push(minD);
    }

    for (const seg of fitted) {
      statsAccumulator.reconstructedSegments++;
      if (seg.type === 'L') {
        subpathCommands.push(`L ${seg.p1.x.toFixed(2)} ${seg.p1.y.toFixed(2)}`);
      } else if (seg.type === 'C' && seg.c1 && seg.c2) {
        subpathCommands.push(
          `C ${seg.c1.x.toFixed(2)} ${seg.c1.y.toFixed(2)} ${seg.c2.x.toFixed(2)} ${seg.c2.y.toFixed(2)} ${seg.p1.x.toFixed(2)} ${seg.p1.y.toFixed(2)}`
        );
      }
      currentPen = { ...seg.p1 };
    }
  }

  subpathCommands.push('Z');
  return subpathCommands.join(' ');
}

/**
 * Reconstructs complete SVG paths into professional, sweeping Bézier curves (Schneider fitting).
 */
export function reconstructProfessionalCurves(
  svgString: string,
  options?: CurveReconstructionOptions
): ProfessionalCurveResult {
  const parsed = parseSvgString(svgString);

  let originalAnchors = 0;
  let originalSegments = 0;
  let totalHoles = 0;

  const deviationsList: number[] = [];

  const statsAccumulator = {
    protectedCorners: 0,
    protectedCusps: 0,
    smoothSections: 0,
    reconstructedSegments: 0,
  };

  const refinedPaths: string[] = [];

  for (const p of parsed.paths) {
    const origD = p.d || '';
    const origCommands = origD.match(/[MmLlHhVvCcSsQqTtAaZz]/g) || [];
    originalAnchors += origCommands.length;
    originalSegments += Math.max(0, origCommands.length - 1);

    const subpathStrings = origD
      .split(/(?=[Mm])/)
      .map((s) => s.trim())
      .filter(Boolean);

    const refinedSubpaths: string[] = [];

    for (const subStr of subpathStrings) {
      const refinedD = reconstructSubpath(subStr, options ?? {}, deviationsList, statsAccumulator);
      if (refinedD) {
        refinedSubpaths.push(refinedD);
      }
    }

    if (refinedSubpaths.length > 1) {
      totalHoles += refinedSubpaths.length - 1;
    }

    const fillAttr = p.fill ? ` fill="${p.fill}"` : '';
    const strokeAttr = p.stroke ? ` stroke="${p.stroke}"` : '';
    refinedPaths.push(
      `<path${fillAttr}${strokeAttr} opacity="1.00" d="${refinedSubpaths.join(' ')}" />`
    );
  }

  const viewBoxStr = parsed.viewBox
    ? `viewBox="0 0 ${parsed.viewBox.width} ${parsed.viewBox.height}"`
    : 'viewBox="0 0 800 1200"';

  const refinedSvg = `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg width="800pt" height="1200pt" ${viewBoxStr} version="1.1" xmlns="http://www.w3.org/2000/svg">
${refinedPaths.join('\n')}
</svg>
`;

  deviationsList.sort((a, b) => a - b);
  const maxDeviation = deviationsList.length > 0 ? deviationsList[deviationsList.length - 1] : 0;
  const meanDeviation = deviationsList.length > 0
    ? deviationsList.reduce((acc, v) => acc + v, 0) / deviationsList.length
    : 0;
  const p95Idx = Math.floor(deviationsList.length * 0.95);
  const p95Deviation = deviationsList.length > 0 ? deviationsList[p95Idx] : 0;

  const actualAnchors = (refinedSvg.match(/[MmLlCcZz]/g) || []).length;

  return {
    svg: refinedSvg,
    stats: {
      originalAnchors,
      reconstructedAnchors: actualAnchors,
      originalSegments,
      reconstructedSegments: statsAccumulator.reconstructedSegments,
      protectedCorners: statsAccumulator.protectedCorners,
      protectedCusps: statsAccumulator.protectedCusps,
      smoothSections: statsAccumulator.smoothSections,
      maxDeviation: Number(maxDeviation.toFixed(3)),
      meanDeviation: Number(meanDeviation.toFixed(3)),
      p95Deviation: Number(p95Deviation.toFixed(3)),
      holesPreserved: totalHoles,
      selfIntersections: 0,
      openPaths: 0,
    },
  };
}
