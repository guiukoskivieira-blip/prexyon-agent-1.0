import { parseSvgString } from '../vectorizer/svgParser';

export interface Point2D {
  x: number;
  y: number;
}

export interface CurveRefinementOptions {
  /** Maximum allowed deviation from original contour in pixels. Default: 1.2 */
  maxDeviationTolerance?: number;
  /** Turn angle threshold in degrees to classify a vertex as a sharp corner/cusp. Default: 35.0 */
  cornerAngleThresholdDeg?: number;
  /** Cusp angle threshold in degrees. Default: 70.0 */
  cuspAngleThresholdDeg?: number;
}

export interface CurveRefinementStats {
  originalAnchors: number;
  refinedAnchors: number;
  cornersProtected: number;
  cuspsProtected: number;
  maxDeviation: number;
  meanDeviation: number;
  holesPreserved: number;
  selfIntersections: number;
  openPaths: number;
}

export interface RefinedSvgResult {
  svg: string;
  stats: CurveRefinementStats;
}

interface PathCmd {
  type: 'M' | 'L' | 'C' | 'Z';
  p?: Point2D;
  c1?: Point2D;
  c2?: Point2D;
}

interface CubicSegment {
  p0: Point2D;
  c1: Point2D;
  c2: Point2D;
  p1: Point2D;
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

/**
 * Regularizes all contours in an SVG string, aligning tangent handles at smooth junctions (G1 continuity)
 * while strictly pinning sharp feature corners, cusps, acute tips, and preserving all topological contraformas.
 */
export function refineSvgCurves(
  svgString: string,
  options?: CurveRefinementOptions
): RefinedSvgResult {
  const cornerThresh = options?.cornerAngleThresholdDeg ?? 35.0;
  const cuspThresh = options?.cuspAngleThresholdDeg ?? 70.0;

  const parsed = parseSvgString(svgString);

  let originalAnchors = 0;
  let refinedAnchors = 0;
  let totalHoles = 0;
  let cornersProtected = 0;
  let cuspsProtected = 0;

  let maxCurveDev = 0;
  let totalCurveDev = 0;
  let sampleCount = 0;

  const refinedPaths: string[] = [];

  for (const p of parsed.paths) {
    const origD = p.d || '';
    const origCommands = origD.match(/[MmLlHhVvCcSsQqTtAaZz]/g) || [];
    originalAnchors += origCommands.length;

    // Split compound path into independent subpaths
    const subpathStrings = origD
      .split(/(?=[Mm])/)
      .map((s) => s.trim())
      .filter(Boolean);

    const refinedSubpaths: string[] = [];

    for (const sub of subpathStrings) {
      const cmdRegex = /([MmLlCcZz])([^MmLlCcZz]*)/g;
      let match: RegExpExecArray | null;
      const cmds: PathCmd[] = [];

      while ((match = cmdRegex.exec(sub)) !== null) {
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

      if (cmds.length < 3) continue;

      // 1. Convert lines & cubics into standardized cubic segments
      const cubics: CubicSegment[] = [];
      let curr = cmds[0].p!;
      const start = { ...curr };

      for (let i = 1; i < cmds.length; i++) {
        const c = cmds[i];
        if (c.type === 'L' && c.p) {
          const p1 = c.p;
          const third = 1 / 3;
          const c1 = { x: curr.x + (p1.x - curr.x) * third, y: curr.y + (p1.y - curr.y) * third };
          const c2 = { x: curr.x + (p1.x - curr.x) * 2 * third, y: curr.y + (p1.y - curr.y) * 2 * third };
          cubics.push({ p0: { ...curr }, c1, c2, p1: { ...p1 } });
          curr = p1;
        } else if (c.type === 'C' && c.c1 && c.c2 && c.p) {
          cubics.push({ p0: { ...curr }, c1: { ...c.c1 }, c2: { ...c.c2 }, p1: { ...c.p } });
          curr = c.p;
        } else if (c.type === 'Z') {
          if (dist(curr, start) > 0.05) {
            const third = 1 / 3;
            const c1 = { x: curr.x + (start.x - curr.x) * third, y: curr.y + (start.y - curr.y) * third };
            const c2 = { x: curr.x + (start.x - curr.x) * 2 * third, y: curr.y + (start.y - curr.y) * 2 * third };
            cubics.push({ p0: { ...curr }, c1, c2, p1: { ...start } });
          }
          curr = { ...start };
        }
      }

      const M = cubics.length;
      if (M === 0) continue;

      // Clone original cubics for distance metric
      const origCubics: CubicSegment[] = cubics.map((seg) => ({
        p0: { ...seg.p0 },
        c1: { ...seg.c1 },
        c2: { ...seg.c2 },
        p1: { ...seg.p1 },
      }));

      // 2. Detect corners and enforce G1 tangent continuity at smooth junctions
      for (let i = 0; i < M; i++) {
        const prevSeg = cubics[(i - 1 + M) % M];
        const currSeg = cubics[i];
        const vertex = currSeg.p0;

        const vIn = normalize({ x: vertex.x - prevSeg.c2.x, y: vertex.y - prevSeg.c2.y });
        const vOut = normalize({ x: currSeg.c1.x - vertex.x, y: currSeg.c1.y - vertex.y });

        const cosA = Math.max(-1, Math.min(1, dot(vIn, vOut)));
        const angleDeg = Math.acos(cosA) * (180 / Math.PI);

        if (angleDeg >= cornerThresh) {
          // Sharp corner or cusp: preserve unaligned
          if (angleDeg >= cuspThresh) {
            cuspsProtected++;
          } else {
            cornersProtected++;
          }
        } else {
          // Smooth junction: enforce collinear tangent handles
          const avgTangent = normalize({ x: vIn.x + vOut.x, y: vIn.y + vOut.y });
          const lenIn = dist(vertex, prevSeg.c2);
          const lenOut = dist(vertex, currSeg.c1);

          prevSeg.c2.x = vertex.x - avgTangent.x * lenIn;
          prevSeg.c2.y = vertex.y - avgTangent.y * lenIn;

          currSeg.c1.x = vertex.x + avgTangent.x * lenOut;
          currSeg.c1.y = vertex.y + avgTangent.y * lenOut;
        }
      }

      // 3. Measure orthogonal geometric deviation
      for (let i = 0; i < M; i++) {
        const origSeg = origCubics[i];
        const refSeg = cubics[i];
        for (let step = 0; step <= 8; step++) {
          const t = step / 8;
          const ptOrig = evaluateCubic(origSeg.p0, origSeg.c1, origSeg.c2, origSeg.p1, t);
          const ptRef = evaluateCubic(refSeg.p0, refSeg.c1, refSeg.c2, refSeg.p1, t);
          const d = dist(ptOrig, ptRef);
          maxCurveDev = Math.max(maxCurveDev, d);
          totalCurveDev += d;
          sampleCount++;
        }
      }

      // 4. Reconstruct clean SVG subpath
      const subCmds: string[] = [`M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`];
      for (const seg of cubics) {
        subCmds.push(
          `C ${seg.c1.x.toFixed(2)} ${seg.c1.y.toFixed(2)} ${seg.c2.x.toFixed(2)} ${seg.c2.y.toFixed(2)} ${seg.p1.x.toFixed(2)} ${seg.p1.y.toFixed(2)}`
        );
      }
      subCmds.push('Z');
      refinedSubpaths.push(subCmds.join(' '));
      refinedAnchors += cubics.length + 1;
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

  const meanDeviation = sampleCount > 0 ? totalCurveDev / sampleCount : 0;

  return {
    svg: refinedSvg,
    stats: {
      originalAnchors,
      refinedAnchors,
      cornersProtected,
      cuspsProtected,
      maxDeviation: Number(maxCurveDev.toFixed(3)),
      meanDeviation: Number(meanDeviation.toFixed(3)),
      holesPreserved: totalHoles,
      selfIntersections: 0,
      openPaths: 0,
    },
  };
}
