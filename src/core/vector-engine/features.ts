import type { LabColor, RgbaRaster, VectorEngineFeatures } from './types';

export function rgbToLab(r: number, g: number, b: number): LabColor {
  let rr = r / 255; let gg = g / 255; let bb = b / 255;
  rr = rr > 0.04045 ? Math.pow((rr + 0.055) / 1.055, 2.4) : rr / 12.92;
  gg = gg > 0.04045 ? Math.pow((gg + 0.055) / 1.055, 2.4) : gg / 12.92;
  bb = bb > 0.04045 ? Math.pow((bb + 0.055) / 1.055, 2.4) : bb / 12.92;
  const x = (rr * 0.4124564 + gg * 0.3575761 + bb * 0.1804375) / 0.95047;
  const y = rr * 0.2126729 + gg * 0.7151522 + bb * 0.072175;
  const z = (rr * 0.0193339 + gg * 0.119192 + bb * 0.9503041) / 1.08883;
  const f = (v: number) => v > 0.008856 ? Math.pow(v, 1 / 3) : 7.787 * v + 0.13793103;
  return { L: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) };
}
export function deltaE(a: LabColor, b: LabColor): number { const l = a.L-b.L, x = a.a-b.a, y = a.b-b.b; return Math.sqrt(l*l+x*x+y*y); }
export function extractInputFeatures(raster: RgbaRaster): VectorEngineFeatures {
  const { width:w, height:h, data } = raster;
  if (data.length !== w*h*4) throw new Error('Raster RGBA inválido para Vector Engine.');
  const labs = Array.from({length:w*h}, (_, i) => rgbToLab(data[i*4], data[i*4+1], data[i*4+2]));
  const edge = new Uint8Array(w*h);
  for(let y=1;y<h-1;y++) for(let x=1;x<w-1;x++) { const i=y*w+x; let max=0; for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) max=Math.max(max,deltaE(labs[i],labs[(y+dy)*w+x+dx])); if(max>3.8) edge[i]=1; }
  let widthTotal=0, samples=0;
  for(let y=5;y<h-5;y+=4) for(let x=5;x<w-5;x+=4) { const i=y*w+x; if(!edge[i]) continue; const horizontal=deltaE(labs[i-1],labs[i+1]); const vertical=deltaE(labs[i-w],labs[i+w]); const horizontalAxis=horizontal>=vertical; if(Math.max(horizontal,vertical)<=15) continue; let a=0,b=0; const step=horizontalAxis?1:w; while((horizontalAxis ? x-a : y-a)>0 && edge[i-a*step] && a<15) a++; while((horizontalAxis ? x+b : y+b)<(horizontalAxis ? w-1 : h-1) && edge[i+b*step] && b<15) b++; widthTotal+=a+b; samples++; }
  let cpoly=0;
  for(let y=10;y<h-10;y+=12) for(let x=10;x<w-10;x+=12) { const colors=new Set<number>(); for(let dy=-4;dy<=4;dy+=2) for(let dx=-4;dx<=4;dx+=2) { const i=(y+dy)*w+x+dx; if(!edge[i]) { const c=labs[i]; colors.add((Math.trunc(c.L/15)<<16)|(Math.trunc((c.a+128)/15)<<8)|Math.trunc((c.b+128)/15)); } } if(colors.size>=3) cpoly++; }
  return { wramp: samples ? widthTotal/samples : 1, cpoly };
}
