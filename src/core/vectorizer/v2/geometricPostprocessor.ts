export interface GeometricPostprocessResult {
  svg: string;
  tolerance: number;
  removedNodeCount: number;
}

interface Point {
  x: number;
  y: number;
}

interface LinearSubpath {
  points: Point[];
  closed: boolean;
}

const NUMBER = '[-+]?(?:\\d*\\.\\d+|\\d+\\.?)(?:[eE][-+]?\\d+)?';
const TOKEN_RE = new RegExp(`[MLZ]|${NUMBER}`, 'g');

function geometryTolerance(svg: string): number {
  const viewBox = svg.match(/\bviewBox\s*=\s*["']\s*([^"']+)["']/i)?.[1]
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  let extent = 0;
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite)) {
    extent = Math.max(Math.abs(viewBox[2]), Math.abs(viewBox[3]));
  } else {
    const width = Number(svg.match(/\bwidth\s*=\s*["']\s*([^"'a-z]+)/i)?.[1]);
    const height = Number(svg.match(/\bheight\s*=\s*["']\s*([^"'a-z]+)/i)?.[1]);
    extent = Math.max(Number.isFinite(width) ? Math.abs(width) : 0, Number.isFinite(height) ? Math.abs(height) : 0);
  }
  return Math.min(0.05, Math.max(0.001, extent * 0.00025));
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function distanceToSegment(point: Point, start: Point, end: Point): { distance: number; projection: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const squaredLength = dx * dx + dy * dy;
  if (squaredLength === 0) return { distance: distance(point, start), projection: 0 };
  const projection = ((point.x - start.x) * dx + (point.y - start.y) * dy) / squaredLength;
  const projected = { x: start.x + projection * dx, y: start.y + projection * dy };
  return { distance: distance(point, projected), projection };
}

function parseLinearPath(d: string): LinearSubpath[] | null {
  if (/[^MLZ0-9eE+.,\s-]/.test(d)) return null;
  const tokens = d.match(TOKEN_RE) ?? [];
  if (tokens.join('').length === 0) return null;
  const subpaths: LinearSubpath[] = [];
  let index = 0;
  let command = '';
  let active: LinearSubpath | null = null;

  while (index < tokens.length) {
    if (/^[MLZ]$/.test(tokens[index])) command = tokens[index++];
    if (command === 'Z') {
      if (!active) return null;
      active.closed = true;
      command = '';
      continue;
    }
    if (command !== 'M' && command !== 'L') return null;
    if (index + 1 >= tokens.length || /^[MLZ]$/.test(tokens[index]) || /^[MLZ]$/.test(tokens[index + 1])) return null;
    const point = { x: Number(tokens[index++]), y: Number(tokens[index++]) };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    if (command === 'M') {
      active = { points: [point], closed: false };
      subpaths.push(active);
      command = 'L';
    } else if (active) {
      active.points.push(point);
    } else {
      return null;
    }
  }
  return subpaths.length > 0 ? subpaths : null;
}

function simplifyPoints(points: Point[], tolerance: number): { points: Point[]; removed: number } {
  if (points.length < 3) return { points, removed: 0 };
  const nearZeroTolerance = tolerance * 0.1;
  const deduplicated: Point[] = [];
  let removed = 0;
  for (const point of points) {
    const previous = deduplicated[deduplicated.length - 1];
    if (previous && distance(previous, point) <= nearZeroTolerance) {
      removed++;
    } else {
      deduplicated.push(point);
    }
  }

  const simplified: Point[] = [];
  for (const point of deduplicated) {
    simplified.push(point);
    while (simplified.length >= 3) {
      const start = simplified[simplified.length - 3];
      const middle = simplified[simplified.length - 2];
      const end = simplified[simplified.length - 1];
      const line = distanceToSegment(middle, start, end);
      const forward = (middle.x - start.x) * (end.x - middle.x) + (middle.y - start.y) * (end.y - middle.y);
      if (line.distance > tolerance || line.projection <= 0 || line.projection >= 1 || forward <= 0) break;
      simplified.splice(simplified.length - 2, 1);
      removed++;
    }
  }
  return { points: simplified, removed };
}

function formatNumber(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function serializeLinearPath(subpaths: LinearSubpath[]): string {
  return subpaths.map((subpath) => {
    const [first, ...rest] = subpath.points;
    const commands = [`M${formatNumber(first.x)} ${formatNumber(first.y)}`];
    for (const point of rest) commands.push(`L${formatNumber(point.x)} ${formatNumber(point.y)}`);
    if (subpath.closed) commands.push('Z');
    return commands.join(' ');
  }).join(' ');
}

export function postprocessVTracerSvg(svg: string): GeometricPostprocessResult {
  const tolerance = geometryTolerance(svg);
  let removedNodeCount = 0;
  const processed = svg.replace(/<path\b[^>]*>/gi, (pathTag) => {
    const dMatch = /\bd\s*=\s*(["'])([^"']+)\1/i.exec(pathTag);
    if (!dMatch) return pathTag;
    const subpaths = parseLinearPath(dMatch[2]);
    if (!subpaths) return pathTag;
    let pathRemovedNodeCount = 0;
    const simplified = subpaths.map((subpath) => {
      const result = simplifyPoints(subpath.points, tolerance);
      removedNodeCount += result.removed;
      pathRemovedNodeCount += result.removed;
      return { ...subpath, points: result.points };
    });
    if (pathRemovedNodeCount === 0) return pathTag;
    const replacement = `d=${dMatch[1]}${serializeLinearPath(simplified)}${dMatch[1]}`;
    return pathTag.slice(0, dMatch.index) + replacement + pathTag.slice(dMatch.index + dMatch[0].length);
  });
  return { svg: processed, tolerance, removedNodeCount };
}
