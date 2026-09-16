import { describe, expect, it } from 'vitest';
import { analyzeArtworkMode, simplifyFlatRegions } from '../src/core/vectorizer/v3/modeAwareSegmentation';

function raster(colors: readonly (readonly [number,number,number,number])[], labels: readonly number[]) { const data=new Uint8Array(colors.length*4);colors.forEach((c,i)=>data.set(c,i*4));return {bitmap:{width:colors.length,height:1,data},labels:Int32Array.from(labels)} }
describe('V3.3 mode-aware segmentation',()=>{
 it('classifies flat colors with an antialias transition as FLAT_LOGO',()=>{const x=raster([[0,0,0,255],[120,120,120,255],[255,255,255,255]],[0,1,2]);expect(analyzeArtworkMode(x.bitmap,x.labels).mode).toBe('FLAT_LOGO')});
 it('does not promote a small different structural color to a prototype assignment',()=>{const x=raster([[255,255,255,255],[255,80,0,255],[255,255,255,255]],[0,1,0]);expect(simplifyFlatRegions(x.bitmap,x.labels).labels[1]).toBe(1)});
 it('keeps a strong black-white boundary instead of assigning either structural side',()=>{const x=raster([[0,0,0,255],[255,255,255,255]],[0,1]);const result=simplifyFlatRegions(x.bitmap,x.labels);expect([...result.labels]).toEqual([0,1])});
 it('skips flat simplification for detailed variation',()=>{const x=raster([[0,0,0,255],[50,90,120,255],[130,30,80,255],[220,220,30,255]],[0,1,2,3]);expect(simplifyFlatRegions(x.bitmap,x.labels,{forceMode:'DETAILED_ART'}).applied).toBe(false)});
 it('routes textured multi-color data to the detailed control path',()=>{const x=raster([[0,0,0,255],[255,0,0,255],[0,255,0,255],[0,0,255,255],[255,255,0,255],[255,0,255,255],[0,255,255,255],[255,255,255,255],[80,40,20,255]],[0,1,2,3,4,5,6,7,8]);expect(analyzeArtworkMode(x.bitmap,x.labels).mode).toBe('DETAILED_ART')});
 it('is deterministic',()=>{const x=raster([[0,0,0,255],[120,120,120,255],[255,255,255,255]],[0,1,2]);expect(simplifyFlatRegions(x.bitmap,x.labels)).toEqual(simplifyFlatRegions(x.bitmap,x.labels))});
});
