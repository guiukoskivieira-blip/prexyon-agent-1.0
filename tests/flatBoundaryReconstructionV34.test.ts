import { describe, expect, it } from 'vitest';
import { reconstructFlatBoundaries } from '../src/core/vectorizer/v3/flatBoundaryReconstruction';

const region = (id:number, l:number, area=1) => ({ id, area, meanOklab:{l,a:0,b:0}, bounds:{minX:id,minY:0,maxX:id,maxY:0}, coverage:1 });
const input = (pixels:number[], labels:number[], regions=labels.map((id)=>region(id, id === 0 ? 0 : 1))) => ({ bitmap:{width:labels.length,height:1,data:Uint8ClampedArray.from(pixels)}, labels:Int32Array.from(labels), regions, edges:[] });
describe('V3.4 flat boundary reconstruction', () => {
  it('builds one shared boundary for two flat colors across antialiasing', () => { const result=reconstructFlatBoundaries(input([0,0,0,255,120,120,120,255,255,255,255,255],[0,1,2],[region(0,0,20),region(1,.5,1),region(2,1,20)])); expect(result.structuralPrototypeCount).toBe(2); expect(result.sharedBoundaries).toHaveLength(1); });
  it('does not promote an intermediate tone to a structural prototype', () => { const result=reconstructFlatBoundaries(input([0,0,0,255,120,120,120,255,255,255,255,255],[0,1,2],[region(0,0,20),region(1,.5,1),region(2,1,20)])); expect(result.structuralRegionIds).not.toContain(1); });
  it('uses coverage as transition evidence', () => { const result=reconstructFlatBoundaries(input([0,0,0,255,120,120,120,128,255,255,255,255],[0,1,2],[region(0,0,20),region(1,.5,1),region(2,1,20)])); expect(result.transitionPixelCount).toBeGreaterThan(0); });
  it('keeps same-color islands as distinct structural regions', () => { const result=reconstructFlatBoundaries(input([0,0,0,255,255,255,255,255,0,0,0,255],[0,1,2],[region(0,0,20),region(1,1,20),region(2,0,20)])); expect(result.structuralRegionIds).toEqual(expect.arrayContaining([0,2])); });
  it('preserves a hole as a distinct structural region', () => { const result=reconstructFlatBoundaries(input([0,0,0,255,255,255,255,255,0,0,0,255],[0,1,0],[region(0,0,40),region(1,1,10)])); expect(result.topologyLoss).toBe(0); });
  it('does not cross strong boundaries', () => { const result=reconstructFlatBoundaries({ ...input([0,0,0,255,255,255,255,255],[0,1],[region(0,0,20),region(1,1,20)]), edges:[{regionA:0,regionB:1,sharedBoundaryLength:1,averageBoundaryStrength:.9,maximumBoundaryStrength:.9,colorDistance:1,coverageDifference:0}] }); expect(result.strongBoundaryViolations).toBe(0); });
  it('is deterministic', () => { const source=input([0,0,0,255,120,120,120,255,255,255,255,255],[0,1,2],[region(0,0,20),region(1,.5,1),region(2,1,20)]); expect(reconstructFlatBoundaries(source)).toEqual(reconstructFlatBoundaries(source)); });
});
