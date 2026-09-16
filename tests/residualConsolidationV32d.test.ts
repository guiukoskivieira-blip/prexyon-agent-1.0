import { describe, expect, it } from 'vitest';
import { consolidateResidualRegions } from '../src/core/vectorizer/v3/residualConsolidation';

function raster(colors: readonly (readonly [number, number, number, number])[], labels: readonly number[]) {
  const data = new Uint8Array(colors.length * 4);
  colors.forEach((color, index) => data.set(color, index * 4));
  return { bitmap: { width: colors.length, height: 1, data }, labels: Int32Array.from(labels) };
}

describe('V3.2D residual consolidation', () => {
  it('classifies a thin intermediate strip between two regions as EDGE_TRANSITION', () => {
    const input = raster([[255, 255, 255, 255], [160, 160, 160, 255], [100, 100, 100, 255]], [0, 1, 2]);
    expect(consolidateResidualRegions(input.bitmap, input.labels).classifications[1]).toBe('EDGE_TRANSITION_REGION');
  });

  it('keeps a compact small detail with its own strong contrast as LEGITIMATE_DETAIL', () => {
    const input = raster([[255, 255, 255, 255], [255, 80, 0, 255], [255, 255, 255, 255]], [0, 1, 0]);
    expect(consolidateResidualRegions(input.bitmap, input.labels).classifications[1]).toBe('LEGITIMATE_DETAIL');
  });

  it('does not merge an uncertain region', () => {
    const input = raster([[255, 255, 255, 255], [210, 140, 30, 255], [0, 0, 0, 255]], [0, 1, 2]);
    const result = consolidateResidualRegions(input.bitmap, input.labels);
    expect(result.classifications[1]).toBe('UNCERTAIN');
    expect(result.labels[1]).toBe(1);
  });

  it('does not cross a strong chromatic boundary during consolidation', () => {
    const input = raster([[255, 255, 255, 255], [100, 100, 100, 255], [0, 0, 0, 255]], [0, 1, 2]);
    expect(consolidateResidualRegions(input.bitmap, input.labels).labels[1]).toBe(1);
  });

  it('does not absorb a structural near-color region based on color alone', () => {
    const input = raster([[220, 20, 20, 255], [205, 20, 20, 255], [220, 20, 20, 255]], [0, 1, 2]);
    expect(consolidateResidualRegions(input.bitmap, input.labels).labels[1]).toBe(1);
  });

  it('does not create a false chromatic transition from alpha alone', () => {
    const input = raster([[220, 20, 20, 255], [220, 20, 20, 128], [220, 20, 20, 255]], [0, 1, 2]);
    expect(consolidateResidualRegions(input.bitmap, input.labels).classifications[1]).not.toBe('EDGE_TRANSITION_REGION');
  });
});
