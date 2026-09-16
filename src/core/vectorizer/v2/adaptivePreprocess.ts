import { analyzeArtwork, type ArtworkAnalysis, type RgbaBitmap } from './adaptiveRasterAnalyzer';
export { analyzeArtwork, type ArtworkAnalysis } from './adaptiveRasterAnalyzer';
export interface ColorMask { color:{r:number;g:number;b:number}; pixelCount:number; coverageRatio:number; bounds:{x:number;y:number;width:number;height:number}; mask:Uint8Array }
type Lab=[number,number,number];
interface Cluster { rgb:[number,number,number]; lab:Lab; count:number }

function oklab(r:number,g:number,b:number):Lab { const f=(x:number)=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4};const l=Math.cbrt(.4122214708*f(r)+.5363325363*f(g)+.0514459929*f(b)),m=Math.cbrt(.2119034982*f(r)+.6806995451*f(g)+.1073969566*f(b)),s=Math.cbrt(.0883024619*f(r)+.2817188376*f(g)+.6299787005*f(b));return [.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s] }
const distance=(a:Lab,b:Lab)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);

export function preprocessLogo(bitmap:RgbaBitmap, mergeThreshold=0.025):{bitmap:RgbaBitmap;masks:ColorMask[];analysis:ArtworkAnalysis}{
  const clusters:Cluster[]=[];
  for(let i=0;i<bitmap.width*bitmap.height;i++){const p=i*4;if(bitmap.data[p+3]===0)continue;const rgb:[number,number,number]=[bitmap.data[p],bitmap.data[p+1],bitmap.data[p+2]],lab=oklab(...rgb);let nearest=-1,best=Infinity;clusters.forEach((c,j)=>{const d=distance(lab,c.lab);if(d<best){best=d;nearest=j}});if(nearest<0||best>mergeThreshold)clusters.push({rgb,lab,count:1});else{const c=clusters[nearest],n=c.count+1;c.rgb=c.rgb.map((v,j)=>Math.round((v*c.count+rgb[j])/n)) as [number,number,number];c.lab=oklab(...c.rgb);c.count=n}}
  const out=new Uint8Array(bitmap.data),masks=clusters.map(()=>new Uint8Array(bitmap.width*bitmap.height));
  for(let i=0;i<bitmap.width*bitmap.height;i++){const p=i*4;if(out[p+3]===0)continue;const lab=oklab(out[p],out[p+1],out[p+2]);let nearest=0,best=Infinity;clusters.forEach((c,j)=>{const d=distance(lab,c.lab);if(d<best){best=d;nearest=j}});out[p]=clusters[nearest].rgb[0];out[p+1]=clusters[nearest].rgb[1];out[p+2]=clusters[nearest].rgb[2];masks[nearest][i]=out[p+3]}
  const colorMasks=clusters.map((c,index)=>{let count=0,minX=bitmap.width,minY=bitmap.height,maxX=-1,maxY=-1;masks[index].forEach((a,i)=>{if(!a)return;count++;const x=i%bitmap.width,y=Math.floor(i/bitmap.width);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)});return {color:{r:c.rgb[0],g:c.rgb[1],b:c.rgb[2]},pixelCount:count,coverageRatio:count/(bitmap.width*bitmap.height),bounds:{x:count?minX:0,y:count?minY:0,width:count?maxX-minX+1:0,height:count?maxY-minY+1:0},mask:masks[index]}});
  return {bitmap:{...bitmap,data:out},masks:colorMasks,analysis:analyzeArtwork(bitmap)};
}
