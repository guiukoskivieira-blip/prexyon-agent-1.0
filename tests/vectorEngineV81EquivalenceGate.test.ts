import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractInputFeatures, reconstructRegionGraphV61 } from '../src/core/vector-engine';

const root = 'scratch/v81a-typescript-equivalence';
function raw(name: string, width: number, height: number) { return { width, height, data: new Uint8Array(readFileSync(`${root}/${name}.rgba`)) }; }

describe('V8.1B Wramp equivalence — Burgundy', () => {
  it('matches the recovered oracle Wramp before any Region Graph gate', () => {
    const input = raw('burgundy', 2269, 2347);
    const features = extractInputFeatures(input);
    expect(features.wramp).toBeCloseTo(11.4, 1);
  }, 120_000);

  it('matches the recovered oracle Wramp for Fritolandia only after Burgundy', () => {
    const input = raw('fritolandia', 3176, 2062);
    expect(extractInputFeatures(input).wramp).toBeCloseTo(15.4, 1);
  }, 120_000);

  it('matches the recovered oracle Cpoly for Burgundy', () => {
    expect(extractInputFeatures(raw('burgundy', 2269, 2347)).cpoly).toBe(819);
  }, 120_000);

  it('matches the recovered oracle Cpoly for Fritolandia', () => {
    expect(extractInputFeatures(raw('fritolandia', 3176, 2062)).cpoly).toBe(1464);
  }, 120_000);

  it('matches Burgundy Region Graph metrics and Vecto input pixels', () => {
    const result = reconstructRegionGraphV61(raw('burgundy', 2269, 2347));
    expect(result.metrics).toEqual({ ragNodes: 917, ragEdges: 1622, microIslands: 265, unsupportedHoles: 0 });
    expect(Buffer.from(result.rgba).equals(readFileSync(`${root}/burgundy.oracle-region.rgba`))).toBe(true);
  }, 120_000);

  it('matches Fritolandia Region Graph metrics and Vecto input pixels', () => {
    const result = reconstructRegionGraphV61(raw('fritolandia', 3176, 2062));
    expect(result.metrics).toEqual({ ragNodes: 2842, ragEdges: 4146, microIslands: 721, unsupportedHoles: 0 });
    expect(Buffer.from(result.rgba).equals(readFileSync(`${root}/fritolandia.oracle-region.rgba`))).toBe(true);
  }, 120_000);
});

