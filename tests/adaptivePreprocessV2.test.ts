import {describe,it,expect} from 'vitest';import {analyzeArtwork,preprocessLogo} from '../src/core/vectorizer/v2/adaptivePreprocess';
import { runVectorizationBenchmarkSuite } from '../src/core/vectorizer/benchmark';
const bmp=(d:number[])=>({width:3,height:1,data:new Uint8Array(d)});
describe('V2.3 adaptive POC',()=>{it('analisa, quantiza, preserva alpha e cria máscaras determinísticas',()=>{const b=bmp([255,0,0,255,0,255,0,128,0,0,255,0]);const a=analyzeArtwork(b),x=preprocessLogo(b),y=preprocessLogo(b);expect(a.alphaPresence).toBe(true);expect(x.bitmap.data[7]).toBe(128);expect(x.bitmap.data[11]).toBe(0);expect(x.masks.length).toBe(2);expect([...x.bitmap.data]).toEqual([...y.bitmap.data])})});

it('compara V1 e POC nos oito casos com o mesmo VTracer', async () => {
  const report = await runVectorizationBenchmarkSuite();
  expect(report.results).toHaveLength(8);
  expect(report.results.every((result) => result.v2 !== 'NOT_AVAILABLE')).toBe(true);
  expect(report.results.every((result) => result.v24 !== 'NOT_AVAILABLE')).toBe(true);
  console.log('V2_3_COMPARISON=' + JSON.stringify(report.results.map((result) => {
    const pick = (value: typeof result.current) => ({ colors:value.colorMetrics.uniqueFillColorCount,paths:value.geometricMetrics.totalPaths,nodes:value.geometricMetrics.totalNodes,micro:value.geometricMetrics.microObjectCount,holes:value.editabilityMetrics.unexpectedHoleCount,clean:value.geometricMetrics.geometricCleanliness,bytes:value.geometricMetrics.svgSizeBytes,ms:value.geometricMetrics.executionTimeMs });
    return { id:result.caseId,v1:pick(result.current),poc:pick(result.v2 === 'NOT_AVAILABLE' ? result.current : result.v2),v24:pick(result.v24 === 'NOT_AVAILABLE' ? result.current : result.v24) };
  })));
}, 60000);

it('preserva cores sólidas separadas e funde apenas variações perceptualmente próximas', () => {
  const solid = { width: 4, height: 1, data: new Uint8Array([255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,0,255]) };
  const noisy = { width: 3, height: 1, data: new Uint8Array([200,20,20,255, 202,21,19,255, 198,19,22,255]) };
  expect(preprocessLogo(solid).masks).toHaveLength(4);
  expect(preprocessLogo(noisy).masks).toHaveLength(1);
});
