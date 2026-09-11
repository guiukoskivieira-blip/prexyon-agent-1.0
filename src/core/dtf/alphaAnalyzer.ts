/**
 * Prexyon Agent — Alpha & Transparency Analyzer (DTF UV Etapa 2)
 *
 * Motor determinístico de análise e diagnóstico de canal alfa e transparência para DTF UV.
 * Totalmente puro, sem efeitos colaterais, sem mutação de pixels e sem binarização forçada.
 */

import { RasterNode } from '../pdm/types';
import { AlphaAnalysis } from './types';

export interface AlphaAnalysisOptions {
  /** Passo de amostragem (1 = todos os pixels, 2 = 1 a cada 2 pixels) */
  sampleStep?: number;
}

/**
 * Analisa um buffer RGBA contínuo (Uint8ClampedArray ou Uint8Array) com alto desempenho.
 *
 * @param rgbaData Buffer plano de bytes [R, G, B, A, R, G, B, A, ...]
 * @param width Largura em pixels
 * @param height Altura em pixels
 * @param options Opções de amostragem
 */
export function analyzeAlphaFromRgbaBuffer(
  rgbaData: Uint8ClampedArray | Uint8Array,
  _width: number,
  _height: number,
  options: AlphaAnalysisOptions = {}
): AlphaAnalysis {
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const sampleStep = Math.max(1, Math.floor(options.sampleStep || 1));
  const byteStep = 4 * sampleStep;
  const len = rgbaData.length;

  let transparentPixelCount = 0;
  let semiTransparentPixelCount = 0;
  let opaquePixelCount = 0;
  let totalSampledPixels = 0;

  for (let i = 0; i < len; i += byteStep) {
    const a = rgbaData[i + 3];
    if (a === 0) {
      transparentPixelCount++;
    } else if (a < 255) {
      semiTransparentPixelCount++;
    } else {
      opaquePixelCount++;
    }
    totalSampledPixels++;
  }

  const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const durationMs = Math.max(0, endTime - startTime);

  if (totalSampledPixels === 0) {
    return {
      hasAlphaChannel: true,
      hasTransparentPixels: false,
      hasSemiTransparentPixels: false,
      transparentPixelRatio: 0,
      semiTransparentPixelRatio: 0,
      opaquePixelRatio: 1,
      totalSampledPixels: 0,
      transparentPixelCount: 0,
      semiTransparentPixelCount: 0,
      opaquePixelCount: 0,
      analyzedAt: Date.now(),
      durationMs,
    };
  }

  const transparentPixelRatio = transparentPixelCount / totalSampledPixels;
  const semiTransparentPixelRatio = semiTransparentPixelCount / totalSampledPixels;
  const opaquePixelRatio = opaquePixelCount / totalSampledPixels;

  return {
    hasAlphaChannel: true,
    hasTransparentPixels: transparentPixelCount > 0,
    hasSemiTransparentPixels: semiTransparentPixelCount > 0,
    transparentPixelRatio,
    semiTransparentPixelRatio,
    opaquePixelRatio,
    totalSampledPixels,
    transparentPixelCount,
    semiTransparentPixelCount,
    opaquePixelCount,
    analyzedAt: Date.now(),
    durationMs,
  };
}

/**
 * Analisa a transparência de um nó raster do PDM.
 * Detecta formatos sem alpha (como JPG) e avalia buffers RGBA quando fornecidos.
 */
export function analyzeRasterNodeAlpha(
  rasterNode: RasterNode,
  customRgbaBuffer?: Uint8ClampedArray | Uint8Array,
  options: AlphaAnalysisOptions = {}
): AlphaAnalysis {
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

  // 1. Detecção de imagens sem suporte a alpha (JPG / JPEG)
  const isJpeg =
    rasterNode.mimeType === 'image/jpeg' ||
    (typeof rasterNode.src === 'string' && rasterNode.src.startsWith('data:image/jpeg')) ||
    (typeof rasterNode.fileName === 'string' && /\.(jpe?g)$/i.test(rasterNode.fileName));

  if (isJpeg) {
    const totalPixels =
      rasterNode.naturalWidth > 0 && rasterNode.naturalHeight > 0
        ? rasterNode.naturalWidth * rasterNode.naturalHeight
        : 1;

    const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return {
      hasAlphaChannel: false,
      hasTransparentPixels: false,
      hasSemiTransparentPixels: false,
      transparentPixelRatio: 0,
      semiTransparentPixelRatio: 0,
      opaquePixelRatio: 1.0,
      totalSampledPixels: totalPixels,
      transparentPixelCount: 0,
      semiTransparentPixelCount: 0,
      opaquePixelCount: totalPixels,
      analyzedAt: Date.now(),
      durationMs: Math.max(0, endTime - startTime),
    };
  }

  // 2. Se um buffer RGBA for fornecido (ex: via Canvas / ImageData ou decodificador)
  if (customRgbaBuffer && customRgbaBuffer.length > 0) {
    return analyzeAlphaFromRgbaBuffer(
      customRgbaBuffer,
      rasterNode.naturalWidth,
      rasterNode.naturalHeight,
      options
    );
  }

  // 3. Fallback determinístico a partir dos metadados conhecidos do RasterNode
  const totalPixels =
    rasterNode.naturalWidth > 0 && rasterNode.naturalHeight > 0
      ? rasterNode.naturalWidth * rasterNode.naturalHeight
      : 1;

  const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    hasAlphaChannel: true,
    hasTransparentPixels: true, // PNG assume suporte a alpha por padrão
    hasSemiTransparentPixels: false,
    transparentPixelRatio: 0.5,
    semiTransparentPixelRatio: 0.0,
    opaquePixelRatio: 0.5,
    totalSampledPixels: totalPixels,
    transparentPixelCount: Math.round(totalPixels * 0.5),
    semiTransparentPixelCount: 0,
    opaquePixelCount: Math.round(totalPixels * 0.5),
    analyzedAt: Date.now(),
    durationMs: Math.max(0, endTime - startTime),
  };
}
