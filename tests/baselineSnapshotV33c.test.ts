import { describe, expect, it } from 'vitest';
import { createStructuralSnapshot, loadStructuralSnapshot } from '../src/core/vectorizer/v3/baselineSnapshot';

const input = {
  name: 'fixture', width: 2, height: 1, inputSha256: 'input', rgbaSha256: 'rgba',
  labels: Int32Array.from([0, 1]), raster: Uint8ClampedArray.from([0, 0, 0, 255, 255, 0, 0, 255]),
  regions: [{ id: 0, area: 1, meanOklab: { l: 0, a: 0, b: 0 }, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, coverage: 1 }, { id: 1, area: 1, meanOklab: { l: 1, a: 0, b: 0 }, bounds: { minX: 1, minY: 0, maxX: 1, maxY: 0 }, coverage: 1 }],
  edges: [{ regionA: 0, regionB: 1, sharedBoundaryLength: 1, averageBoundaryStrength: 0.5, maximumBoundaryStrength: 0.5, colorDistance: 0.2, coverageDifference: 0 }],
};

describe('V3.3C structural baseline snapshot', () => {
  it('round-trips labels, regions and edges', () => { const snapshot = createStructuralSnapshot(input); const loaded = loadStructuralSnapshot(snapshot); expect(loaded.labels).toEqual(input.labels); expect(loaded.regions).toEqual(input.regions); expect(loaded.edges).toEqual(input.edges); });
  it('keeps the deterministic labels hash', () => { const snapshot = createStructuralSnapshot(input); expect(loadStructuralSnapshot(snapshot).metadata.labels.sha256).toBe(snapshot.metadata.labels.sha256); });
  it('rejects corrupted binary labels', () => { const snapshot = createStructuralSnapshot(input); snapshot.labels[0] ^= 1; expect(() => loadStructuralSnapshot(snapshot)).toThrow(/hash/i); });
  it('rejects incompatible dimensions', () => { const snapshot = createStructuralSnapshot(input); snapshot.metadata.width = 3; expect(() => loadStructuralSnapshot(snapshot)).toThrow(/imens/i); });
  it('rebuilds a raster usable by the mode analyzer', () => { const snapshot = createStructuralSnapshot(input); const loaded = loadStructuralSnapshot(snapshot); expect(loaded.bitmap.data).toEqual(input.raster); });
});
