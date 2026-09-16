import type { Point } from './geometricContourReconstruction';

export type CornerKind = 'HARD_CORNER' | 'SOFT_CORNER' | 'REGULAR';
export interface SimplificationOptions { toleranceScale?: number; maxAreaDeltaPercent?: number; maxBoundaryDeviation?: number }

const pointDistance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const distanceToSegment = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dy = b.y - a.y, denominator = dx * dx + dy * dy;
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / denominator));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
export const signedArea = (ring: Point[]) => ring.reduce((sum, point, index) => {
  const next = ring[(index + 1) % ring.length];
  return sum + point.x * next.y - next.x * point.y;
}, 0) / 2;
const turnAngle = (before: Point, point: Point, after: Point) => {
  const ax = point.x - before.x, ay = point.y - before.y, bx = after.x - point.x, by = after.y - point.y;
  const denominator = Math.hypot(ax, ay) * Math.hypot(bx, by);
  const cosine = denominator === 0 ? 1 : Math.max(-1, Math.min(1, (ax * bx + ay * by) / denominator));
  return Math.acos(cosine) * 180 / Math.PI;
};

export function classifyCorners(ring: Point[]): CornerKind[] {
  if (ring.length < 3) return ring.map(() => 'REGULAR');
  const window = Math.min(8, Math.max(1, Math.floor((ring.length - 1) / 2)));
  const scores = ring.map((point, index) => {
    const immediateBefore = ring[(index + ring.length - 1) % ring.length];
    const immediateAfter = ring[(index + 1) % ring.length];
    const before = ring[(index + ring.length - window) % ring.length];
    const after = ring[(index + window) % ring.length];
    const immediateAngle = turnAngle(immediateBefore, point, immediateAfter);
    const windowAngle = turnAngle(before, point, after);
    const stableArms = Math.min(pointDistance(immediateBefore, point), pointDistance(point, immediateAfter));
    return { immediateAngle, windowAngle, stableArms };
  });
  return scores.map(({ immediateAngle, windowAngle, stableArms }, index) => {
    const hardCandidate = immediateAngle >= 45 && windowAngle >= 35 && stableArms >= 0.75;
    const locallyStrongest = ring.length <= 8 || Array.from({ length: window * 2 + 1 }, (_, offset) => {
      const other = (index + offset - window + ring.length) % ring.length;
      return other === index || windowAngle > scores[other].windowAngle || (windowAngle === scores[other].windowAngle && index < other);
    }).every(Boolean);
    if (hardCandidate && locallyStrongest) return 'HARD_CORNER';
    if (windowAngle >= 20 || immediateAngle >= 12) return 'SOFT_CORNER';
    return 'REGULAR';
  });
}

function rdp(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points;
  let maxDistance = 0, splitIndex = 0;
  for (let index = 1; index < points.length - 1; index++) {
    const distance = distanceToSegment(points[index], points[0], points.at(-1)!);
    if (distance > maxDistance) { maxDistance = distance; splitIndex = index; }
  }
  if (maxDistance <= epsilon) return [points[0], points.at(-1)!];
  return [...rdp(points.slice(0, splitIndex + 1), epsilon).slice(0, -1), ...rdp(points.slice(splitIndex), epsilon)];
}

function simplifyClosed(ring: Point[], epsilon: number, kinds: CornerKind[]) {
  const anchors = kinds.flatMap((kind, index) => kind === 'HARD_CORNER' ? [index] : []);
  if (anchors.length < 2) {
    let splitIndex = 1, farthest = 0;
    for (let index = 1; index < ring.length; index++) {
      const distance = pointDistance(ring[index], ring[0]);
      if (distance > farthest) { farthest = distance; splitIndex = index; }
    }
    return [...rdp(ring.slice(0, splitIndex + 1), epsilon).slice(0, -1), ...rdp([...ring.slice(splitIndex), ring[0]], epsilon).slice(0, -1)];
  }
  const result: Point[] = [];
  for (let anchorIndex = 0; anchorIndex < anchors.length; anchorIndex++) {
    const segment: Point[] = [], start = anchors[anchorIndex], end = anchors[(anchorIndex + 1) % anchors.length];
    for (let index = start; ; index = (index + 1) % ring.length) {
      segment.push(ring[index]);
      if (index === end) break;
    }
    result.push(...rdp(segment, epsilon).slice(0, -1));
  }
  return result;
}

const orientation = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const properIntersection = (a: Point, b: Point, c: Point, d: Point) => {
  const abC = orientation(a, b, c), abD = orientation(a, b, d), cdA = orientation(c, d, a), cdB = orientation(c, d, b);
  return ((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0));
};
export function hasSelfIntersection(ring: Point[]) {
  for (let first = 0; first < ring.length; first++) for (let second = first + 1; second < ring.length; second++) {
    const firstEnd = (first + 1) % ring.length, secondEnd = (second + 1) % ring.length;
    if (first === second || firstEnd === second || secondEnd === first) continue;
    if (properIntersection(ring[first], ring[firstEnd], ring[second], ring[secondEnd])) return true;
  }
  return false;
}
const deviations = (raw: Point[], simplified: Point[]) => {
  const values = raw.map(point => Math.min(...simplified.map((start, index) => distanceToSegment(point, start, simplified[(index + 1) % simplified.length]))));
  return { max: Math.max(0, ...values), mean: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length) };
};

export function simplifyRing(raw: Point[], options: SimplificationOptions = {}) {
  const cornerKinds = classifyCorners(raw), hardCorners = cornerKinds.filter(kind => kind === 'HARD_CORNER').length;
  const softCorners = cornerKinds.filter(kind => kind === 'SOFT_CORNER').length, xs = raw.map(point => point.x), ys = raw.map(point => point.y);
  const diagonal = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const baseTolerance = Math.max(0.25, diagonal * (options.toleranceScale ?? 0.008)), areaOriginal = signedArea(raw);
  const areaLimit = options.maxAreaDeltaPercent ?? (Math.abs(areaOriginal) < 50 ? 10 : 5);
  const deviationLimit = options.maxBoundaryDeviation ?? Math.max(1.5, diagonal * 0.005);
  for (let attempt = 0; attempt < 3; attempt++) {
    const tolerance = baseTolerance / 2 ** attempt;
    let points = simplifyClosed(raw, tolerance, cornerKinds);
    if (areaOriginal * signedArea(points) < 0) points = [...points].reverse();
    const areaSimplified = signedArea(points), areaDeltaPercent = Math.abs(areaSimplified - areaOriginal) / Math.max(1, Math.abs(areaOriginal)) * 100;
    const boundary = deviations(raw, points);
    const valid = points.length >= 3 && Math.abs(areaSimplified) > 0 && Math.sign(areaSimplified) === Math.sign(areaOriginal)
      && areaDeltaPercent <= areaLimit && boundary.max <= deviationLimit && !hasSelfIntersection(points);
    if (valid) return { points, cornerKinds, hardCorners, softCorners, maxDeviation: boundary.max, meanDeviation: boundary.mean,
      areaOriginal, areaSimplified, areaDeltaPercent, toleranceUsed: tolerance, fallbackUsed: attempt > 0, attempts: attempt + 1 };
  }
  return { points: raw.map(point => ({ ...point })), cornerKinds, hardCorners, softCorners, maxDeviation: 0, meanDeviation: 0,
    areaOriginal, areaSimplified: areaOriginal, areaDeltaPercent: 0, toleranceUsed: 0, fallbackUsed: true, attempts: 3 };
}
