import { describe, expect, it } from 'vitest';
import { reconstructSeededPrototypeField } from '../src/core/vectorizer/v3/seededPrototypeField';

const region = (id: number, l: number, area = 1) => ({ id, area, meanOklab: { l, a: 0, b: 0 }, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, coverage: 1 });
const edge = (regionA: number, regionB: number, strength = .1) => ({ regionA, regionB, sharedBoundaryLength: 1, averageBoundaryStrength: strength, maximumBoundaryStrength: strength, colorDistance: Math.abs(regionA - regionB), coverageDifference: 0 });
function field(width: number, labels: number[], levels: number[], structural: number[], edges = [] as ReturnType<typeof edge>[]) {
  const data = new Uint8ClampedArray(labels.length * 4);
  levels.forEach((level, index) => { data[index * 4] = data[index * 4 + 1] = data[index * 4 + 2] = Math.round(level * 255); data[index * 4 + 3] = 255; });
  return reconstructSeededPrototypeField({ bitmap: { width, height: labels.length / width, data }, labels: Int32Array.from(labels), regions: [...new Set(labels)].filter((id) => id >= 0).map((id) => region(id, levels[labels.indexOf(id)])), edges, structuralRegionIds: structural, prototypes: [{ id: 0, color: { l: 0, a: 0, b: 0 } }, { id: 1, color: { l: 1, a: 0, b: 0 } }] });
}

describe('V3.5 seeded prototype field', () => {
  it('assigns an antialias gap between two seed components', () => { const result = field(3, [0, 2, 1], [0, .5, 1], [0, 1]); expect(result.metrics.assignedPixelCount).toBeGreaterThan(0); expect(result.componentLabels[1]).not.toBe(-1); });
  it('does not cross a strong boundary when color alone would favor the other seed', () => { const result = field(3, [0, 2, 1], [0, .95, 1], [0, 1], [edge(0, 2, .9), edge(2, 1, .1)]); expect(result.prototypeLabels[1]).toBe(1); expect(result.metrics.strongBoundaryViolations).toBe(0); });
  it('keeps disconnected islands of one prototype as distinct components', () => { const result = field(3, [0, 1, 0], [0, 1, 0], [0, 1]); expect(result.componentLabels[0]).not.toBe(result.componentLabels[2]); });
  it('lets background compete at a boundary', () => { const result = field(3, [0, 2, 1], [0, .1, 1], [0, 1]); expect(result.prototypeLabels[1]).toBe(0); });
  it('preserves a background hole within a seeded outer object', () => { const result = field(3, [0, 0, 0, 0, 1, 0, 0, 0, 0], [0, 0, 0, 0, 1, 0, 0, 0, 0], [0, 1]); expect(result.prototypeLabels[4]).toBe(1); });
  it('marks equal-cost competition as ambiguous', () => { const result = field(3, [0, 2, 1], [0, .39, 1], [0, 1]); expect(result.ambiguousPixels).toContain(1); });
  it('is deterministic', () => { const source = () => field(3, [0, 2, 1], [0, .39, 1], [0, 1]); const first = source(); const second = source(); expect({ labels: first.componentLabels, prototypes: first.prototypeLabels, ambiguous: first.ambiguousPixels }).toEqual({ labels: second.componentLabels, prototypes: second.prototypeLabels, ambiguous: second.ambiguousPixels }); });
});
