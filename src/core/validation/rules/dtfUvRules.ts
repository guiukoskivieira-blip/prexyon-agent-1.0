/**
 * Prexyon Agent — DTF UV Preflight Validation Rules (DTF UV Etapa 2)
 *
 * Regras determinísticas de pré-voo para processos DTF UV:
 * 1. Análise de canal alfa e transparência.
 * 2. Detecção de semi-transparência (degradê de alpha).
 * 3. Notificação informativa para artes totalmente opacas / JPG.
 * 
 * Princípio Arquitetural: Não mutaciona pixels, não força binarização e não gera falsos bloqueios.
 */

import { PrexyonDocument, RasterNode } from '../../pdm/types';
import { ValidationIssue, ValidationPolicy, DEFAULT_VALIDATION_POLICY } from '../types';
import { analyzeRasterNodeAlpha } from '../../dtf/alphaAnalyzer';

export function validateDtfUvTransparency(
  doc: PrexyonDocument,
  policy: ValidationPolicy = DEFAULT_VALIDATION_POLICY
): ValidationIssue[] {
  const isDtfUv =
    policy.profileId === 'dtf-uv' ||
    Boolean(policy.checkAlphaTransparency) ||
    Boolean(policy.customConfig?.dtfUv);

  if (!isDtfUv) {
    return [];
  }

  const issues: ValidationIssue[] = [];

  const nodeIds = doc.rootNodeIds?.length ? doc.rootNodeIds : Object.keys(doc.nodes || {});
  for (const nodeId of nodeIds) {
    const node = doc.nodes[nodeId];
    if (!node || node.type !== 'raster_image') continue;

    const raster = node as RasterNode;
    const customBuffer = (raster as any).__rgbaBuffer as Uint8ClampedArray | undefined;
    const alpha = analyzeRasterNodeAlpha(raster, customBuffer);

    // CASO 1: ARTE TOTALMENTE OPACA OU FORMATO SEM ALPHA (JPG)
    if (!alpha.hasAlphaChannel || !alpha.hasTransparentPixels || alpha.transparentPixelRatio === 0) {
      issues.push({
        id: `DTF_UV:${raster.id}:opaque_artwork`,
        ruleId: 'DTF_UV_OPAQUE_ARTWORK',
        severity: 'info',
        category: 'document',
        title: 'Arte com Cobertura Total (Opaca)',
        message: `A imagem "${raster.name}" não possui fundo transparente. O decalque DTF UV será impresso como bloco retangular contínuo.`,
        nodeId: raster.id,
        data: {
          hasAlphaChannel: alpha.hasAlphaChannel,
          transparentPixelRatio: alpha.transparentPixelRatio,
          opaquePixelRatio: alpha.opaquePixelRatio,
          mimeType: raster.mimeType,
        },
        fixable: false,
        suggestedAction: 'Se desejar decalque com fundo recortado/vazado, importe uma arte PNG com canal alfa.',
      });
    } else {
      // CASO 2: TRANSPARÊNCIA VÁLIDA
      issues.push({
        id: `DTF_UV:${raster.id}:alpha_valid`,
        ruleId: 'DTF_UV_ALPHA_VALID',
        severity: 'info',
        category: 'document',
        title: 'Transparência DTF UV Válida',
        message: `Canal alfa verificado na imagem "${raster.name}": ${Math.round(
          alpha.transparentPixelRatio * 100
        )}% de área vazada identificada para não deposição de adesivo.`,
        nodeId: raster.id,
        data: {
          transparentPixelRatio: alpha.transparentPixelRatio,
          opaquePixelRatio: alpha.opaquePixelRatio,
        },
        fixable: false,
      });
    }

    // CASO 3: SEMI-TRANSPARÊNCIA (GRADIENTES / FEATHERING DE ALPHA)
    if (alpha.hasSemiTransparentPixels && alpha.semiTransparentPixelRatio > 0.001) {
      issues.push({
        id: `DTF_UV:${raster.id}:semi_transparency`,
        ruleId: 'DTF_UV_SEMI_TRANSPARENCY',
        severity: 'info',
        category: 'document',
        title: 'Transparência Gradual Detectada',
        message: `A imagem "${raster.name}" contém pixels com semi-transparência (${(
          alpha.semiTransparentPixelRatio * 100
        ).toFixed(1)}% dos pixels). Na cura UV, degradês suaves podem gerar pontos visíveis de tinta branca ou borda granulada.`,
        nodeId: raster.id,
        data: {
          semiTransparentPixelRatio: alpha.semiTransparentPixelRatio,
          semiTransparentPixelCount: alpha.semiTransparentPixelCount,
        },
        fixable: false,
        suggestedAction: 'Verifique se as bordas devem ser 100% nítidas ou se o degradê de transparência é o efeito desejado.',
      });
    }
  }

  return issues;
}
