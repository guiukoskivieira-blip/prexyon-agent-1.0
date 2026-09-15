import type { RgbaRaster, VectorEngineResult } from './types';
export interface DirectVectoExecutor { vectorize(raster: RgbaRaster): Promise<string>; }
export async function runDirectVecto(executor: DirectVectoExecutor, raster: RgbaRaster, validationRequired=false): Promise<VectorEngineResult> {
  const svg = await executor.vectorize(raster);
  if (!svg.trim()) throw new Error('Vecto não retornou SVG.');
  return { backend:'DIRECT_VECTO', svg, fillFirst:true, validationRequired };
}
