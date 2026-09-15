import type { RasterNode } from '../pdm/types';
import { buildVectorGroupFromSvg, type BuildVectorGroupResult } from '../vectorizer/svgParser';
import { vectorizeWithRecoveredEngine, type VectorEngineDependencies } from './vectorEngine';
import { NodeCliVectoExecutor } from './nodeVectoExecutor';
import type { RgbaRaster, VectorEngineEvidence, VectorEngineResult } from './types';

export interface PdmVectorEngineResult extends BuildVectorGroupResult {
  svgString: string;
  durationMs: number;
  engineResult: VectorEngineResult;
  evidence: VectorEngineEvidence;
}

export interface PdmVectorEngineOptions {
  dependencies?: VectorEngineDependencies;
  customPresetName?: string;
}

export async function vectorizeRasterToPdmWithEngine(
  raster: RgbaRaster,
  sourceRasterNode: RasterNode,
  options: PdmVectorEngineOptions = {}
): Promise<PdmVectorEngineResult> {
  const t0 = performance.now();

  const defaultVecto = new NodeCliVectoExecutor();
  const deps: VectorEngineDependencies = options.dependencies || {
    directVecto: defaultVecto,
    regionGraphVecto: defaultVecto,
  };

  const engineResult = await vectorizeWithRecoveredEngine(raster, deps);
  const durationMs = Math.round(performance.now() - t0);

  const vectorGroup = buildVectorGroupFromSvg({
    svgString: engineResult.svg,
    sourceRasterNodeId: sourceRasterNode.id,
    name: `Vetor (${engineResult.backend}): ${sourceRasterNode.name}`,
    physicalWidth_mm: sourceRasterNode.physicalWidth_mm,
    physicalHeight_mm: sourceRasterNode.physicalHeight_mm,
    position_mm: {
      x: sourceRasterNode.position_mm.x,
      y: sourceRasterNode.position_mm.y,
    },
    vectorizationTimeMs: durationMs,
    preset: engineResult.backend,
  });

  return {
    ...vectorGroup,
    svgString: engineResult.svg,
    durationMs,
    engineResult,
    evidence: engineResult.evidence!,
  };
}
