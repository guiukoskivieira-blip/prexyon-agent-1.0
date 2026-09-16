import { hasSelfIntersection, signedArea } from './geometricSimplification';

export type Point = { x: number; y: number };
export type LineSegment = { type: 'LINE'; p0: Point; p1: Point };
export type CubicSegment = { type: 'CUBIC'; p0: Point; c1: Point; c2: Point; p1: Point };
export type FittedSegment = LineSegment | CubicSegment;
export interface CurveFittingOptions { maxBoundaryDeviation?: number; maxAreaDeltaPercent?: number; maxCurveRunPoints?: number }
export interface FittedContour {
  segments: FittedSegment[];
  inputPoints: number;
  lineRuns: number;
  curveRuns: number;
  lineSegmentCount: number;
  cubicBezierCount: number;
  maxDeviation: number;
  meanDeviation: number;
  areaDeltaPercent: number;
  fallbackRunCount: number;
  selfIntersectionCount: number;
  degenerateContourCount: number;
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const cubicPoint = (segment: CubicSegment, t: number): Point => {
  const a = lerp(segment.p0, segment.c1, t), b = lerp(segment.c1, segment.c2, t), c = lerp(segment.c2, segment.p1, t);
  return lerp(lerp(a, b, t), lerp(b, c, t), t);
};
const lineDistance = (point: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dy = b.y - a.y, denominator = dx * dx + dy * dy;
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / denominator));
  return distance(point, { x: a.x + t * dx, y: a.y + t * dy });
};
const segmentSamples = (segment: FittedSegment, steps = 16): Point[] => {
  if (segment.type === 'LINE') return [segment.p0, segment.p1];
  return Array.from({ length: steps + 1 }, (_, index) => cubicPoint(segment, index / steps));
};
const polylineFromSegments = (segments: FittedSegment[], steps = 16) => segments.flatMap((segment, index) => {
  const samples = segmentSamples(segment, steps);
  return index === 0 ? samples : samples.slice(1);
});
const nearestDistance = (point: Point, polyline: Point[]) => Math.min(...polyline.slice(0, -1).map((start, index) => lineDistance(point, start, polyline[index + 1])));
const turn = (a: Point, b: Point, c: Point) => {
  const ax = b.x - a.x, ay = b.y - a.y, bx = c.x - b.x, by = c.y - b.y;
  const denominator = Math.hypot(ax, ay) * Math.hypot(bx, by);
  return denominator === 0 ? 0 : Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / denominator))) * 180 / Math.PI;
};

function fitCubic(points: Point[]): CubicSegment {
  const p0 = points[0], p1 = points.at(-1)!;
  const forward = { x: points[1].x - p0.x, y: points[1].y - p0.y };
  const backward = { x: p1.x - points.at(-2)!.x, y: p1.y - points.at(-2)!.y };
  const scale = Math.max(distance(p0, p1) / 3, distance(p0, points[1]), distance(points.at(-2)!, p1));
  const forwardLength = Math.hypot(forward.x, forward.y) || 1, backwardLength = Math.hypot(backward.x, backward.y) || 1;
  return { type: 'CUBIC', p0, c1: { x: p0.x + forward.x / forwardLength * scale, y: p0.y + forward.y / forwardLength * scale },
    c2: { x: p1.x - backward.x / backwardLength * scale, y: p1.y - backward.y / backwardLength * scale }, p1 };
}

function lineSegments(points: Point[]): LineSegment[] {
  if (points.length < 2) return [];
  const result: LineSegment[] = [];
  let start = 0;
  for (let index = 2; index < points.length; index++) {
    const deviation = Math.max(...points.slice(start + 1, index).map(point => lineDistance(point, points[start], points[index])));
    const corner = turn(points[index - 2], points[index - 1], points[index]);
    if (deviation > 0.75 || corner > 10) { result.push({ type: 'LINE', p0: points[start], p1: points[index - 1] }); start = index - 1; }
  }
  result.push({ type: 'LINE', p0: points[start], p1: points.at(-1)! });
  return result;
}

function fitCurveRun(points: Point[], options: CurveFittingOptions, depth = 0): { segments: FittedSegment[]; fallback: number } {
  if (points.length < 3) return { segments: lineSegments(points), fallback: 0 };
  const candidate = fitCubic(points), sampled = segmentSamples(candidate), deviation = Math.max(...points.map(point => nearestDistance(point, sampled)));
  const limit = options.maxBoundaryDeviation ?? 2;
  if (deviation <= limit) return { segments: [candidate], fallback: 0 };
  if (depth === 0 && points.length >= 5) {
    const middle = Math.floor((points.length - 1) / 2);
    const left = fitCurveRun(points.slice(0, middle + 1), options, 1);
    const right = fitCurveRun(points.slice(middle), options, 1);
    return { segments: [...left.segments, ...right.segments], fallback: left.fallback + right.fallback };
  }
  return { segments: lineSegments(points), fallback: 1 };
}

function runIsCurved(points: Point[]) {
  if (points.length < 4) return false;
  const turns = points.slice(1, -1).map((point, index) => turn(points[index], point, points[index + 2]));
  const average = turns.reduce((sum, value) => sum + value, 0) / turns.length;
  return average >= 5 && Math.max(...turns) - Math.min(...turns) < 55;
}

export function sampleFittedContour(contour: FittedContour, steps = 16) {
  const points = polylineFromSegments(contour.segments, steps);
  if (points.length && distance(points[0], points.at(-1)!) > 1e-9) points.push({ ...points[0] });
  return points;
}

export function segmentTypeCount(contour: FittedContour) {
  return { line: contour.segments.filter(segment => segment.type === 'LINE').length, cubic: contour.segments.filter(segment => segment.type === 'CUBIC').length };
}

export function fitContour(points: Point[], options: CurveFittingOptions = {}): FittedContour {
  const originalSegments = () => points.map((point, index) => ({ type: 'LINE' as const, p0: point, p1: points[(index + 1) % points.length] }));
  if (points.length < 3) return { segments: originalSegments(), inputPoints: points.length, lineRuns: 1, curveRuns: 0, lineSegmentCount: points.length,
    cubicBezierCount: 0, maxDeviation: 0, meanDeviation: 0, areaDeltaPercent: 0, fallbackRunCount: 1, selfIntersectionCount: 0, degenerateContourCount: 1 };
  const hard = points.flatMap((point, index) => {
    const before = points[(index + points.length - 1) % points.length];
    const after = points[(index + 1) % points.length];
    return turn(before, point, after) >= 65 ? [index] : [];
  });
  const runs: Point[][] = [];
  if (hard.length > 0) {
    for (let anchor = 0; anchor < hard.length; anchor++) {
      const start = hard[anchor], end = hard[(anchor + 1) % hard.length], run: Point[] = [];
      for (let index = start; ; index = (index + 1) % points.length) { run.push(points[index]); if (index === end) break; }
      runs.push(run);
    }
  } else {
    const maxRun = options.maxCurveRunPoints ?? 12;
    const useCurves = points.length >= 6 && runIsCurved(points);
    if (useCurves) {
    const size = Math.max(4, Math.min(maxRun, Math.ceil(points.length / 4)));
    for (let start = 0; start < points.length; start += size) {
      const run = Array.from({ length: Math.min(size, points.length - start) + 1 }, (_, offset) => points[(start + offset) % points.length]);
      runs.push(run);
    }
    } else runs.push([...points, points[0]]);
  }
  const fitted: FittedSegment[] = [], fallback = { count: 0 }, runCounts = { line: 0, curve: 0 };
  runs.forEach(run => {
    if (run.length >= 3 && runIsCurved(run)) {
      const result = fitCurveRun(run, options); fitted.push(...result.segments); fallback.count += result.fallback;
      if (result.segments.some(segment => segment.type === 'CUBIC')) runCounts.curve++;
      else runCounts.line++;
    } else { fitted.push(...lineSegments(run)); runCounts.line++; }
  });
  let sampled = polylineFromSegments(fitted), deviations = points.map(point => nearestDistance(point, sampled));
  const areaOriginal = signedArea(points), areaFitted = signedArea(sampled), areaDeltaPercent = options.maxAreaDeltaPercent !== undefined
    && Math.abs(areaFitted - areaOriginal) / Math.max(1, Math.abs(areaOriginal)) * 100 > options.maxAreaDeltaPercent ? 100 : Math.abs(areaFitted - areaOriginal) / Math.max(1, Math.abs(areaOriginal)) * 100;
  const areaLimit = options.maxAreaDeltaPercent ?? 5;
  let finalSegments = fitted, finalAreaDelta = areaDeltaPercent;
  if (areaDeltaPercent > areaLimit || Math.sign(areaFitted) !== Math.sign(areaOriginal)) {
    finalSegments = originalSegments(); fallback.count += 1; runCounts.line = 1; runCounts.curve = 0;
    sampled = polylineFromSegments(finalSegments); deviations = points.map(point => nearestDistance(point, sampled)); finalAreaDelta = 0;
  }
  const counts = segmentTypeCount({ segments: finalSegments } as FittedContour);
  return { segments: finalSegments, inputPoints: points.length, lineRuns: runCounts.line, curveRuns: runCounts.curve, lineSegmentCount: counts.line, cubicBezierCount: counts.cubic,
    maxDeviation: Math.max(...deviations, 0), meanDeviation: deviations.reduce((sum, value) => sum + value, 0) / points.length,
    areaDeltaPercent: finalAreaDelta, fallbackRunCount: fallback.count, selfIntersectionCount: hasSelfIntersection(sampled) ? 1 : 0,
    degenerateContourCount: finalSegments.length === 0 || Math.abs(signedArea(sampled)) === 0 ? 1 : 0 };
}
