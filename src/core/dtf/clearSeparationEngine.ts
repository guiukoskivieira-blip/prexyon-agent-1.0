/**
 * Prexyon Agent — Clear / Varnish Engine (DTF UV Etapa 4)
 *
 * Motor determinístico de geração, validação e gerenciamento de máscaras de verniz (Clear/Varnish).
 * Totalmente não destrutivo: deriva a camada técnica sem mutação de pixels da arte original nem da camada White.
 */

import { PrexyonDocument, RasterNode } from '../pdm/types';
import { ProductionSeparation, SeparationStatus, ClearSeparationMode, AlphaAnalysis } from './types';
import { analyzeAlphaFromRgbaBuffer } from './alphaAnalyzer';
import { calculateSeparationFingerprint } from './whiteUnderbaseEngine';
import { getArtworkBounds } from '../export/geometry';
import { getOrDecodeRgbaBuffer } from '../pdm/pngDecoder';

export interface GenerateClearSeparationOptions {
  mode?: ClearSeparationMode;
  dpi?: number;
  sourceNodeIds?: string[];
  clearPolicy?: string;
  forceBypassPolicy?: boolean;
}

export interface ClearSeparationGenerationResult {
  separation: ProductionSeparation;
  analysis: AlphaAnalysis;
  durationMs: number;
}

/**
 * Gera a máscara de Clear / Verniz técnico para o documento DTF UV.
 *
 * Modos:
 * - ARTWORK: acompanha o canal alfa da arte (0 -> 0, 255 -> 255, proporcional para intermediários).
 * - FULL: cobre 100% da área da prancheta (Artboard).
 * - CUSTOM: reservado para extensibilidade futura.
 */
export function generateClearSeparationMask(
  doc: PrexyonDocument,
  options: GenerateClearSeparationOptions = {}
): ClearSeparationGenerationResult {
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const mode: ClearSeparationMode = options.mode || 'ARTWORK';
  const dpi = options.dpi || 300;
  const widthMm = doc.dimensions?.width_mm || 100;
  const heightMm = doc.dimensions?.height_mm || 100;

  const widthPx = Math.max(1, Math.round((widthMm * dpi) / 25.4));
  const heightPx = Math.max(1, Math.round((heightMm * dpi) / 25.4));

  const maskBuffer = new Uint8ClampedArray(widthPx * heightPx * 4);
  let totalClearIntensity = 0;

  const targetNodeIds = options.sourceNodeIds && options.sourceNodeIds.length > 0
    ? options.sourceNodeIds
    : Object.keys(doc.nodes || {}).filter((id) => {
        const n = doc.nodes[id];
        return n && n.visible && n.type !== 'cut_contour' && n.type !== 'technical_guide';
      });

  if (mode === 'FULL') {
    // Modo FULL: Cobertura total de 100% sobre toda a prancheta
    for (let i = 0; i < maskBuffer.length; i += 4) {
      maskBuffer[i] = 255;
      maskBuffer[i + 1] = 255;
      maskBuffer[i + 2] = 255;
      maskBuffer[i + 3] = 255;
      totalClearIntensity += 255;
    }
  } else {
    // Modo ARTWORK: Derivação proporcional a partir da geometria e canal alfa da arte
    for (const id of targetNodeIds) {
      const node = doc.nodes[id];
      if (!node || !node.visible) continue;

      const posX_mm = node.position_mm?.x ?? 0;
      const posY_mm = node.position_mm?.y ?? 0;
      const physW_mm = (node as any).physicalWidth_mm ?? 50;
      const physH_mm = (node as any).physicalHeight_mm ?? 50;
      const opacity = typeof node.opacity === 'number' ? Math.max(0, Math.min(1, node.opacity)) : 1.0;

      const nodeLeftPx = Math.max(0, Math.min(widthPx, Math.round((posX_mm * dpi) / 25.4)));
      const nodeTopPx = Math.max(0, Math.min(heightPx, Math.round((posY_mm * dpi) / 25.4)));
      const nodeRightPx = Math.max(0, Math.min(widthPx, Math.round(((posX_mm + physW_mm) * dpi) / 25.4)));
      const nodeBottomPx = Math.max(0, Math.min(heightPx, Math.round(((posY_mm + physH_mm) * dpi) / 25.4)));

      const nodeW_px = nodeRightPx - nodeLeftPx;
      const nodeH_px = nodeBottomPx - nodeTopPx;

      if (nodeW_px <= 0 || nodeH_px <= 0) continue;

      const customBuffer = getOrDecodeRgbaBuffer(node);
      const isJpeg =
        (node as RasterNode).mimeType === 'image/jpeg' ||
        (typeof (node as any).src === 'string' && (node as any).src.startsWith('data:image/jpeg')) ||
        (typeof (node as any).fileName === 'string' && /\.(jpe?g)$/i.test((node as any).fileName));

      if (customBuffer && customBuffer.length > 0) {
        const srcW = (node as RasterNode).naturalWidth || nodeW_px;
        const srcH = (node as RasterNode).naturalHeight || nodeH_px;

        for (let y = 0; y < nodeH_px; y++) {
          const srcY = Math.min(srcH - 1, Math.floor((y / nodeH_px) * srcH));
          const dstY = nodeTopPx + y;
          if (dstY < 0 || dstY >= heightPx) continue;

          for (let x = 0; x < nodeW_px; x++) {
            const srcX = Math.min(srcW - 1, Math.floor((x / nodeW_px) * srcW));
            const dstX = nodeLeftPx + x;
            if (dstX < 0 || dstX >= widthPx) continue;

            const srcIdx = (srcY * srcW + srcX) * 4;
            const srcAlpha = customBuffer[srcIdx + 3];
            const clearCoverage = Math.round(srcAlpha * opacity);

            if (clearCoverage > 0) {
              const dstIdx = (dstY * widthPx + dstX) * 4;
              const currentA = maskBuffer[dstIdx + 3];
              maskBuffer[dstIdx] = 255;
              maskBuffer[dstIdx + 1] = 255;
              maskBuffer[dstIdx + 2] = 255;
              maskBuffer[dstIdx + 3] = Math.max(currentA, clearCoverage);
            }
          }
        }
      } else if (isJpeg || (node as any).type === 'vector_path' || (node as any).type === 'group' || (node as any).hasRasterSource || (node as any).physicalWidth_mm) {
        const coverageVal = Math.round(255 * opacity);
        for (let y = nodeTopPx; y < nodeBottomPx; y++) {
          for (let x = nodeLeftPx; x < nodeRightPx; x++) {
            const dstIdx = (y * widthPx + x) * 4;
            const currentA = maskBuffer[dstIdx + 3];
            maskBuffer[dstIdx] = 255;
            maskBuffer[dstIdx + 1] = 255;
            maskBuffer[dstIdx + 2] = 255;
            maskBuffer[dstIdx + 3] = Math.max(currentA, coverageVal);
          }
        }
      } else {
        throw new Error('Não foi possível acessar os pixels da arte para gerar essa separação.');
      }
    }

    for (let i = 0; i < maskBuffer.length; i += 4) {
      totalClearIntensity += maskBuffer[i + 3];
    }
  }

  const totalPixels = widthPx * heightPx;
  const coverageRatio = totalPixels > 0 ? totalClearIntensity / (totalPixels * 255) : 0;

  const analysis = analyzeAlphaFromRgbaBuffer(maskBuffer, widthPx, heightPx);
  const fingerprint = calculateSeparationFingerprint(doc, targetNodeIds);

  const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const durationMs = Math.max(0, endTime - startTime);

  const maskDataUrl = generateClearMaskDataUrl(maskBuffer, widthPx, heightPx);

  const separation: ProductionSeparation = {
    id: `sep_clear_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    role: 'CLEAR',
    sourceNodeIds: targetNodeIds,
    sourceFingerprint: fingerprint,
    widthPx,
    heightPx,
    widthMm,
    heightMm,
    dpi,
    status: 'GENERATED',
    generationMethod: mode === 'FULL' ? 'CLEAR_FULL_V1' : 'CLEAR_ARTWORK_PROPORTIONAL_V1',
    coverageRatio,
    maskDataUrl,
    maskBuffer,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: {
      mode,
      appliedArea: mode === 'FULL' ? 'ARTBOARD_FULL' : 'ARTWORK_BOUNDS',
      totalSampledPixels: analysis.totalSampledPixels,
      hasSemiTransparentPixels: analysis.hasSemiTransparentPixels,
      durationMs,
    },
  };

  return {
    separation,
    analysis,
    durationMs,
  };
}

/**
 * Valida o alinhamento e sincronismo da separação de Clear com o documento atual.
 */
export function validateClearSeparationAlignment(
  doc: PrexyonDocument,
  separation: ProductionSeparation
): { valid: boolean; status: SeparationStatus; reason?: string } {
  if (!separation || separation.role !== 'CLEAR') {
    return { valid: false, status: 'INVALID', reason: 'Separação Clear inexistente ou inválida.' };
  }

  const currentWidthMm = doc.dimensions?.width_mm ?? 100;
  const currentHeightMm = doc.dimensions?.height_mm ?? 100;
  const artworkBounds = getArtworkBounds(doc);

  const matchesArtboard =
    Math.abs(separation.widthMm - currentWidthMm) <= 0.01 &&
    Math.abs(separation.heightMm - currentHeightMm) <= 0.01;
  const matchesArtwork =
    Boolean(artworkBounds &&
    Math.abs(separation.widthMm - artworkBounds.width_mm) <= 0.01 &&
    Math.abs(separation.heightMm - artworkBounds.height_mm) <= 0.01);

  // 1. Checa divergência dimensional (INVALID)
  if (!matchesArtboard && !matchesArtwork) {
    return {
      valid: false,
      status: 'INVALID',
      reason: `As dimensões da prancheta (${currentWidthMm}x${currentHeightMm} mm) e da arte (${artworkBounds ? `${artworkBounds.width_mm}x${artworkBounds.height_mm}` : 'N/A'} mm) divergem da máscara de Verniz/Clear (${separation.widthMm}x${separation.heightMm} mm).`,
    };
  }

  // 2. Checa fingerprint de modificação dos nós (STALE)
  const currentFingerprint = calculateSeparationFingerprint(doc, separation.sourceNodeIds);
  if (separation.sourceFingerprint !== currentFingerprint) {
    return {
      valid: false,
      status: 'STALE',
      reason: 'A arte ou seus elementos foram modificados após a criação da camada de Verniz/Clear.',
    };
  }

  return {
    valid: true,
    status: 'GENERATED',
  };
}

/**
 * Helper para geração de Data URL representativo para a máscara de verniz (Clear)
 */
function generateClearMaskDataUrl(
  _buffer: Uint8ClampedArray,
  widthPx: number,
  heightPx: number
): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}"><rect width="100%" height="100%" fill="#0f172a"/><rect width="100%" height="100%" fill="#38bdf8" opacity="0.85"/></svg>`;
  if (typeof btoa !== 'undefined') {
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  }
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
