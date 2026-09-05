/**
 * Prexyon Vectorization Presets
 *
 * Presets calibrados para o motor VTracer (Rust/WASM) otimizados para produção gráfica e arte-final.
 */

import { VTracerOptions } from './vtracerWasmCore';

export type VectorizePresetId = 'logo' | 'detailed' | 'simple';

export interface VectorizePreset {
  id: VectorizePresetId;
  name: string;
  description: string;
  options: VTracerOptions;
}

export const VECTORIZE_PRESETS: Record<VectorizePresetId, VectorizePreset> = {
  logo: {
    id: 'logo',
    name: 'Logo / Arte Gráfica',
    description: 'Curvas suaves e contínuas, cores sólidas, cantos definidos e redução de ruídos de compressão.',
    options: {
      preset: 'poster',
      clustering: 'color-cluster',
      hierarchical: 'stacked',
      mode: 'spline',
      filterSpeckle: 8,
      colorPrecision: 7,
      layerDifference: 16,
      cornerThreshold: 60,
      lengthThreshold: 4,
      maxIterations: 10,
      spliceThreshold: 45,
      simplify: 1.0,
      pathPrecision: 3,
    },
  },
  detailed: {
    id: 'detailed',
    name: 'Detalhado / Foto',
    description: 'Maior fidelidade geométrica aos contornos e nuances de cor, preservando micro-detalhes.',
    options: {
      preset: 'photo',
      clustering: 'color-cluster',
      hierarchical: 'stacked',
      mode: 'spline',
      filterSpeckle: 2,
      colorPrecision: 8,
      layerDifference: 8,
      cornerThreshold: 45,
      lengthThreshold: 2,
      maxIterations: 14,
      spliceThreshold: 30,
      simplify: 0.5,
      pathPrecision: 3,
    },
  },
  simple: {
    id: 'simple',
    name: 'Símbolo Simples / Ícone',
    description: 'Menor quantidade de caminhos, formas geométricas altamente simplificadas e limpas.',
    options: {
      preset: 'poster',
      clustering: 'color-cluster',
      hierarchical: 'stacked',
      mode: 'spline',
      filterSpeckle: 14,
      colorPrecision: 5,
      layerDifference: 24,
      cornerThreshold: 75,
      lengthThreshold: 6,
      maxIterations: 8,
      spliceThreshold: 60,
      simplify: 2.0,
      pathPrecision: 2,
    },
  },
};

export function getVTracerOptionsForPreset(presetId: VectorizePresetId): VTracerOptions {
  return VECTORIZE_PRESETS[presetId]?.options ?? VECTORIZE_PRESETS.logo.options;
}
