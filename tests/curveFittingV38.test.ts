import { describe, expect, it } from 'vitest';
import { fitContour, segmentTypeCount, sampleFittedContour } from '../src/core/vectorizer/v3/curveFitting';

const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }];
const arc = [{ x: 10, y: 0 }, { x: 7, y: 6 }, { x: 0, y: 10 }, { x: -7, y: 6 }, { x: -10, y: 0 }, { x: -7, y: -6 }, { x: 0, y: -10 }, { x: 7, y: -6 }];
const lShape = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 12 }, { x: 0, y: 12 }];

describe('V3.8 cubic Bézier POC', () => {
  it('keeps a straight run as LINE', () => expect(segmentTypeCount(fitContour(line)).cubic).toBe(0));
  it('fits a smooth arc with Bézier segments', () => expect(segmentTypeCount(fitContour(arc)).cubic).toBeGreaterThan(0));
  it('breaks at hard corners', () => {
    const result = fitContour(lShape);
    expect(result.segments.some(segment => segment.type === 'CUBIC')).toBe(false);
    expect(result.segments.length).toBeGreaterThanOrEqual(4);
  });
  it('does not round an L shape', () => expect(segmentTypeCount(fitContour(lShape)).cubic).toBe(0));
  it('represents an ellipse with few curves', () => expect(segmentTypeCount(fitContour(arc.concat([...arc].reverse()))).cubic).toBeLessThan(8));
  it('keeps a hole closed and oriented', () => {
    const result = fitContour([...lShape].reverse());
    const sampled = sampleFittedContour(result, 8);
    expect(sampled.length).toBeGreaterThan(3);
    expect(sampled[0]).toEqual(sampled.at(-1));
  });
  it('reuses an identical shared boundary deterministically', () => {
    expect(fitContour(line)).toEqual(fitContour(line));
  });
  it('does not self-intersect fitted geometry', () => expect(fitContour(arc).selfIntersectionCount).toBe(0));
  it('falls back to lines when the fitting tolerance is impossible', () => {
    const result = fitContour(arc, { maxBoundaryDeviation: 0 });
    expect(result.fallbackRunCount).toBeGreaterThan(0);
    expect(segmentTypeCount(result).cubic).toBe(0);
  });
  it('is deterministic', () => expect(fitContour(arc)).toEqual(fitContour(arc)));
  it('keeps a small contour polygonal', () => {
    const triangle = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }];
    expect(segmentTypeCount(fitContour(triangle)).cubic).toBe(0);
  });
  it('keeps consecutive cubic endpoints continuous', () => {
    const result = fitContour(arc.concat([{ x: -8, y: -6 }, { x: 0, y: -10 }, { x: 8, y: -6 }]));
    for (let i = 1; i < result.segments.length; i++) expect(result.segments[i].p0).toEqual(result.segments[i - 1].p1);
  });
});
