import { extractInputFeatures } from './features';
import { reconstructRegionGraphV61 } from './regionGraphV61';
import { routeVectorEngineV12 } from './routerV12';
import { runDirectVecto, type DirectVectoExecutor } from './directVectoBackend';
import type { RgbaRaster, VectorEngineResult, VectorEngineEvidence } from './types';

export interface VectorEngineDependencies {
  directVecto: DirectVectoExecutor;
  regionGraphVecto: DirectVectoExecutor;
}

export async function vectorizeWithRecoveredEngine(
  raster: RgbaRaster,
  deps: VectorEngineDependencies
): Promise<VectorEngineResult> {
  const features = extractInputFeatures(raster);
  const route = routeVectorEngineV12(features);

  const evidence: VectorEngineEvidence = {
    backendUsed: route.preferredBackend,
    route: route.backend,
    wramp: features.wramp,
    cpoly: features.cpoly,
    requiresValidation: route.requiresValidation,
  };

  if (route.preferredBackend === 'DIRECT_VECTO') {
    const directResult = await runDirectVecto(deps.directVecto, raster, route.requiresValidation);
    const result: VectorEngineResult = {
      ...directResult,
      evidence,
    };
    validateVectorEngineResult(result);
    return result;
  }

  const region = reconstructRegionGraphV61(raster);
  const svg = await deps.regionGraphVecto.vectorize({ ...raster, data: region.rgba });
  if (!svg || !svg.trim()) {
    throw new Error('Vecto não retornou SVG para Region Graph.');
  }

  const result: VectorEngineResult = {
    backend: 'REGION_GRAPH',
    svg,
    fillFirst: true,
    validationRequired: false,
    regionGraph: region.metrics,
    evidence,
  };
  validateVectorEngineResult(result);
  return result;
}

export function validateVectorEngineResult(result: VectorEngineResult): void {
  if (!result || typeof result !== 'object') {
    throw new Error('Resultado do Vector Engine inválido ou nulo.');
  }
  if (!result.fillFirst || !result.svg.trim()) {
    throw new Error('Resultado vetorial inválido para o contrato fill-first.');
  }
  if (result.backend === 'REGION_GRAPH' && !result.regionGraph) {
    throw new Error('Resultado Region Graph sem métricas.');
  }
  if (result.evidence && result.evidence.backendUsed !== result.backend) {
    throw new Error(`Inconsistência de evidência: backendUsed (${result.evidence.backendUsed}) != backend (${result.backend}).`);
  }
}


