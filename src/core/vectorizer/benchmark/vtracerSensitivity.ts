import { evaluateBenchmarkCase } from './metrics';
import type { VectorBenchmarkCase } from './types';
import { createNodeVTracerInstance } from './runner';
import { getVTracerOptionsForPreset } from '../presets';
import type { VTracerOptions, VTracerWasmInstance } from '../vtracerWasmCore';
import { NOISY_LOGO_OVERRIDES } from '../v2/adaptiveVTracerSelector';

export type VTracerSensitivityVariantId = 'CLEAN_LOGO' | 'NOISY_LOGO' | 'DETAIL_PRESERVE';

export interface VTracerSensitivityVariant {
  options: VTracerOptions;
  rationale: string;
}

const baselineLogo = getVTracerOptionsForPreset('logo');

export const VTRACER_SENSITIVITY_VARIANTS: Record<VTracerSensitivityVariantId, VTracerSensitivityVariant> = {
  CLEAN_LOGO: {
    options: {
      ...baselineLogo,
      filterSpeckle: 14,
    },
    rationale: 'Eleva somente o filtro de componentes isolados ao valor já usado pelo preset simple; mantém os controles de canto e curva do baseline.',
  },
  NOISY_LOGO: {
    options: {
      ...baselineLogo,
      ...NOISY_LOGO_OVERRIDES,
    },
    rationale: 'Reutiliza os controles de ruído, separação cromática e simplificação do preset simple, preservando corner/length/splice do baseline logo.',
  },
  DETAIL_PRESERVE: {
    options: {
      ...baselineLogo,
      filterSpeckle: 2,
      lengthThreshold: 2,
      simplify: 0.5,
    },
    rationale: 'Reutiliza os limites de speckle, comprimento e simplificação do preset detailed para evitar eliminar hairlines e pequenos detalhes.',
  },
};

export interface VTracerSensitivityMetrics {
  totalPaths: number;
  totalNodes: number;
  microObjectCount: number;
  trueHoleCount: number;
  unexpectedHoleCount: number | 'NOT_AVAILABLE';
  geometricCleanliness: 'CLEAN' | 'MODERATE' | 'NOISY';
  svgSizeBytes: number;
  executionTimeMs: number;
  uniqueFillColorCount: number;
  subpathCount: number;
}

export interface VTracerSensitivityCaseResult {
  caseId: string;
  category: VectorBenchmarkCase['category'];
  baseline: VTracerSensitivityMetrics;
  variants: Record<VTracerSensitivityVariantId, VTracerSensitivityMetrics>;
}

export function traceVTracerSensitivityCase(
  wasm: VTracerWasmInstance,
  benchmarkCase: VectorBenchmarkCase,
  options: VTracerOptions
): VTracerSensitivityMetrics {
  const bitmap = benchmarkCase.getBitmap();
  const startedAt = performance.now();
  let svg: string;
  try {
    svg = wasm.vectorizeRgba(bitmap.data, bitmap.width, bitmap.height, options);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    svg = `<svg viewBox="0 0 ${bitmap.width} ${bitmap.height}"><!-- Error: ${message} --></svg>`;
  }
  const executionTimeMs = Math.max(1, Math.round(performance.now() - startedAt));
  const result = evaluateBenchmarkCase(benchmarkCase, svg, executionTimeMs, 'CURRENT_V1');
  return {
    totalPaths: result.geometricMetrics.totalPaths,
    totalNodes: result.geometricMetrics.totalNodes,
    microObjectCount: result.geometricMetrics.microObjectCount,
    trueHoleCount: result.topologyMetrics.trueHoleCount,
    unexpectedHoleCount: result.editabilityMetrics.unexpectedHoleCount,
    geometricCleanliness: result.geometricMetrics.geometricCleanliness,
    svgSizeBytes: result.geometricMetrics.svgSizeBytes,
    executionTimeMs: result.geometricMetrics.executionTimeMs,
    uniqueFillColorCount: result.colorMetrics.uniqueFillColorCount,
    subpathCount: result.geometricMetrics.totalSubpaths,
  };
}

export async function runVTracerSensitivityBenchmark(
  cases: VectorBenchmarkCase[],
  wasmInstance?: VTracerWasmInstance
): Promise<VTracerSensitivityCaseResult[]> {
  const wasm = wasmInstance ?? await createNodeVTracerInstance();
  return cases.map((benchmarkCase) => {
    const baseline = traceVTracerSensitivityCase(wasm, benchmarkCase, baselineLogo);
    const variants = {} as Record<VTracerSensitivityVariantId, VTracerSensitivityMetrics>;
    for (const [id, variant] of Object.entries(VTRACER_SENSITIVITY_VARIANTS) as Array<[
      VTracerSensitivityVariantId,
      VTracerSensitivityVariant,
    ]>) {
      variants[id] = traceVTracerSensitivityCase(wasm, benchmarkCase, variant.options);
    }
    return {
      caseId: benchmarkCase.id,
      category: benchmarkCase.category,
      baseline,
      variants,
    };
  });
}
