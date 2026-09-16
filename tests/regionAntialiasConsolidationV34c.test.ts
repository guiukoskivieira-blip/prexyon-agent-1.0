import { describe, expect, it } from 'vitest';
import { classifyRegionAntialias } from '../src/core/vectorizer/v3/regionAntialiasConsolidation';

const region = (id: number, l: number, area: number, bounds = { minX: id, minY: 0, maxX: id, maxY: 0 }) => ({ id, area, meanOklab: { l, a: 0, b: 0 }, bounds, coverage: 1 });
const edge = (regionA: number, regionB: number, strength = 0.1) => ({ regionA, regionB, sharedBoundaryLength: 8, averageBoundaryStrength: strength, maximumBoundaryStrength: strength, colorDistance: Math.abs(regionA - regionB), coverageDifference: 0 });
const classify = (regions: ReturnType<typeof region>[], edges: ReturnType<typeof edge>[], structural = regions.map((item) => item.id)) => classifyRegionAntialias({ regions, edges, structuralRegionIds: structural, prototypes: [{ id: 0, color: { l: 0, a: 0, b: 0 } }, { id: 2, color: { l: 1, a: 0, b: 0 } }] });

describe('V3.4C region-aware antialias consolidation', () => {
  it('classifies a thin intermediate region between two colors as antialias support', () => {
    const result = classify([region(0, 0, 100), region(1, .5, 4, { minX: 1, minY: 0, maxX: 1, maxY: 7 }), region(2, 1, 100)], [edge(0, 1), edge(1, 2)]);
    expect(result.byRegionId.get(1)).toBe('ANTIALIAS_SUPPORT_REGION');
  });

  it('keeps a compact isolated small point as a legitimate detail', () => {
    const result = classify([region(0, 0, 100), region(1, .5, 4, { minX: 4, minY: 4, maxX: 5, maxY: 5 }), region(2, 1, 100)], [edge(0, 2)]);
    expect(result.byRegionId.get(1)).toBe('LEGITIMATE_SMALL_DETAIL');
  });

  it('does not absorb a separate island with a structural color', () => {
    const result = classify([region(0, 0, 100), region(1, 0, 4, { minX: 5, minY: 5, maxX: 5, maxY: 8 }), region(2, 1, 100)], [edge(0, 2)]);
    expect(result.byRegionId.get(1)).toBe('LEGITIMATE_SMALL_DETAIL');
  });

  it('keeps a strong boundary region intact', () => {
    const result = classify([region(0, 0, 100), region(1, .5, 4, { minX: 1, minY: 0, maxX: 1, maxY: 7 }), region(2, 1, 100)], [edge(0, 1, .8), edge(1, 2, .8)]);
    expect(result.byRegionId.get(1)).toBe('UNCERTAIN');
  });

  it('keeps ambiguous non-thin regions intact', () => {
    const result = classify([region(0, 0, 100), region(1, .5, 9, { minX: 1, minY: 0, maxX: 3, maxY: 2 }), region(2, 1, 100)], [edge(0, 1), edge(1, 2)]);
    expect(result.byRegionId.get(1)).toBe('UNCERTAIN');
  });

  it('is deterministic', () => {
    const source = [region(0, 0, 100), region(1, .5, 4, { minX: 1, minY: 0, maxX: 1, maxY: 7 }), region(2, 1, 100)];
    expect(classify(source, [edge(0, 1), edge(1, 2)])).toEqual(classify(source, [edge(0, 1), edge(1, 2)]));
  });
});
