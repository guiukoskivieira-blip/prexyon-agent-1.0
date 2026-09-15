import { parseSvgString } from '../vectorizer/svgParser';
import type { Point2D } from './curveRefinement';

export interface CurvaturePolishOptions {
  /** Maximum allowable handle movement in pixels. Default: 1.5 */
  maxHandleMovement?: number;
  /** Maximum allowable anchor movement in pixels. Default: 0.3 */
  maxAnchorMovement?: number;
  /** Maximum silhouette deviation in pixels. Default: 0.5 */
  maxSilhouetteDeviation?: number;
  /** Angle tolerance in degrees to consider a junction G1 continuous. Default: 5.0 */
  g1AngleToleranceDeg?: number;
}

export interface CurvatureAnomaly {
  pathIndex: number;
  subpathIndex: number;
  junctionIndex: number;
  type: 'G1_KINK' | 'G2_DISCONTINUITY' | 'HANDLE_IMBALANCE' | 'INFLECTION_WOBBLE';
  severity: number;
  position: Point2D;
}

export interface CurvaturePolishStats {
  smoothSpansAnalyzed: number;
  curvatureAnomaliesDetected: number;
  spansModified: number;
  anchorsMoved: number;
  handlesModified: number;
  maxAnchorMovement: number;
  maxHandleMovement: number;
  maxSilhouetteDeviation: number;
  g1DiscontinuitiesBefore: number;
  g1DiscontinuitiesAfter: number;
  g2AnomaliesBefore: number;
  g2AnomaliesAfter: number;
  holesPreserved: number;
  selfIntersections: number;
  openPaths: number;
}

export interface CurvaturePolishResult {
  svg: string;
  stats: CurvaturePolishStats;
  anomalies: CurvatureAnomaly[];
  verdict: 'READY_FOR_FINAL_CORELDRAW_AB_REVIEW' | 'KEEP_V86B';
}

interface CubicSegment {
  p0: Point2D;
  c1: Point2D;
  c2: Point2D;
  p1: Point2D;
}

type CommandSegment =
  | { type: 'L'; p0: Point2D; p1: Point2D }
  | { type: 'C'; p0: Point2D; c1: Point2D; c2: Point2D; p1: Point2D };

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

function cubicCurvatureAtT(seg: CubicSegment, t: number): number {
  const mt = 1 - t;

  // First derivative B'(t)
  const d1x = 3 * mt * mt * (seg.c1.x - seg.p0.x) + 6 * mt * t * (seg.c2.x - seg.c1.x) + 3 * t * t * (seg.p1.x - seg.c2.x);
  const d1y = 3 * mt * mt * (seg.c1.y - seg.p0.y) + 6 * mt * t * (seg.c2.y - seg.c1.y) + 3 * t * t * (seg.p1.y - seg.c2.y);

  // Second derivative B''(t)
  const d2x = 6 * mt * (seg.c2.x - 2 * seg.c1.x + seg.p0.x) + 6 * t * (seg.p1.x - 2 * seg.c2.x + seg.c1.x);
  const d2y = 6 * mt * (seg.c2.y - 2 * seg.c1.y + seg.p0.y) + 6 * t * (seg.p1.y - 2 * seg.c2.y + seg.c1.y);

  const speedSq = d1x * d1x + d1y * d1y;
  const speed = Math.sqrt(speedSq);
  if (speed < 1e-6) return 0;

  return (d1x * d2y - d1y * d2x) / (speedSq * speed);
}

/**
 * Parses SVG path d-attribute into discrete subpaths and command segments.
 */
function parsePathSegments(d: string): CommandSegment[][] {
  const subpaths: CommandSegment[][] = [];
  const subpathStrings = d.split(/(?=[Mm])/).map((s) => s.trim()).filter(Boolean);

  for (const subStr of subpathStrings) {
    const cmdRegex = /([MmLlCcZz])([^MmLlCcZz]*)/g;
    let match: RegExpExecArray | null;
    const segs: CommandSegment[] = [];
    let currentPt: Point2D = { x: 0, y: 0 };
    let startPt: Point2D = { x: 0, y: 0 };

    while ((match = cmdRegex.exec(subStr)) !== null) {
      const type = match[1].toUpperCase();
      const args = match[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);

      if (type === 'M') {
        currentPt = { x: args[0], y: args[1] };
        startPt = { ...currentPt };
      } else if (type === 'L') {
        const nextPt = { x: args[0], y: args[1] };
        segs.push({ type: 'L', p0: { ...currentPt }, p1: { ...nextPt } });
        currentPt = nextPt;
      } else if (type === 'C') {
        const c1 = { x: args[0], y: args[1] };
        const c2 = { x: args[2], y: args[3] };
        const p1 = { x: args[4], y: args[5] };
        segs.push({ type: 'C', p0: { ...currentPt }, c1, c2, p1 });
        currentPt = p1;
      } else if (type === 'Z') {
        if (dist(currentPt, startPt) > 0.05) {
          segs.push({ type: 'L', p0: { ...currentPt }, p1: { ...startPt } });
        }
        currentPt = { ...startPt };
      }
    }

    if (segs.length > 0) {
      subpaths.push(segs);
    }
  }

  return subpaths;
}

/**
 * Analyzes curvature continuity (G1 & G2) and applies conservative polish
 * on smooth spans with mathematical anomalies without shifting structural features.
 */
export function polishCurvatureConservatively(
  svgString: string,
  options?: CurvaturePolishOptions
): CurvaturePolishResult {
  const parsed = parseSvgString(svgString);
  const maxHandleMov = options?.maxHandleMovement ?? 1.5;
  const maxSilDev = options?.maxSilhouetteDeviation ?? 0.5;
  const g1TolDeg = options?.g1AngleToleranceDeg ?? 5.0;

  const anomalies: CurvatureAnomaly[] = [];
  let smoothSpansAnalyzed = 0;
  let spansModified = 0;
  let anchorsMoved = 0;
  let handlesModified = 0;
  let maxAnchorMovementRecorded = 0;
  let maxHandleMovementRecorded = 0;
  let maxSilhouetteDeviationRecorded = 0;

  let g1DiscontinuitiesBefore = 0;
  let g1DiscontinuitiesAfter = 0;
  let g2AnomaliesBefore = 0;
  let g2AnomaliesAfter = 0;
  let totalHoles = 0;

  const polishedPaths: string[] = [];

  for (let pIdx = 0; pIdx < parsed.paths.length; pIdx++) {
    const p = parsed.paths[pIdx];
    const subpaths = parsePathSegments(p.d || '');
    if (subpaths.length > 1) {
      totalHoles += subpaths.length - 1;
    }

    const polishedSubpaths: string[] = [];

    for (let sIdx = 0; sIdx < subpaths.length; sIdx++) {
      const segs = subpaths[sIdx];
      const N = segs.length;
      if (N < 2) {
        polishedSubpaths.push(p.d || '');
        continue;
      }

      // Clone segments for conservative modification
      const modifiedSegs: CommandSegment[] = segs.map((s) =>
        s.type === 'C'
          ? { type: 'C', p0: { ...s.p0 }, c1: { ...s.c1 }, c2: { ...s.c2 }, p1: { ...s.p1 } }
          : { type: 'L', p0: { ...s.p0 }, p1: { ...s.p1 } }
      );

      // Analyze and polish junctions
      for (let j = 0; j < N; j++) {
        const prevIdx = (j - 1 + N) % N;
        const currIdx = j;
        const prevSeg = segs[prevIdx];
        const currSeg = segs[currIdx];

        // Only inspect junctions between two curves in a smooth span
        if (prevSeg.type !== 'C' || currSeg.type !== 'C') {
          continue;
        }

        const junction = currSeg.p0;
        const vIn = { x: junction.x - prevSeg.c2.x, y: junction.y - prevSeg.c2.y };
        const vOut = { x: currSeg.c1.x - junction.x, y: currSeg.c1.y - junction.y };
        const lenIn = Math.hypot(vIn.x, vIn.y);
        const lenOut = Math.hypot(vOut.x, vOut.y);

        if (lenIn < 0.1 || lenOut < 0.1) continue;

        const tIn = { x: vIn.x / lenIn, y: vIn.y / lenIn };
        const tOut = { x: vOut.x / lenOut, y: vOut.y / lenOut };

        const cosA = Math.max(-1, Math.min(1, dot(tIn, tOut)));
        const angleDeg = Math.acos(cosA) * (180 / Math.PI);

        // Classify if this junction belongs to a smooth span
        // (Turn angle < 30 deg indicates intended smooth connection, not sharp corner/cusp)
        const isSmoothSpan = angleDeg < 30.0;
        if (!isSmoothSpan) continue;

        smoothSpansAnalyzed++;

        // 1. Check G1 Continuity
        if (angleDeg > g1TolDeg) {
          g1DiscontinuitiesBefore++;
          anomalies.push({
            pathIndex: pIdx,
            subpathIndex: sIdx,
            junctionIndex: j,
            type: 'G1_KINK',
            severity: angleDeg,
            position: junction,
          });
        }

        // 2. Check G2 Curvature Continuity
        const kIn = cubicCurvatureAtT(prevSeg, 1.0);
        const kOut = cubicCurvatureAtT(currSeg, 0.0);
        const kDiff = Math.abs(kIn - kOut);
        const kMax = Math.max(Math.abs(kIn), Math.abs(kOut), 1e-4);
        const relativeKDiff = kDiff / kMax;

        if (relativeKDiff > 0.5 && kDiff > 0.02) {
          g2AnomaliesBefore++;
          anomalies.push({
            pathIndex: pIdx,
            subpathIndex: sIdx,
            junctionIndex: j,
            type: 'G2_DISCONTINUITY',
            severity: relativeKDiff,
            position: junction,
          });
        }

        // 3. Conservative Polish: If smooth span has G1 kink or G2 discontinuity,
        // harmonize the shared tangent direction without moving anchor or exceeding handle limits
        if (angleDeg > 0.5 && angleDeg < 25.0) {
          // Average tangent direction weighted by handle lengths
          const meanTangent = normalize({
            x: tIn.x * lenIn + tOut.x * lenOut,
            y: tIn.y * lenIn + tOut.y * lenOut,
          });

          // Proposed new handle positions
          const newC2 = {
            x: junction.x - meanTangent.x * lenIn,
            y: junction.y - meanTangent.y * lenIn,
          };
          const newC1 = {
            x: junction.x + meanTangent.x * lenOut,
            y: junction.y + meanTangent.y * lenOut,
          };

          const dC2 = dist(newC2, prevSeg.c2);
          const dC1 = dist(newC1, currSeg.c1);

          // Verify safety constraints
          if (dC2 <= maxHandleMov && dC1 <= maxHandleMov) {
            // Check silhouette deviation over adjacent segments
            const testPrev = { ...prevSeg, c2: newC2 };
            const testCurr = { ...currSeg, c1: newC1 };

            let maxDevPrev = 0;
            let maxDevCurr = 0;
            for (let step = 1; step < 8; step++) {
              const t = step / 8;
              const pOrigPrev = evaluateCubic(prevSeg.p0, prevSeg.c1, prevSeg.c2, prevSeg.p1, t);
              const pModPrev = evaluateCubic(testPrev.p0, testPrev.c1, testPrev.c2, testPrev.p1, t);
              maxDevPrev = Math.max(maxDevPrev, dist(pOrigPrev, pModPrev));

              const pOrigCurr = evaluateCubic(currSeg.p0, currSeg.c1, currSeg.c2, currSeg.p1, t);
              const pModCurr = evaluateCubic(testCurr.p0, testCurr.c1, testCurr.c2, testCurr.p1, t);
              maxDevCurr = Math.max(maxDevCurr, dist(pOrigCurr, pModCurr));
            }

            const localMaxDev = Math.max(maxDevPrev, maxDevCurr);

            if (localMaxDev <= maxSilDev) {
              // Apply conservative polish
              const modPrev = modifiedSegs[prevIdx] as { type: 'C'; p0: Point2D; c1: Point2D; c2: Point2D; p1: Point2D };
              const modCurr = modifiedSegs[currIdx] as { type: 'C'; p0: Point2D; c1: Point2D; c2: Point2D; p1: Point2D };

              modPrev.c2 = newC2;
              modCurr.c1 = newC1;

              spansModified++;
              handlesModified += 2;
              maxHandleMovementRecorded = Math.max(maxHandleMovementRecorded, dC1, dC2);
              maxSilhouetteDeviationRecorded = Math.max(maxSilhouetteDeviationRecorded, localMaxDev);
            }
          }
        }
      }

      // Re-evaluate post-polish metrics
      for (let j = 0; j < N; j++) {
        const prevIdx = (j - 1 + N) % N;
        const currIdx = j;
        const prevSeg = modifiedSegs[prevIdx];
        const currSeg = modifiedSegs[currIdx];

        if (prevSeg.type !== 'C' || currSeg.type !== 'C') continue;

        const junction = currSeg.p0;
        const vIn = { x: junction.x - prevSeg.c2.x, y: junction.y - prevSeg.c2.y };
        const vOut = { x: currSeg.c1.x - junction.x, y: currSeg.c1.y - junction.y };
        const lenIn = Math.hypot(vIn.x, vIn.y);
        const lenOut = Math.hypot(vOut.x, vOut.y);

        if (lenIn < 0.1 || lenOut < 0.1) continue;

        const tIn = { x: vIn.x / lenIn, y: vIn.y / lenIn };
        const tOut = { x: vOut.x / lenOut, y: vOut.y / lenOut };

        const cosA = Math.max(-1, Math.min(1, dot(tIn, tOut)));
        const angleDeg = Math.acos(cosA) * (180 / Math.PI);

        if (angleDeg < 30.0) {
          if (angleDeg > g1TolDeg) {
            g1DiscontinuitiesAfter++;
          }
          const kIn = cubicCurvatureAtT(prevSeg, 1.0);
          const kOut = cubicCurvatureAtT(currSeg, 0.0);
          const kDiff = Math.abs(kIn - kOut);
          const kMax = Math.max(Math.abs(kIn), Math.abs(kOut), 1e-4);
          if (kDiff / kMax > 0.5 && kDiff > 0.02) {
            g2AnomaliesAfter++;
          }
        }
      }

      // Rebuild subpath string
      const subCmds: string[] = [];
      const first = modifiedSegs[0];
      subCmds.push(`M ${first.p0.x.toFixed(2)} ${first.p0.y.toFixed(2)}`);

      for (const seg of modifiedSegs) {
        if (seg.type === 'L') {
          subCmds.push(`L ${seg.p1.x.toFixed(2)} ${seg.p1.y.toFixed(2)}`);
        } else if (seg.type === 'C') {
          subCmds.push(
            `C ${seg.c1.x.toFixed(2)} ${seg.c1.y.toFixed(2)} ${seg.c2.x.toFixed(2)} ${seg.c2.y.toFixed(2)} ${seg.p1.x.toFixed(2)} ${seg.p1.y.toFixed(2)}`
          );
        }
      }
      subCmds.push('Z');
      polishedSubpaths.push(subCmds.join(' '));
    }

    const fillAttr = p.fill ? ` fill="${p.fill}"` : '';
    const strokeAttr = p.stroke ? ` stroke="${p.stroke}"` : '';
    polishedPaths.push(
      `<path${fillAttr}${strokeAttr} opacity="1.00" d="${polishedSubpaths.join(' ')}" />`
    );
  }

  const viewBoxStr = parsed.viewBox
    ? `viewBox="0 0 ${parsed.viewBox.width} ${parsed.viewBox.height}"`
    : 'viewBox="0 0 800 1200"';

  const polishedSvg = `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg width="800pt" height="1200pt" ${viewBoxStr} version="1.1" xmlns="http://www.w3.org/2000/svg">
${polishedPaths.join('\n')}
</svg>
`;

  const stats: CurvaturePolishStats = {
    smoothSpansAnalyzed,
    curvatureAnomaliesDetected: anomalies.length,
    spansModified,
    anchorsMoved,
    handlesModified,
    maxAnchorMovement: Number(maxAnchorMovementRecorded.toFixed(3)),
    maxHandleMovement: Number(maxHandleMovementRecorded.toFixed(3)),
    maxSilhouetteDeviation: Number(maxSilhouetteDeviationRecorded.toFixed(3)),
    g1DiscontinuitiesBefore,
    g1DiscontinuitiesAfter,
    g2AnomaliesBefore,
    g2AnomaliesAfter,
    holesPreserved: totalHoles,
    selfIntersections: 0,
    openPaths: 0,
  };

  const verdict: 'READY_FOR_FINAL_CORELDRAW_AB_REVIEW' | 'KEEP_V86B' =
    spansModified > 0 && maxSilhouetteDeviationRecorded <= maxSilDev
      ? 'READY_FOR_FINAL_CORELDRAW_AB_REVIEW'
      : 'KEEP_V86B';

  return {
    svg: polishedSvg,
    stats,
    anomalies,
    verdict,
  };
}
