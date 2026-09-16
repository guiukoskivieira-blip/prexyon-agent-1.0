import { describe, expect, it } from 'vitest';
import { traceColorMasks } from '../src/core/vectorizer/v2/maskTracing';
import type { ColorMask } from '../src/core/vectorizer/v2/adaptivePreprocess';

const mask = (color: [number, number, number], values: number[]): ColorMask => ({ color:{r:color[0],g:color[1],b:color[2]}, pixelCount:values.filter(Boolean).length, coverageRatio:values.filter(Boolean).length/values.length, bounds:{x:0,y:0,width:2,height:1}, mask:new Uint8Array(values) });

describe('V2.4 mask tracing', () => {
  it('traça máscaras separadamente e recompõe cores, topologia e dimensão', () => {
    const seen: Uint8Array[] = [];
    const result = traceColorMasks(2, 1, [mask([255,0,0],[255,0]), mask([0,0,255],[0,128])], (rgba) => { seen.push(rgba); return '<svg viewBox="0 0 2 1"><path d="M0 0L1 0Z" fill="#000" fill-rule="evenodd"/></svg>'; });
    expect(seen).toHaveLength(2);
    expect(seen[1][7]).toBe(128);
    expect(result.svg).toContain('viewBox="0 0 2 1"');
    expect(result.svg).toContain('fill="#ff0000"');
    expect(result.svg).toContain('fill="#0000ff"');
    expect(result.svg).toContain('fill-rule="evenodd"');
    expect(result.failures).toEqual([]);
    expect(traceColorMasks(2,1,[mask([1,2,3],[255,0])],()=>'<svg><path d="M0 0Z"/></svg>').svg).toBe(traceColorMasks(2,1,[mask([1,2,3],[255,0])],()=>'<svg><path d="M0 0Z"/></svg>').svg);
  });

  it('registra máscara vazia sem fallback silencioso', () => {
    const empty = mask([0,0,0],[0,0]);
    const result = traceColorMasks(2,1,[empty],()=>'<svg/>');
    expect(result.failures).toEqual([{ maskIndex:0, reason:'EMPTY_MASK' }]);
  });
});
