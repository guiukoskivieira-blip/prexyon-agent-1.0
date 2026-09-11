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
import { validateWhiteSeparationAlignment } from '../../dtf/whiteUnderbaseEngine';
import { validateClearSeparationAlignment } from '../../dtf/clearSeparationEngine';

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

  // 4. VALIDAÇÃO DE SEPARAÇÃO TÉCNICA DE BASE BRANCA (WHITE UNDERBASE)
  const whitePolicy = policy.customConfig?.dtfUv?.whitePolicy || 'OPTIONAL';
  const whiteSeparation = doc.separations?.['WHITE'];

  if (whitePolicy === 'REQUIRED' && !whiteSeparation) {
    issues.push({
      id: 'DTF_UV:doc:white_required_not_generated',
      ruleId: 'WHITE_REQUIRED_NOT_GENERATED',
      severity: 'error',
      category: 'document',
      title: 'Base Branca Obrigatória Não Gerada',
      message: 'O perfil de produção exige a preparação da camada de Base Branca (White Underbase) antes da liberação.',
      fixable: true,
      suggestedAction: 'Gere a base branca executando "generate_white_underbase" ou solicite ao assistente.',
    });
  }

  if (whiteSeparation) {
    const alignment = validateWhiteSeparationAlignment(doc, whiteSeparation);

    if (alignment.status === 'STALE') {
      issues.push({
        id: `DTF_UV:${whiteSeparation.id}:white_stale`,
        ruleId: 'WHITE_SEPARATION_STALE',
        severity: 'error',
        category: 'document',
        title: 'Base Branca Desatualizada (STALE)',
        message: alignment.reason || 'A arte sofreu alterações após a criação da camada de Base Branca.',
        fixable: true,
        suggestedAction: 'Regenere a base branca técnica para sincronizar com as posições e dimensões atuais da arte.',
      });
    } else if (alignment.status === 'INVALID') {
      issues.push({
        id: `DTF_UV:${whiteSeparation.id}:white_invalid`,
        ruleId: 'WHITE_SEPARATION_INVALID',
        severity: 'error',
        category: 'document',
        title: 'Base Branca Inválida (INVALID)',
        message: alignment.reason || 'As dimensões ou parâmetros da Base Branca divergem do documento atual.',
        fixable: true,
        suggestedAction: 'Recrie a separação de base branca para corresponder exatamente às dimensões da prancheta.',
      });
    }
  }

  // 5. VALIDAÇÃO DE SEPARAÇÃO TÉCNICA DE VERNIZ (CLEAR / VARNISH)
  const clearPolicy = policy.customConfig?.dtfUv?.clearPolicy || 'OPTIONAL';
  const clearSeparation = doc.separations?.['CLEAR'];

  if (clearPolicy === 'REQUIRED' && !clearSeparation) {
    issues.push({
      id: 'DTF_UV:doc:clear_required_not_generated',
      ruleId: 'CLEAR_REQUIRED_NOT_GENERATED',
      severity: 'error',
      category: 'document',
      title: 'Verniz (Clear) Obrigatório Não Gerado',
      message: 'O perfil de produção exige a preparação da camada de Verniz (Clear) antes da liberação.',
      fixable: true,
      suggestedAction: 'Gere a separação de verniz executando "generate_clear_separation" ou solicite ao assistente.',
    });
  }

  if (clearSeparation) {
    const alignment = validateClearSeparationAlignment(doc, clearSeparation);

    if (alignment.status === 'STALE') {
      issues.push({
        id: `DTF_UV:${clearSeparation.id}:clear_stale`,
        ruleId: 'CLEAR_SEPARATION_STALE',
        severity: 'error',
        category: 'document',
        title: 'Verniz (Clear) Desatualizado (STALE)',
        message: alignment.reason || 'A arte sofreu alterações após a criação da camada de Verniz (Clear).',
        fixable: true,
        suggestedAction: 'Regenere o verniz técnico para sincronizar com as posições e dimensões atuais da arte.',
      });
    } else if (alignment.status === 'INVALID') {
      issues.push({
        id: `DTF_UV:${clearSeparation.id}:clear_invalid`,
        ruleId: 'CLEAR_SEPARATION_INVALID',
        severity: 'error',
        category: 'document',
        title: 'Verniz (Clear) Inválido (INVALID)',
        message: alignment.reason || 'As dimensões ou parâmetros do Verniz divergem do documento atual.',
        fixable: true,
        suggestedAction: 'Recrie a separação de verniz para corresponder exatamente às dimensões da prancheta.',
      });
    }
  }

  return issues;
}

