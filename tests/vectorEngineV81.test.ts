import { describe, expect, it } from 'vitest';
import { extractInputFeatures, reconstructRegionGraphV61, routeVectorEngineV12, runDirectVecto, validateVectorEngineResult } from '../src/core/vector-engine';

const raster = (w=24,h=24, color=[255,255,255]) => ({ width:w,height:h,data:new Uint8Array(Array.from({length:w*h},()=>[...color,255]).flat()) });
describe('recovered Vector Engine foundation', () => {
  it.each([[80,1,'REGION_GRAPH'],[79,9.5,'DIRECT_VECTO'],[79,9.51,'ROUTE_UNCERTAIN']] as const)('routes Cpoly=%i Wramp=%f', (cpoly,wramp,backend) => expect(routeVectorEngineV12({cpoly,wramp}).backend).toBe(backend));
  it('preserves the recovered feature fallback and deterministic fixtures', () => { const input=raster(); expect(extractInputFeatures(input)).toEqual({wramp:1,cpoly:0}); expect(extractInputFeatures(input)).toEqual(extractInputFeatures(input)); });
  it('keeps recovered Region Graph constants/invariants: seed components, fill map and alpha', () => { const input=raster(16,16,[20,30,40]); input.data[3]=128; const first=reconstructRegionGraphV61(input); const second=reconstructRegionGraphV61(input); expect(first.metrics).toEqual({ragNodes:1,ragEdges:0,microIslands:0,unsupportedHoles:0}); expect(first.rgba).toEqual(second.rgba); expect(first.rgba[3]).toBe(128); });
  it('uses factual direct Vecto adapter errors and fill-first result', async () => { await expect(runDirectVecto({vectorize:async()=>''},raster())).rejects.toThrow('Vecto não retornou SVG'); const result=await runDirectVecto({vectorize:async()=>'<svg/>'},raster()); expect(result.fillFirst).toBe(true); expect(()=>validateVectorEngineResult(result)).not.toThrow(); });
});
