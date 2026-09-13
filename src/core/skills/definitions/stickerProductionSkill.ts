/**
 * Prexyon Agent — Sticker Production Skill (v1.0)
 *
 * Skill de produção profissional para Adesivos e Rótulos (generic-sticker).
 * Orquestra deterministicamente as ferramentas atômicas e motores homologados do PRYX:
 * remove_background (opcional) -> resize_node -> center_node -> fit_artboard_to_artwork ->
 * vectorize_raster -> create_cut_contour -> validate_production_readiness -> create_production_package.
 */

import { SkillDefinition, SkillPreconditionResult } from '../types';
import { PrexyonDocument, VectorGroupNode, RasterNode } from '../../pdm/types';
import { AgentActionPlan, PlannedAction } from '../../agent/planner/types';
import { ExecutedToolRecord } from '../../agent/types';
import { ValidationReport, ValidationIssue, ValidationStatus } from '../../validation/types';
import { validateProductionDocument } from '../../validation/productionValidationEngine';
import {
  parseDimensionsFromNaturalText,
  parseCutContourOffsetFromText,
  parseInnerContoursFromText,
} from '../../agent/planner/unitNormalizer';

export interface StickerProductionSkillParams {
  targetWidth_mm?: number;
  targetHeight_mm?: number;
  keepAspectRatio?: boolean;
  cutOffset_mm?: number;
  includeInnerContours?: boolean;
  centerArtwork?: boolean;
  fitArtboard?: boolean;
  artboardMargin_mm?: number;
  removeBackground?: boolean;
  createPackage?: boolean;
}

export const stickerProductionSkill: SkillDefinition<StickerProductionSkillParams> = {
  id: 'prepare_sticker_for_production',
  name: 'Preparar Adesivo para Produção',
  description: 'Workflow profissional determinístico para preparação completa de adesivos e rótulos para impressão e corte (Print & Cut).',
  supportedProfiles: ['generic-sticker', 'all'],
  requiredCapabilities: [
    'client-pixels',
    'vectorization',
    'cut-engine',
    'production-validation',
    'production-export',
  ],

  checkPreconditions(doc: PrexyonDocument, params?: StickerProductionSkillParams): SkillPreconditionResult {
    // 1. Documento nulo ou sem nós
    if (!doc || !doc.nodes || Object.keys(doc.nodes).length === 0) {
      return { valid: false, reason: 'Documento PDM está vazio ou não possui nenhum elemento.' };
    }

    // 2. Procura nós visíveis utilizáveis (RasterNode ou VectorGroupNode)
    const nodes = Object.values(doc.nodes).filter(
      (n) => n && n.visible !== false && n.type !== 'technical_guide'
    );
    const usableNode = nodes.find(
      (n) =>
        n.type === 'raster_image' ||
        n.type === 'group' ||
        (n as any).type === 'vector_group'
    );
    if (!usableNode) {
      return {
        valid: false,
        reason: 'Documento não possui imagem raster nem grupo vetorial utilizável para produção de adesivo.',
      };
    }

    // 3. Validação de dimensões solicitadas
    if (
      params?.targetWidth_mm !== undefined &&
      (typeof params.targetWidth_mm !== 'number' || params.targetWidth_mm <= 0)
    ) {
      return { valid: false, reason: `Largura solicitada (${params.targetWidth_mm}) deve ser um valor maior que zero.` };
    }
    if (
      params?.targetHeight_mm !== undefined &&
      (typeof params.targetHeight_mm !== 'number' || params.targetHeight_mm <= 0)
    ) {
      return { valid: false, reason: `Altura solicitada (${params.targetHeight_mm}) deve ser um valor maior que zero.` };
    }

    // 4. Validação de offset
    if (
      params?.cutOffset_mm !== undefined &&
      (typeof params.cutOffset_mm !== 'number' || params.cutOffset_mm < 0)
    ) {
      return { valid: false, reason: `Offset da faca (${params.cutOffset_mm}) não pode ser negativo.` };
    }

    return { valid: true };
  },

  buildPlan(doc: PrexyonDocument, params?: StickerProductionSkillParams): AgentActionPlan {
    const p = params || {};
    const keepAspectRatio = p.keepAspectRatio ?? true;
    const cutOffset_mm = p.cutOffset_mm !== undefined ? p.cutOffset_mm : 2.0;
    const includeInnerContours = p.includeInnerContours ?? false;
    const centerArtwork = p.centerArtwork ?? true;
    const fitArtboard = p.fitArtboard ?? true;
    const artboardMargin_mm = p.artboardMargin_mm ?? 5.0;
    const removeBackground = p.removeBackground ?? false;
    const createPackage = p.createPackage ?? true;

    // Encontra o nó principal da arte
    const nodesList = Object.values(doc.nodes || {}).filter(
      (n) => n && n.visible !== false && n.type !== 'technical_guide'
    );
    const mainNode =
      nodesList.find(
        (n) => n.type === 'raster_image' || n.type === 'group' || (n as any).type === 'vector_group'
      ) || nodesList[0];

    const targetNodeId = mainNode ? mainNode.id : undefined;
    const isRaster = mainNode ? mainNode.type === 'raster_image' : false;

    const steps: PlannedAction[] = [];
    const stepIds: string[] = [];

    // Step 1: remove_background (se solicitado explicitamente e for raster)
    if (removeBackground && isRaster && targetNodeId) {
      const sId = 'step_remove_bg';
      steps.push({
        id: sId,
        tool: 'remove_background',
        arguments: { nodeId: targetNodeId },
        description: 'Remover fundo da imagem raster.',
      });
      stepIds.push(sId);
    }

    // Step 2: resize_node (se largura ou altura solicitada)
    if ((p.targetWidth_mm !== undefined || p.targetHeight_mm !== undefined) && targetNodeId) {
      const sId = 'step_resize';
      steps.push({
        id: sId,
        tool: 'resize_node',
        arguments: {
          nodeId: targetNodeId,
          ...(p.targetWidth_mm !== undefined ? { width_mm: p.targetWidth_mm } : {}),
          ...(p.targetHeight_mm !== undefined ? { height_mm: p.targetHeight_mm } : {}),
          keepAspectRatio,
        },
        description: `Redimensionar arte para ${p.targetWidth_mm || p.targetHeight_mm} mm.`,
        dependsOn: stepIds.length > 0 ? [...stepIds] : undefined,
      });
      stepIds.push(sId);
    }

    // Step 3: center_node (se habilitado)
    if (centerArtwork && targetNodeId) {
      const sId = 'step_center';
      steps.push({
        id: sId,
        tool: 'center_node',
        arguments: { nodeId: targetNodeId },
        description: 'Centralizar arte na prancheta.',
        dependsOn: stepIds.length > 0 ? [...stepIds] : undefined,
      });
      stepIds.push(sId);
    }

    // Step 4: fit_artboard_to_artwork (se habilitado)
    if (fitArtboard) {
      const sId = 'step_fit_artboard';
      steps.push({
        id: sId,
        tool: 'fit_artboard_to_artwork',
        arguments: { margin_mm: artboardMargin_mm },
        description: `Ajustar prancheta com margem de ${artboardMargin_mm} mm.`,
        dependsOn: stepIds.length > 0 ? [...stepIds] : undefined,
      });
      stepIds.push(sId);
    }

    // Step 5: vectorize_raster (apenas se for raster, não houver vetor já disponível e houver raster com src válido)
    const existingVector = Object.values(doc.nodes || {}).find(
      (n) =>
        n &&
        (n.type === 'group' || (n as any).type === 'vector_group') &&
        ((n as VectorGroupNode).sourceRasterNodeId === targetNodeId || (n.name && targetNodeId && n.name.includes(targetNodeId)))
    ) as VectorGroupNode | undefined;

    const rasterNode = isRaster && targetNodeId ? (doc.nodes[targetNodeId] as RasterNode) : undefined;
    const hasRasterSource = Boolean(rasterNode && rasterNode.src && rasterNode.src.length > 0);

    const needsVectorize =
      isRaster &&
      !existingVector &&
      hasRasterSource;

    if (needsVectorize && isRaster && targetNodeId) {
      const sId = 'step_vectorize';
      steps.push({
        id: sId,
        tool: 'vectorize_raster',
        arguments: { nodeId: targetNodeId, preset: 'logo' },
        description: 'Vetorizar imagem raster para geração de silhueta de corte.',
        dependsOn: stepIds.length > 0 ? [...stepIds] : undefined,
      });
      stepIds.push(sId);
    }

    // Step 6: create_cut_contour
    if (targetNodeId) {
      const sId = 'step_cut';
      steps.push({
        id: sId,
        tool: 'create_cut_contour',
        arguments: {
          sourceNodeId: targetNodeId,
          offset_mm: cutOffset_mm,
          includeInnerContours,
          joinStyle: 'round',
        },
        description: `Criar faca de corte com offset de ${cutOffset_mm} mm${!includeInnerContours ? ' (sem corte interno)' : ''}.`,
        dependsOn: stepIds.length > 0 ? [...stepIds] : undefined,
      });
      stepIds.push(sId);
    }

    // Step 7: validate_production
    const sIdVal = 'step_validate';
    steps.push({
      id: sIdVal,
      tool: 'validate_production',
      arguments: {},
      description: 'Validar conformidade técnica para produção de adesivo.',
      dependsOn: stepIds.length > 0 ? [...stepIds] : undefined,
    });
    stepIds.push(sIdVal);

    // Step 8: create_production_package (se habilitado)
    if (createPackage) {
      const sIdPkg = 'step_package';
      steps.push({
        id: sIdPkg,
        tool: 'create_production_package',
        arguments: {
          profileId: 'generic-sticker',
          cutOffset_mm,
          dpi: 300,
          generateZip: true,
        },
        description: 'Gerar pacote de produção para adesivo (Print PNG + Cut SVG + Manifest JSON + ZIP).',
        dependsOn: stepIds.length > 0 ? [...stepIds] : undefined,
      });
      stepIds.push(sIdPkg);
    }

    return {
      schemaVersion: '1.0',
      intent: 'MODIFY',
      process: 'GENERIC_STICKER',
      target: { type: 'DOCUMENT' },
      steps,
      explanation: 'Plano determinístico de produção de adesivo (prepare_sticker_for_production).',
    };
  },

  validateFinalState(doc: PrexyonDocument, _executedTools: ExecutedToolRecord[]): ValidationReport {
    const report = validateProductionDocument(doc);
    const issues: ValidationIssue[] = [...(report.issues || [])];

    // Checagem 1: Profile deve ser generic-sticker (se definido e diferente de generic-sticker)
    if (doc.profileId && doc.profileId !== 'generic-sticker') {
      issues.push({
        id: 'SKILL_001',
        ruleId: 'PROFILE_MISMATCH',
        severity: 'error',
        category: 'document',
        title: 'Perfil Incompatível',
        message: `O documento deve estar no perfil "generic-sticker" (atual: "${doc.profileId}").`,
      });
    }

    // Checagem 2: Existência de CutContourNode
    const cutNode = Object.values(doc.nodes || {}).find((n) => n && n.type === 'cut_contour');
    if (!cutNode) {
      issues.push({
        id: 'SKILL_002',
        ruleId: 'MISSING_CUT_CONTOUR',
        severity: 'error',
        category: 'cut',
        title: 'Faca de Corte Ausente',
        message: 'Adesivo para produção requer um contorno de corte (CutContourNode) válido.',
      });
    }

    // Checagem 3: Dimensões físicas válidas
    if (!doc.dimensions || doc.dimensions.width_mm <= 0 || doc.dimensions.height_mm <= 0) {
      issues.push({
        id: 'SKILL_003',
        ruleId: 'INVALID_PHYSICAL_DIMENSIONS',
        severity: 'error',
        category: 'dimensions',
        title: 'Dimensões Inválidas',
        message: 'As dimensões da prancheta física devem ser maiores que zero.',
      });
    }

    const errorCount = issues.filter((i) => i.severity === 'error').length;
    const warningCount = issues.filter((i) => i.severity === 'warning').length;
    const infoCount = issues.filter((i) => i.severity === 'info').length;

    let status: ValidationStatus = 'ready';
    if (errorCount > 0) {
      status = 'blocked';
    } else if (warningCount > 0) {
      status = 'attention';
    }

    return {
      status,
      issues,
      errorCount,
      warningCount,
      infoCount,
      checkedAt: new Date().toISOString(),
      documentId: doc.id,
    };
  },
};

/**
 * Função utilitária para detecção de intenção clara de Workflow de Adesivo na mensagem do usuário.
 * Retorna se deve acionar a Sticker Skill e os parâmetros extraídos.
 */
export function detectStickerSkillFromUserRequest(
  message: string,
  doc: PrexyonDocument
): { isStickerSkill: boolean; params?: StickerProductionSkillParams } {
  if (!message || typeof message !== 'string') {
    return { isStickerSkill: false };
  }

  const text = message.toLowerCase().trim();

  // Se o contexto ou mensagem for explicitamente DTF UV, não aciona a Sticker Skill
  if (text.includes('dtf') || text.includes('dtf-uv') || text.includes('dtf uv') || doc.profileId === 'dtf-uv') {
    return { isStickerSkill: false };
  }

  // 1. Identificação de Intenção Clara de Workflow Completo de Adesivo
  const hasStickerIntent =
    text.includes('virar adesivo') ||
    text.includes('vira adesivo') ||
    text.includes('faz um adesivo') ||
    text.includes('fazer adesivo') ||
    text.includes('cria um adesivo') ||
    text.includes('criar adesivo') ||
    text.includes('prepara isso como adesivo') ||
    text.includes('preparar isto como adesivo') ||
    text.includes('preparar adesivo') ||
    text.includes('prepara adesivo') ||
    text.includes('preparar para produção de adesivo') ||
    text.includes('preparar para producao de adesivo') ||
    text.includes('workflow completo de adesivo') ||
    (text.includes('adesivo') && text.includes('prepara'));

  if (!hasStickerIntent) {
    return { isStickerSkill: false };
  }

  // 2. Extração de Parâmetros da Linguagem Natural
  const parsedDims = parseDimensionsFromNaturalText(text);
  const parsedOffset = parseCutContourOffsetFromText(text);
  const cutOffset_mm = parsedOffset !== undefined ? parsedOffset : 2.0;
  const includeInnerContours = parseInnerContoursFromText(text);

  const removeBackground =
    text.includes('tira o fundo') ||
    text.includes('tirar o fundo') ||
    text.includes('remove o fundo') ||
    text.includes('remover o fundo') ||
    text.includes('sem fundo');

  const params: StickerProductionSkillParams = {
    ...(parsedDims?.width_mm !== undefined ? { targetWidth_mm: parsedDims.width_mm } : {}),
    ...(parsedDims?.height_mm !== undefined ? { targetHeight_mm: parsedDims.height_mm } : {}),
    keepAspectRatio: parsedDims?.keepAspectRatio ?? true,
    cutOffset_mm,
    includeInnerContours,
    removeBackground,
    centerArtwork: true,
    fitArtboard: true,
    artboardMargin_mm: 5,
    createPackage: true,
  };

  return { isStickerSkill: true, params };
}
