import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { describe, it } from 'vitest';
import { analyzeSvgStats, RgbaRaster } from '../src/core/vector-engine';
import { NodeCliVectoExecutor } from '../src/core/vector-engine/nodeVectoExecutor';
import { parseSvgString } from '../src/core/vectorizer/svgParser';

const root = path.resolve(__dirname, '..');
const decodeExe = path.join(root, 'scratch/v81a-typescript-equivalence/DecodeRgba.exe');
const inputPath = path.join(root, 'scratch/vector-development-corpus/logo dificil.jpg');

function decodeImage(filePath: string): RgbaRaster {
  const tmpRgba = path.join(os.tmpdir(), `test_v811b_${Date.now()}_${Math.random().toString(36).slice(2)}.rgba`);
  execFileSync(decodeExe, [`${filePath}|${tmpRgba}`]);
  const dimStr = fs.readFileSync(`${tmpRgba}.dimensions`, 'utf-8').trim();
  const [width, height] = dimStr.split('x').map(Number);
  const rgbaData = new Uint8Array(fs.readFileSync(tmpRgba));
  fs.unlinkSync(tmpRgba);
  fs.unlinkSync(`${tmpRgba}.dimensions`);
  return { width, height, data: rgbaData };
}

interface Point2D {
  x: number;
  y: number;
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

  const u: number[] = [0];
  for (let i = 1; i < n; i++) {
    u.push(u[i - 1] + dist(points[i], points[i - 1]));
  }
  const totalChord = u[n - 1] || 1;
  for (let i = 1; i < n; i++) u[i] /= totalChord;

  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;

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

    const tmp = {
      x: points[i].x - ((b0 + b1) * p0.x + (b2 + b3) * p1.x),
      y: points[i].y - ((b0 + b1) * p0.y + (b2 + b3) * p1.y),
    };

    x0 += dot(a1, tmp);
    x1 += dot(a2, tmp);
  }

  const det = c00 * c11 - c01 * c01;
  let alpha1 = 0, alpha2 = 0;

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

function pointToLineDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

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

  if (fit.maxDev <= tolerance || depth >= 6 || points.length <= 4) {
    return [{ type: 'C', c1: fit.c1, c2: fit.c2, p1 }];
  }

  const split = Math.max(1, Math.min(points.length - 2, fit.splitIdx));

  // Compute smooth G1 tangent at split point using a forward/backward window of 3-5 points
  const win = Math.min(split, points.length - 1 - split, 4);
  const tLeft = points[split - win];
  const tRight = points[split + win];
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

function reconstructScaleInvariantSubpath(
  subStr: string,
  options: {
    maxDeviationTolerance?: number;
    cornerAngleThresholdDeg?: number;
    cuspAngleThresholdDeg?: number;
    lineTolerance?: number;
    scaleFactor?: number;
  },
  deviationsList: number[],
  statsAccumulator: {
    candidateCorners: number;
    protectedCorners: number;
    protectedCusps: number;
    rejectedRasterCorners: number;
    smoothSections: number;
    reconstructedSegments: number;
  }
): string {
  const cmdRegex = /([MmLlCcZz])([^MmLlCcZz]*)/g;
  let match: RegExpExecArray | null;
  const cmds: Array<{ type: string; p?: Point2D; c1?: Point2D; c2?: Point2D }> = [];

  while ((match = cmdRegex.exec(subStr)) !== null) {
    const type = match[1].toUpperCase();
    const args = match[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (type === 'M' || type === 'L') {
      cmds.push({ type, p: { x: args[0], y: args[1] } });
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

  const scale = options.scaleFactor ?? 1.0;
  const cornerAngleThresh = options.cornerAngleThresholdDeg ?? 38.0;
  const cuspAngleThresh = options.cuspAngleThresholdDeg ?? 65.0;
  const tolerance = (options.maxDeviationTolerance ?? 1.2) * Math.max(1.0, Math.pow(scale, 0.4));
  const lineTol = (options.lineTolerance ?? 0.5) * Math.max(1.0, Math.pow(scale, 0.4));

  // Compute total subpath perimeter
  let totalPerimeter = 0;
  for (const s of segments) {
    totalPerimeter += dist(s.p0, s.p1);
  }

  // Windowed lookahead in pixels (scale-invariant: 1.0% of perimeter, clamped between 5px and 30px)
  const lookaheadDist = Math.max(5.0 * scale, Math.min(35.0 * scale, totalPerimeter * 0.015));

  // 1. Detect structural feature corners using windowed persistent tangents
  const cornerIndices: number[] = [];

  for (let i = 0; i < M; i++) {
    const junction = segments[i].p0;

    // Backward window walk
    let backIdx = i;
    let accBack = 0;
    while (accBack < lookaheadDist) {
      const prevIdx = (backIdx - 1 + M) % M;
      accBack += dist(segments[prevIdx].p0, segments[prevIdx].p1);
      backIdx = prevIdx;
      if (backIdx === i) break;
    }
    const ptBack = segments[backIdx].p0;

    // Forward window walk
    let fwdIdx = i;
    let accFwd = 0;
    while (accFwd < lookaheadDist) {
      accFwd += dist(segments[fwdIdx].p0, segments[fwdIdx].p1);
      fwdIdx = (fwdIdx + 1) % M;
      if (fwdIdx === i) break;
    }
    const ptFwd = segments[fwdIdx].p0;

    // Persistent windowed tangents
    const tInWin = normalize({ x: junction.x - ptBack.x, y: junction.y - ptBack.y });
    const tOutWin = normalize({ x: ptFwd.x - junction.x, y: ptFwd.y - junction.y });
    const cosWin = Math.max(-1, Math.min(1, dot(tInWin, tOutWin)));
    const winAngleDeg = Math.acos(cosWin) * (180 / Math.PI);

    // Instantaneous 1-step tangent
    const prevSeg = segments[(i - 1 + M) % M];
    const currSeg = segments[i];
    const tIn1 = normalize({ x: junction.x - prevSeg.p0.x, y: junction.y - prevSeg.p0.y });
    const tOut1 = normalize({ x: currSeg.p1.x - junction.x, y: currSeg.p1.y - junction.y });
    const rawAngleDeg = Math.acos(Math.max(-1, Math.min(1, dot(tIn1, tOut1)))) * (180 / Math.PI);

    if (rawAngleDeg >= cornerAngleThresh) {
      statsAccumulator.candidateCorners++;
      if (winAngleDeg >= cornerAngleThresh) {
        cornerIndices.push(i);
        if (winAngleDeg >= cuspAngleThresh) {
          statsAccumulator.protectedCusps++;
        } else {
          statsAccumulator.protectedCorners++;
        }
      } else {
        statsAccumulator.rejectedRasterCorners++;
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

  // 2. Reconstruct smooth macro-spans
  const subpathCommands: string[] = [];
  const firstCornerIdx = cornerIndices[0];
  const firstCornerPt = segments[firstCornerIdx].p0;
  subpathCommands.push(`M ${firstCornerPt.x.toFixed(2)} ${firstCornerPt.y.toFixed(2)}`);

  let currentPen = { ...firstCornerPt };

  for (let c = 0; c < cornerIndices.length; c++) {
    const idx1 = cornerIndices[c];
    const idx2 = cornerIndices[(c + 1) % cornerIndices.length];

    const spanSegs: SegmentInfo[] = [];
    if (idx2 > idx1) {
      for (let i = idx1; i < idx2; i++) spanSegs.push(segments[i]);
    } else {
      for (let i = idx1; i < M; i++) spanSegs.push(segments[i]);
      for (let i = 0; i < idx2; i++) spanSegs.push(segments[i]);
    }

    const densePoints: Point2D[] = [];
    densePoints.push({ ...spanSegs[0].p0 });

    for (const seg of spanSegs) {
      if (seg.type === 'L') {
        const d = dist(seg.p0, seg.p1);
        const steps = Math.max(2, Math.ceil(d / (3.0 * scale)));
        for (let s = 1; s <= steps; s++) {
          densePoints.push({
            x: seg.p0.x + (seg.p1.x - seg.p0.x) * (s / steps),
            y: seg.p0.y + (seg.p1.y - seg.p0.y) * (s / steps),
          });
        }
      } else if (seg.type === 'C' && seg.c1 && seg.c2) {
        const chord = dist(seg.p0, seg.c1) + dist(seg.c1, seg.c2) + dist(seg.c2, seg.p1);
        const steps = Math.max(4, Math.ceil(chord / (3.0 * scale)));
        for (let s = 1; s <= steps; s++) {
          densePoints.push(evaluateCubic(seg.p0, seg.c1, seg.c2, seg.p1, s / steps));
        }
      }
    }

    if (densePoints.length < 2) continue;

    const pStart = densePoints[0];
    const pEnd = densePoints[densePoints.length - 1];

    // Compute windowed smooth macroscopic initial and final tangents
    const winSteps = Math.min(Math.floor(densePoints.length / 3), Math.max(3, Math.round(5 * scale)));
    const pLookahead = densePoints[Math.min(densePoints.length - 1, winSteps)];
    const pLookbehind = densePoints[Math.max(0, densePoints.length - 1 - winSteps)];

    const tangentStart = normalize({ x: pLookahead.x - pStart.x, y: pLookahead.y - pStart.y });
    const tangentEndInward = normalize({ x: pLookbehind.x - pEnd.x, y: pLookbehind.y - pEnd.y });

    const fitted = fitCurveSpanRecursive(
      densePoints,
      tangentStart,
      tangentEndInward,
      tolerance,
      lineTol
    );

    // Measure deviations
    for (const rawPt of densePoints) {
      let minD = 9999;
      let segStart = currentPen;
      for (const seg of fitted) {
        if (seg.type === 'L') {
          minD = Math.min(minD, pointToLineDistance(rawPt, segStart, seg.p1));
        } else if (seg.type === 'C' && seg.c1 && seg.c2) {
          const segLen = dist(segStart, seg.c1) + dist(seg.c1, seg.c2) + dist(seg.c2, seg.p1);
          const sampleSteps = Math.max(16, Math.min(64, Math.ceil(segLen)));
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

describe('Test Scale-Invariant Curve Reconstruction on Logo Dificil', () => {
  it('executes scale-invariant professional curve reconstruction on Logo Dificil', () => {
    const rawSvg = fs.readFileSync('scratch/v811a-test/logo-dificil-normalized.svg', 'utf-8');
    const parsed = parseSvgString(rawSvg);

    const deviationsList: number[] = [];
    const statsAccumulator = {
      candidateCorners: 0,
      protectedCorners: 0,
      protectedCusps: 0,
      rejectedRasterCorners: 0,
      smoothSections: 0,
      reconstructedSegments: 0,
    };

    const refinedPaths: string[] = [];

    for (const p of parsed.paths) {
      const origD = p.d || '';
      const subpathStrings = origD.split(/(?=[Mm])/).filter(Boolean);
      const refinedSubpaths: string[] = [];

      for (const subStr of subpathStrings) {
        const refinedD = reconstructScaleInvariantSubpath(
          subStr,
          {
            maxDeviationTolerance: 1.2,
            cornerAngleThresholdDeg: 38.0,
            cuspAngleThresholdDeg: 65.0,
            lineTolerance: 0.5,
            scaleFactor: 3066 / 1000,
          },
          deviationsList,
          statsAccumulator
        );
        if (refinedD) refinedSubpaths.push(refinedD);
      }

      const fillAttr = p.fill ? ` fill="${p.fill}"` : '';
      const strokeAttr = p.stroke ? ` stroke="${p.stroke}"` : '';
      refinedPaths.push(`<path${fillAttr}${strokeAttr} opacity="1.00" d="${refinedSubpaths.join(' ')}" />`);
    }

    const v811bSvg = `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg width="3066pt" height="3066pt" viewBox="0 0 3066 3066" version="1.1" xmlns="http://www.w3.org/2000/svg">
${refinedPaths.join('\n')}
</svg>
`;

    deviationsList.sort((a, b) => a - b);
    const maxDev = deviationsList[deviationsList.length - 1];
    const meanDev = deviationsList.reduce((acc, v) => acc + v, 0) / deviationsList.length;
    const p95Dev = deviationsList[Math.floor(deviationsList.length * 0.95)];

    const stats = analyzeSvgStats(v811bSvg);

    console.log('\n==============================================');
    console.log('Scale-Invariant Curve Reconstruction Results:');
    console.log(`Paths: ${stats.paths}, Anchors: ${stats.anchors}, Subpaths: ${stats.subpaths}, Holes: ${stats.holes}`);
    console.log(`Candidate Corners: ${statsAccumulator.candidateCorners}`);
    console.log(`Protected Real Corners: ${statsAccumulator.protectedCorners}`);
    console.log(`Protected Real Cusps: ${statsAccumulator.protectedCusps}`);
    console.log(`Rejected Raster Corners: ${statsAccumulator.rejectedRasterCorners} (${(100 * statsAccumulator.rejectedRasterCorners / statsAccumulator.candidateCorners).toFixed(1)}%)`);
    console.log(`Reconstructed Segments: ${statsAccumulator.reconstructedSegments}`);
    console.log(`Max Deviation: ${maxDev.toFixed(3)} px | Mean: ${meanDev.toFixed(3)} px | P95: ${p95Dev.toFixed(3)} px`);
    console.log('==============================================\n');

    fs.mkdirSync('scratch/v811b-test', { recursive: true });
    fs.writeFileSync('scratch/v811b-test/logo-dificil-v811b.svg', v811bSvg, 'utf-8');
  });
});
