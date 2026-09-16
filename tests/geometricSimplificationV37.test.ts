import { describe, expect, it } from 'vitest';
import { classifyCorners, hasSelfIntersection, signedArea, simplifyRing } from '../src/core/vectorizer/v3/geometricSimplification';
const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
const serrated = [{ x: 0, y: 0 }, { x: 2, y: .1 }, { x: 4, y: 0 }, { x: 6, y: .1 }, { x: 8, y: 0 }, { x: 10, y: 0 },
  { x: 10, y: 10 }, { x: 8, y: 10.1 }, { x: 6, y: 10 }, { x: 4, y: 10.1 }, { x: 2, y: 10 }, { x: 0, y: 10 }];

describe('V3.7 simplification', () => {
  it('simplifies a serrated contour', () => expect(simplifyRing(serrated).points.length).toBeLessThan(serrated.length));
  it('keeps square corners', () => expect(simplifyRing(square).points).toHaveLength(4));
  it('preserves a hole', () => expect(simplifyRing([...square].reverse()).points.length).toBeGreaterThanOrEqual(3));
  it('keeps the inner corner of an L shape', () => {
    const ring = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 12 }, { x: 0, y: 12 }];
    expect(simplifyRing(ring).points).toContainEqual({ x: 4, y: 4 });
  });
  it('simplifies a shared boundary compatibly in either direction', () => {
    const boundary = [{ x: 0, y: 0 }, { x: 2, y: .05 }, { x: 4, y: 0 }, { x: 6, y: .05 }, { x: 8, y: 0 }];
    const a = simplifyRing([...boundary, { x: 8, y: 5 }, { x: 0, y: 5 }]).points.filter(p => p.y >= 0 && p.y <= .05).map(p => p.x).sort((x, y) => x - y);
    const b = simplifyRing([...boundary].reverse().concat([{ x: 0, y: -5 }, { x: 8, y: -5 }])).points.filter(p => p.y >= 0 && p.y <= .05).map(p => p.x).sort((x, y) => x - y);
    expect(b).toEqual(a);
  });
  it('does not create self-intersections', () => expect(hasSelfIntersection(simplifyRing(serrated).points)).toBe(false));
  it('does not degenerate a small contour', () => expect(simplifyRing([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]).points.length).toBeGreaterThanOrEqual(3));
  it('is deterministic', () => expect(simplifyRing(serrated)).toEqual(simplifyRing(serrated)));
  it('falls back deterministically when the fidelity guard rejects every attempt', () => {
    const first = simplifyRing(serrated, { maxBoundaryDeviation: -1 });
    expect(first.fallbackUsed).toBe(true); expect(first.points).toEqual(serrated);
    expect(simplifyRing(serrated, { maxBoundaryDeviation: -1 })).toEqual(first);
  });
  it('retries only the contour that exceeds its fidelity limit', () => {
    const sensitive = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 5, y: 1 }, { x: 6, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 2 }, { x: 0, y: 2 }];
    const result = simplifyRing(sensitive, { toleranceScale: .15, maxAreaDeltaPercent: 1, maxBoundaryDeviation: 10 });
    expect(result.attempts).toBeGreaterThan(1);
    expect(result.areaDeltaPercent).toBeLessThanOrEqual(1);
  });
  it('keeps the original tolerance for a contour already within fidelity', () => {
    const result = simplifyRing(square);
    expect(result.attempts).toBe(1);
    expect(result.fallbackUsed).toBe(false);
  });
  it('preserves outer and hole orientation', () => {
    expect(Math.sign(signedArea(simplifyRing(square).points))).toBe(-Math.sign(signedArea(simplifyRing([...square].reverse()).points)));
  });
  it('classifies hard and soft corners from geometry', () => {
    expect(classifyCorners(square).filter(kind => kind === 'HARD_CORNER')).toHaveLength(4);
    expect(classifyCorners(serrated).filter(kind => kind === 'SOFT_CORNER').length).toBeGreaterThan(0);
  });
});
