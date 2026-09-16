import { describe, expect, it } from 'vitest';
import { segmentWithSlicRag, type RgbaBitmap } from '../src/core/vectorizer/v3/slicRag';

type Pixel = readonly [number, number, number, number];
const CLEAR: Pixel = [0, 0, 0, 0];
const RED: Pixel = [220, 40, 50, 255];
const BLUE: Pixel = [20, 70, 220, 255];

function bitmap(rows: readonly (readonly Pixel[])[]): RgbaBitmap {
  const width = rows[0].length;
  const data = new Uint8Array(width * rows.length * 4);
  rows.forEach((row, y) => row.forEach((pixel, x) => data.set(pixel, (y * width + x) * 4)));
  return { width, height: rows.length, data };
}

function repeated(row: readonly Pixel[], height = 16): readonly Pixel[][] {
  return Array.from({ length: height }, () => [...row]);
}

describe('SLIC + RAG V3.2B connectedness and coverage', () => {
  it('keeps a raw superpixel logical across a small transparent interruption', () => {
    const source = bitmap(repeated([RED, RED, CLEAR, CLEAR, RED, RED], 8));
    const result = segmentWithSlicRag(source, { targetSuperpixelArea: 64 });
    expect(result.metrics.initialSuperpixelCount).toBe(1);
    expect(result.metrics.finalRegionCount).toBe(1);
  });

  it('does not join distant islands of one raw superpixel automatically', () => {
    const row = [...Array<Pixel>(121).fill(CLEAR)];
    row[0] = RED;
    row[64] = RED;
    row[120] = RED;
    const result = segmentWithSlicRag(bitmap(repeated(row, 65)), { targetSuperpixelArea: 16384 });
    expect(result.metrics.initialSuperpixelCount).toBe(3);
  });

  it('does not make an alpha-only transition a maximum structural boundary', () => {
    const source = bitmap(repeated([[220, 40, 50, 255], [220, 40, 50, 128]]));
    const result = segmentWithSlicRag(source, { targetSuperpixelArea: 16 });
    expect(Math.max(...result.edgeMap)).toBeLessThan(0.45);
  });

  it('retains a strong structural boundary for distinct chroma', () => {
    const source = bitmap(repeated([RED, BLUE]));
    const result = segmentWithSlicRag(source, { targetSuperpixelArea: 16 });
    expect(Math.max(...result.edgeMap)).toBeGreaterThanOrEqual(0.45);
  });
});
