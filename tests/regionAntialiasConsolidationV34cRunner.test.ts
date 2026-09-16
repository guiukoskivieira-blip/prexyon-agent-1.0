import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { runV34cRegionAntialias } from '../scratch/run-v34c-region-antialias';

describe('V3.4C scratch runner', () => {
  it('writes the multicolor diagnostic outputs from the frozen snapshot', async () => {
    await runV34cRegionAntialias();
    const metrics = JSON.parse(await readFile('scratch/v34c-region-antialias/metrics.json', 'utf8'));
    expect(metrics.baselineRegionCount).toBe(93);
    expect(metrics.structuralRegionCountAfter).toBeLessThanOrEqual(metrics.structuralRegionCountBefore);
  }, 120_000);
});
