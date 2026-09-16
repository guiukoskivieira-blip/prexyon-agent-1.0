import { describe,it,expect } from 'vitest';import { runV36Contours } from '../scratch/run-v36-contours';
describe('V3.6 runner',()=>it('reconstructs contours from V3.5 fields',async()=>{const m=await runV36Contours();expect(m.componentCount).toBe(30);expect(m.openContourCount).toBe(0);},30000));
