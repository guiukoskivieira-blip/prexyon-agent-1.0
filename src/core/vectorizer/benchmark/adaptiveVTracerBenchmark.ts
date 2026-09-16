import type { ArtworkAnalysis } from '../v2/adaptivePreprocess';
import {
  selectAdaptiveVTracerStrategy,
  type AdaptiveVTracerStrategy,
} from '../v2/adaptiveVTracerSelector';
import { getVTracerOptionsForPreset } from '../presets';
import type { VTracerWasmInstance } from '../vtracerWasmCore';
import { createNodeVTracerInstance } from './runner';
import type { VectorBenchmarkCase } from './types';
import {
  VTRACER_SENSITIVITY_VARIANTS,
  traceVTracerSensitivityCase,
  type VTracerSensitivityMetrics,
} from './vtracerSensitivity';

export interface AdaptiveVTracerBenchmarkResult {
  caseId: string;
  category: VectorBenchmarkCase['category'];
  signals: ArtworkAnalysis;
  selectedStrategy: AdaptiveVTracerStrategy;
  decisionReason: ReturnType<typeof selectAdaptiveVTracerStrategy>['reason'];
  baseline: VTracerSensitivityMetrics;
  noisyLogo: VTracerSensitivityMetrics;
  adaptive: VTracerSensitivityMetrics;
}

export async function runAdaptiveVTracerBenchmark(
  cases: VectorBenchmarkCase[],
  wasmInstance?: VTracerWasmInstance
): Promise<AdaptiveVTracerBenchmarkResult[]> {
  const wasm = wasmInstance ?? await createNodeVTracerInstance();
  const baselineOptions = getVTracerOptionsForPreset('logo');
  const noisyOptions = VTRACER_SENSITIVITY_VARIANTS.NOISY_LOGO.options;

  return cases.map((benchmarkCase) => {
    const decision = selectAdaptiveVTracerStrategy(benchmarkCase.getBitmap());
    const baseline = traceVTracerSensitivityCase(wasm, benchmarkCase, baselineOptions);
    const noisyLogo = traceVTracerSensitivityCase(wasm, benchmarkCase, noisyOptions);
    const adaptiveOptions = decision.strategy === 'NOISY_LOGO' ? noisyOptions : baselineOptions;
    const adaptive = traceVTracerSensitivityCase(wasm, benchmarkCase, adaptiveOptions);
    return {
      caseId: benchmarkCase.id,
      category: benchmarkCase.category,
      signals: decision.analysis,
      selectedStrategy: decision.strategy,
      decisionReason: decision.reason,
      baseline,
      noisyLogo,
      adaptive,
    };
  });
}
