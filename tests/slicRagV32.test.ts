import { describe, expect, it } from 'vitest';
import { segmentWithSlicRag, type RgbaBitmap } from '../src/core/vectorizer/v3/slicRag';

type Pixel = readonly [number, number, number, number];

function bitmap(rows: readonly (readonly Pixel[])[]): RgbaBitmap {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const data = new Uint8Array(width * height * 4);
  rows.forEach((row, y) => row.forEach((pixel, x) => {
    const offset = (y * width + x) * 4;
    data.set(pixel, offset);
  }));
  return { width, height, data };
}

const CLEAR: Pixel = [0, 0, 0, 0];
const RED: Pixel = [220, 40, 50, 255];
const RED_NEAR: Pixel = [221, 42, 52, 255];
const RED_SEMI: Pixel = [220, 40, 50, 128];
const RED_DARK: Pixel = [195, 32, 42, 255];

describe('SLIC + RAG V3.2', () => {
  it('is deterministic for identical RGBA input', () => {
    const source = bitmap([
      [RED, RED, RED_NEAR, RED_NEAR],
      [RED, RED, RED_NEAR, RED_NEAR],
    ]);
    const first = segmentWithSlicRag(source, { targetSuperpixelArea: 2 });
    const second = segmentWithSlicRag(source, { targetSuperpixelArea: 2 });
    expect([...first.finalLabels]).toEqual([...second.finalLabels]);
    expect({ ...first.metrics, executionTimeMs: 0 }).toEqual({ ...second.metrics, executionTimeMs: 0 });
  });

  it('records only spatially adjacent initial regions in the RAG', () => {
    const source = bitmap([[RED, RED, CLEAR, RED_DARK, RED_DARK]]);
    const result = segmentWithSlicRag(source, { targetSuperpixelArea: 1 });
    expect(result.ragEdges.every((edge) => edge.boundaryLength > 0)).toBe(true);
    expect(result.ragEdges.every((edge) => edge.firstRegion !== edge.secondRegion)).toBe(true);
  });

  it('keeps a strong structural boundary between close chroma regions', () => {
    const source = bitmap([
      [RED, RED, RED_DARK, RED_DARK],
      [RED, RED, RED_DARK, RED_DARK],
    ]);
    const result = segmentWithSlicRag(source, { targetSuperpixelArea: 4, edgeStrengthMultiplier: 30 });
    expect(result.metrics.finalRegionCount).toBe(2);
    expect(result.ragEdges.some((edge) => edge.maximumBoundaryStrength >= 0.45)).toBe(true);
  });

  it('merges a small chroma variation across a weak boundary', () => {
    const source = bitmap([
      [RED, RED, RED_NEAR, RED_NEAR],
      [RED, RED, RED_NEAR, RED_NEAR],
    ]);
    const result = segmentWithSlicRag(source, { targetSuperpixelArea: 2 });
    expect(result.metrics.finalRegionCount).toBe(1);
    expect(result.metrics.mergeCount).toBeGreaterThan(0);
  });

  it('does not create chromatic regions from intermediate alpha alone', () => {
    const source = bitmap([
      [RED, RED, RED_SEMI, RED_SEMI],
      [RED, RED, RED_SEMI, RED_SEMI],
    ]);
    const result = segmentWithSlicRag(source, { targetSuperpixelArea: 2 });
    expect(result.metrics.finalRegionCount).toBe(1);
    expect(result.finalRaster[7]).toBe(255);
    expect(result.finalRaster[15]).toBe(128);
  });

  it('keeps disconnected regions separate even when their chroma matches', () => {
    const source = bitmap([[RED, RED, CLEAR, CLEAR, RED, RED]]);
    const result = segmentWithSlicRag(source, { targetSuperpixelArea: 1 });
    expect(result.metrics.finalRegionCount).toBe(2);
  });
});
