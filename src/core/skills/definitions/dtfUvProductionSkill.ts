/**
 * Prexyon Agent — DTF UV Production Skill (v1.0)
 *
 * Skill de produção profissional para decalques e transferências DTF UV (profile: dtf-uv).
 * Orquestra deterministicamente as ferramentas atômicas e motores homologados do PRYX:
 * remove_background (opcional) -> resize_node -> generate_white_underbase -> generate_clear_separation -> validate_production -> generate_dtf_uv_production_package.
 */

import { SkillDefinition, SkillPreconditionResult } from '../types';
import { PrexyonDocument } from '../../pdm/types';
import { AgentActionPlan, PlannedAction } from '../../agent/planner/types';
import { ExecutedToolRecord } from '../../agent/types';
import { ValidationReport, ValidationIssue, ValidationStatus } from '../../validation/types';
import { validateProductionDocument } from '../../validation/productionValidationEngine';
import { parseDimensionsFromNaturalText } from '../../agent/planner/unitNormalizer';
import { ClearSeparationMode } from '../../dtf/types';

export interface DtfUvProductionSkillParams {
  targetWidth_mm?: number;
  targetHeight_mm?: number;
  keepAspectRatio?: boolean;
  removeBackground?: boolean;
  generateWhite?: boolean;
  whitePolicy?: 'OPTIONAL' | 'REQUIRED' | 'DISABLED' | 'RIP_CONTROLLED';
  generateClear?: boolean;
  clearMode?: ClearSeparationMode;
  createPackage?: boolean;
}

export const dtfUvProductionSkill: SkillDefinition<DtfUvProductionSkillParams> = {
  id: 'prepare_dtf_uv',
  name: 'Preparar DTF UV para Produção',
  description: 'Workflow profissional determinístico para preparação completa de decalques e transferências DTF UV com separações técnicas de Base Branca (White Underbase) e Verniz (Clear / Varnish).',
  supportedProfiles: ['dtf-uv', 'all'],
  requiredCapabilities: [
    'client-pixels',
    'white-engine',
    'clear-engine',
    'production-validation',
    'production-export',
  ],

  checkPreconditions(doc: PrexyonDocument, params?: DtfUvProductionSkillParams): SkillPreconditionResult {
    // 1. Documento nulo ou sem nós
    if (!doc || !doc.nodes || Object.keys(doc.nodes).length === 0) {
      return { valid: false, reason: 'Documento PDM está vazio ou não possui nenhum elemento.' };
    }

    // 2. Procura nós visíveis utilizáveis
    const nodes = Object.values(doc.nodes).filter(
      (n) => n && n.visible !== false && n.type !== 'technical_guide'
    );
    const usableNode = nodes.find(
      (n) =>
        n.type === 'raster_image' ||
        n.type === 'group' ||
        n.type === 'vector_path' ||
        (n as any).type === 'vector_group'
    );
    if (!usableNode) {
      return {
        valid: false,
        reason: 'Documento não possui elemento gráfico válido para preparação de DTF UV.',
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

    return { valid: true };
  },

  buildPlan(doc: PrexyonDocument, params?: DtfUvProductionSkillParams): AgentActionPlan {
    const p = params || {};
    const keepAspectRatio = p.keepAspectRatio ?? true;
    const removeBackground = p.removeBackground ?? false;

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

    const hasWhiteSeparation = !!doc.separations?.['WHITE'];
    const hasClearSeparation = !!doc.separations?.['CLEAR'];

    const generateWhite =
      p.generateWhite ??
      (!hasWhiteSeparation && p.whitePolicy !== 'DISABLED' && p.whitePolicy !== 'RIP_CONTROLLED');
    const generateClear = p.generateClear ?? hasClearSeparation;
    const clearMode = p.clearMode || 'ARTWORK';
    const createPackage = p.createPackage ?? true;

    const steps: PlannedAction[] = [];
    const stepIds: string[] = [];

    // Step 1: remove_background (se solicitado e for raster)
    if (removeBackground && isRaster && targetNodeId) {
      const sId = 'step_remove_bg';
      steps.push({
        id: sId,
        tool: 'remove_background',
        arguments: { nodeId: targetNodeId },
        description: 'Remover fundo da imagem raster para alinhamento do canal alfa.',
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

    // Step 3: generate_white_underbase (se ativado e não for RIP_CONTROLLED)
    if (generateWhite && p.whitePolicy !== 'RIP_CONTROLLED') {
      const sId = 'step_white';
      steps.push({
        id: sId,
        tool: 'generate_white_underbase',
        arguments: { dpi: 300 },
        description: 'Gerar máscara técnica de Base Branca (White Underbase).',
        dependsOn: stepIds.length > 0 ? [...stepIds] : undefined,
      });
      stepIds.push(sId);
    }

    // Step 4: generate_clear_separation (se ativado)
    if (generateClear) {
      const sId = 'step_clear';
      steps.push({
        id: sId,
        tool: 'generate_clear_separation',
        arguments: { mode: clearMode, dpi: 300 },
        description: `Gerar máscara técnica de Verniz (Clear / Varnish) no modo ${clearMode}.`,
        dependsOn: stepIds.length > 0 ? [...stepIds] : undefined,
      });
      stepIds.push(sId);
    }

    // Step 5: validate_production
    const sIdVal = 'step_validate';
    steps.push({
      id: sIdVal,
      tool: 'validate_production',
      arguments: {},
      description: 'Validar conformidade técnica de pré-impressão para DTF UV.',
      dependsOn: stepIds.length > 0 ? [...stepIds] : undefined,
    });
    stepIds.push(sIdVal);

    // Step 6: generate_dtf_uv_production_package (se ativado)
    if (createPackage) {
      const sIdPkg = 'step_package';
      steps.push({
        id: sIdPkg,
        tool: 'generate_dtf_uv_production_package',
        arguments: {
          dpi: 300,
          generateZip: true,
          whitePolicy: p.whitePolicy || 'OPTIONAL',
          ignoreValidationErrors: true,
        },
        description: 'Gerar pacote de produção DTF UV (Color PNG + White PNG + Clear PNG + Manifest JSON + ZIP).',
        dependsOn: stepIds.length > 0 ? [...stepIds] : undefined,
      });
      stepIds.push(sIdPkg);
    }

    return {
      schemaVersion: '1.0',
      intent: 'MODIFY',
      process: 'DTF_UV',
      target: { type: 'DOCUMENT' },
      steps,
      explanation: 'Plano determinístico de produção DTF UV (prepare_dtf_uv).',
    };
  },

  validateFinalState(doc: PrexyonDocument, _executedTools: ExecutedToolRecord[]): ValidationReport {
    const report = validateProductionDocument(doc);
    const issues: ValidationIssue[] = [...(report.issues || [])];

    // Checagem 1: Profile deve ser dtf-uv (se definido e diferente de dtf-uv)
    if (doc.profileId && doc.profileId !== 'dtf-uv') {
      issues.push({
        id: 'SKILL_DTF_001',
        ruleId: 'PROFILE_MISMATCH',
        severity: 'error',
        category: 'document',
        title: 'Perfil Incompatível',
        message: `O documento deve estar no perfil "dtf-uv" (atual: "${doc.profileId}").`,
      });
    }

    // Checagem 2: PROIBIDO CutContourNode em DTF UV
    const cutNode = Object.values(doc.nodes || {}).find((n) => n && n.type === 'cut_contour');
    if (cutNode) {
      issues.push({
        id: 'SKILL_DTF_002',
        ruleId: 'UNEXPECTED_CUT_CONTOUR',
        severity: 'error',
        category: 'cut',
        title: 'Faca Mecânica Incompatível com DTF UV',
        message: 'O fluxo DTF UV não suporta facas de corte mecânicas (CutContourNode).',
      });
    }

    // Checagem 3: Dimensões físicas válidas
    if (!doc.dimensions || doc.dimensions.width_mm <= 0 || doc.dimensions.height_mm <= 0) {
      issues.push({
        id: 'SKILL_DTF_003',
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
 * Função utilitária para detecção de intenção clara de Workflow DTF UV na mensagem do usuário.
 * Retorna se deve acionar a DTF UV Skill e os parâmetros extraídos.
 */
export function detectDtfUvSkillFromUserRequest(
  message: string,
  _doc?: PrexyonDocument
): { isDtfUvSkill: boolean; params?: DtfUvProductionSkillParams } {
  if (!message || typeof message !== 'string') {
    return { isDtfUvSkill: false };
  }

  const text = message.toLowerCase().trim();

  // Se o contexto ou mensagem for explicitamente adesivo com faca, não aciona a DTF UV Skill
  if (
    text.includes('adesivo') ||
    text.includes('virar adesivo') ||
    text.includes('faca') ||
    text.includes('corte') ||
    text.includes('sangria')
  ) {
    return { isDtfUvSkill: false };
  }

  // 1. Identificação de Intenção Clara de Workflow Completo DTF UV
  const hasDtfUvIntent =
    text.includes('virar dtf') ||
    text.includes('vira dtf') ||
    text.includes('prepara para dtf') ||
    text.includes('preparar para dtf') ||
    text.includes('prepara isso para dtf') ||
    text.includes('preparar isso para dtf') ||
    text.includes('prepara dtf') ||
    text.includes('preparar dtf') ||
    text.includes('workflow dtf') ||
    text.includes('workflow completo dtf') ||
    (text.includes('dtf uv') && (text.includes('prepara') || text.includes('preparar')));

  if (!hasDtfUvIntent) {
    return { isDtfUvSkill: false };
  }

  // 2. Extração de Parâmetros da Linguagem Natural
  const parsedDims = parseDimensionsFromNaturalText(text);

  const generateWhite = !(
    text.includes('sem branco') ||
    text.includes('sem base branca') ||
    text.includes('sem tinta branca')
  );

  const generateClear =
    text.includes('verniz') ||
    text.includes('clear') ||
    text.includes('vazado') ||
    text.includes('brilho');

  const clearMode: ClearSeparationMode =
    text.includes('verniz total') || text.includes('clear full') || text.includes('toda a prancheta')
      ? 'FULL'
      : 'ARTWORK';

  const removeBackground =
    text.includes('tira o fundo') ||
    text.includes('tirar o fundo') ||
    text.includes('remove o fundo') ||
    text.includes('remover o fundo') ||
    text.includes('sem fundo');

  const params: DtfUvProductionSkillParams = {
    ...(parsedDims?.width_mm !== undefined ? { targetWidth_mm: parsedDims.width_mm } : {}),
    ...(parsedDims?.height_mm !== undefined ? { targetHeight_mm: parsedDims.height_mm } : {}),
    keepAspectRatio: parsedDims?.keepAspectRatio ?? true,
    removeBackground,
    generateWhite,
    generateClear,
    clearMode,
    createPackage: true,
  };

  return { isDtfUvSkill: true, params };
}
