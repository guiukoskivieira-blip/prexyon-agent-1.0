import { describe, expect, it } from 'vitest';
import { extractComponentContours } from '../src/core/vectorizer/v3/geometricContourReconstruction';
const map = (width:number, values:number[]) => Int32Array.from(values);
describe('V3.6 geometric contours', () => {
  it('extracts a closed square', () => expect(extractComponentContours(map(2,[1,1,1,1]),2,2).components[0].outer.length).toBe(4));
  it('detects a hole', () => expect(extractComponentContours(map(3,[1,1,1,1,0,1,1,1,1]),3,3).components.find(x=>x.componentId===1)?.holes).toHaveLength(1));
  it('keeps disconnected islands separate', () => expect(extractComponentContours(map(3,[1,-1,1]),3,1).components).toHaveLength(2));
  it('records a shared boundary for adjacent components', () => expect(extractComponentContours(map(2,[1,2]),2,1).sharedBoundaryPairs).toHaveLength(1));
  it('handles a one-pixel thin contour', () => expect(extractComponentContours(map(3,[-1,1,-1]),3,1).metrics.openContourCount).toBe(0));
  it('does not join corner-touching components', () => expect(extractComponentContours(map(2,[1,-1,-1,1]),2,2).components).toHaveLength(2));
  it('uses opposing orientation for outer and hole', () => { const c=extractComponentContours(map(3,[1,1,1,1,0,1,1,1,1]),3,3).components.find(x=>x.componentId===1)!; expect(Math.sign(c.outerArea)).not.toBe(Math.sign(c.holeAreas[0])); });
  it('is deterministic', () => { const a=extractComponentContours(map(2,[1,2,1,2]),2,2); const b=extractComponentContours(map(2,[1,2,1,2]),2,2); expect({components:a.components,pairs:a.sharedBoundaryPairs}).toEqual({components:b.components,pairs:b.sharedBoundaryPairs}); });
});
