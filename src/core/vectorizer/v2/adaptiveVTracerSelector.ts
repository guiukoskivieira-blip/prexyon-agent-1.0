import { analyzeArtwork, type ArtworkAnalysis, type RgbaBitmap } from './adaptiveRasterAnalyzer';
import type { VectorizePresetId } from '../presets';
import type { VTracerOptions } from '../vtracerWasmCore';

export type AdaptiveVTracerStrategy = 'BASELINE_LOGO' | 'NOISY_LOGO';

export const NOISY_LOGO_OVERRIDES: Readonly<Pick<VTracerOptions, 'filterSpeckle' | 'colorPrecision' | 'layerDifference' | 'simplify'>> = {
  filterSpeckle: 14,
  colorPrecision: 5,
  layerDifference: 24,
  simplify: 2,
};

export interface AdaptiveVTracerEvidence {
  sustainedNoise: boolean;
  elevatedColorPressure: boolean;
  denseEdges: boolean;
  opaqueRaster: boolean;
}

export interface AdaptiveVTracerDecision {
  strategy: AdaptiveVTracerStrategy;
  analysis: ArtworkAnalysis;
  evidence: AdaptiveVTracerEvidence;
  reason: 'SUFFICIENT_RASTER_NOISE' | 'INSUFFICIENT_COMBINED_EVIDENCE' | 'ALPHA_PRESERVATION' | 'INCONCLUSIVE_SIGNALS';
}

const MIN_NOISE_RATIO = 0.01;
const MIN_COLOR_PRESSURE = 8;
const MIN_EDGE_DENSITY = 0.06;

function hasValidSignals(analysis: ArtworkAnalysis): boolean {
  return analysis.width > 0
    && analysis.height > 0
    && analysis.pixelCount > 0
    && [analysis.approximateColorPressure, analysis.edgeDensity, analysis.noiseIndicator].every(Number.isFinite);
}

export function selectAdaptiveVTracerStrategyFromAnalysis(analysis: ArtworkAnalysis): AdaptiveVTracerDecision {
  const valid = hasValidSignals(analysis);
  const minimumNoiseSamples = Math.max(32, Math.min(analysis.width, analysis.height));
  const evidence: AdaptiveVTracerEvidence = {
    sustainedNoise: valid
      && analysis.noiseIndicator >= MIN_NOISE_RATIO
      && analysis.noiseIndicator * analysis.pixelCount >= minimumNoiseSamples,
    elevatedColorPressure: valid && analysis.approximateColorPressure >= MIN_COLOR_PRESSURE,
    denseEdges: valid && analysis.edgeDensity >= MIN_EDGE_DENSITY,
    opaqueRaster: valid && !analysis.alphaPresence,
  };

  if (!valid) {
    return { strategy: 'BASELINE_LOGO', analysis, evidence, reason: 'INCONCLUSIVE_SIGNALS' };
  }
  if (analysis.alphaPresence) {
    return { strategy: 'BASELINE_LOGO', analysis, evidence, reason: 'ALPHA_PRESERVATION' };
  }
  if (evidence.sustainedNoise && evidence.elevatedColorPressure && evidence.denseEdges) {
    return { strategy: 'NOISY_LOGO', analysis, evidence, reason: 'SUFFICIENT_RASTER_NOISE' };
  }
  return { strategy: 'BASELINE_LOGO', analysis, evidence, reason: 'INSUFFICIENT_COMBINED_EVIDENCE' };
}

export function selectAdaptiveVTracerStrategy(bitmap: RgbaBitmap): AdaptiveVTracerDecision {
  return selectAdaptiveVTracerStrategyFromAnalysis(analyzeArtwork(bitmap));
}

export interface AdaptiveVTracerOptionsResolution {
  options: VTracerOptions;
  effectiveStrategy: AdaptiveVTracerStrategy | 'NOT_APPLICABLE';
  reason: AdaptiveVTracerDecision['reason'] | 'PRESET_NOT_LOGO' | 'ANALYZER_FAILURE';
  metadata?: {
    requestedPreset: 'logo';
    effectiveStrategy: AdaptiveVTracerStrategy;
  };
}

export function resolveAdaptiveVTracerOptions(
  requestedPreset: VectorizePresetId | undefined,
  bitmap: RgbaBitmap,
  baseOptions: VTracerOptions,
  analyzer: (bitmap: RgbaBitmap) => ArtworkAnalysis = analyzeArtwork
): AdaptiveVTracerOptionsResolution {
  if (requestedPreset !== 'logo') {
    return { options: baseOptions, effectiveStrategy: 'NOT_APPLICABLE', reason: 'PRESET_NOT_LOGO' };
  }

  try {
    const decision = selectAdaptiveVTracerStrategyFromAnalysis(analyzer(bitmap));
    return {
      options: decision.strategy === 'NOISY_LOGO' ? { ...baseOptions, ...NOISY_LOGO_OVERRIDES } : baseOptions,
      effectiveStrategy: decision.strategy,
      reason: decision.reason,
      metadata: { requestedPreset: 'logo', effectiveStrategy: decision.strategy },
    };
  } catch {
    return {
      options: baseOptions,
      effectiveStrategy: 'BASELINE_LOGO',
      reason: 'ANALYZER_FAILURE',
      metadata: { requestedPreset: 'logo', effectiveStrategy: 'BASELINE_LOGO' },
    };
  }
}
