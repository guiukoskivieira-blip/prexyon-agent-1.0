/**
 * Prexyon Agent — Cutting Workflow Skill (v1.0)
 *
 * Skill determinística para geração de faca/linha de corte em elementos do documento,
 * sem alterar o perfil de produção do documento nem gerar pacote final de saída.
 */

import { SkillDefinition, SkillPreconditionResult } from '../types';
import { PrexyonDocument, VectorGroupNode } from '../../pdm/types';
import { AgentActionPlan, PlannedAction } from '../../agent/planner/types';
import { ExecutedToolRecord } from '../../agent/types';
import { ValidationReport, ValidationIssue, ValidationStatus } from '../../validation/types';
import { validateProductionDocument } from '../../validation/productionValidationEngine';
import {
  parseCutContourOffsetFromText,
  parseInnerContoursFromText,
  isMultiIntentRequest,
} from '../../agent/planner/unitNormalizer';

export interface CuttingWorkflowSkillParams {
  cutOffset_mm?: number;
  includeInnerContours?: boolean;
  nodeId?: string;
}

export const cuttingWorkflowSkill: SkillDefinition<CuttingWorkflowSkillParams> = {
  id: 'create_cutting_workflow',
  name: 'Criar Faca de Corte',
  description: 'Workflow determinístico para criação de faca/contorno de corte em elementos do documento sem alterar o perfil.',
  supportedProfiles: ['all'],
  requiredCapabilities: [
    'vectorization',
    'cut-engine',
    'production-validation',
  ],

  checkPreconditions(doc: PrexyonDocument, params?: CuttingWorkflowSkillParams): SkillPreconditionResult {
    // 1. Documento nulo ou sem nós
    if (!doc || !doc.nodes || Object.keys(doc.nodes).length === 0) {
      return { valid: false, reason: 'Documento PDM está vazio ou não possui nenhum elemento.' };
    }

    // 2. Validação do offset da faca
    if (
      params?.cutOffset_mm !== undefined &&
      (typeof params.cutOffset_mm !== 'number' || params.cutOffset_mm < 0)
    ) {
      return { valid: false, reason: `Offset da faca (${params.cutOffset_mm}) não pode ser negativo.` };
    }

    // 3. Procura nós visíveis utilizáveis (RasterNode ou VectorGroupNode / group)
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
        reason: 'Documento não possui elementos utilizáveis (raster ou vetor) para geração de faca de corte.',
      };
    }

    return { valid: true };
  },

  buildPlan(doc: PrexyonDocument, params?: CuttingWorkflowSkillParams): AgentActionPlan {
    const cutOffset_mm = params?.cutOffset_mm !== undefined ? params.cutOffset_mm : 2.0;
    const includeInnerContours = params?.includeInnerContours ?? true;

    const nodesList = Object.values(doc.nodes || {}).filter(
      (n) => n && n.visible !== false && n.type !== 'technical_guide'
    );

    let targetNode = params?.nodeId ? doc.nodes[params.nodeId] : undefined;
    if (!targetNode) {
      targetNode = nodesList.find(
        (n) => n.type === 'raster_image' || n.type === 'group' || (n as any).type === 'vector_group'
      ) || nodesList[0];
    }

    const targetNodeId = targetNode ? targetNode.id : undefined;
    const isRaster = targetNode ? targetNode.type === 'raster_image' : false;

    const steps: PlannedAction[] = [];
    const stepIds: string[] = [];

    // Step 1: Se for raster, verifica se já existe grupo vetorial associado válido
    let vectorizeAdded = false;
    if (isRaster && targetNodeId) {
      const existingVector = Object.values(doc.nodes || {}).find(
        (n) => n && n.type === 'group' && (n as VectorGroupNode).sourceRasterNodeId === targetNodeId
      );

      if (!existingVector) {
        const sId = 'step_vectorize';
        steps.push({
          id: sId,
          tool: 'vectorize_raster',
          arguments: { nodeId: targetNodeId, preset: 'logo' },
          description: 'Vetorizar imagem raster para geração da faca de corte.',
        });
        stepIds.push(sId);
        vectorizeAdded = true;
      }
    }

    // Step 2: create_cut_contour
    if (targetNodeId) {
      const sId = 'step_cut';
      steps.push({
        id: sId,
        tool: 'create_cut_contour',
        arguments: {
          nodeId: targetNodeId,
          offset_mm: cutOffset_mm,
          includeInnerContours,
        },
        description: `Gerar faca de corte com offset de ${cutOffset_mm} mm.`,
        dependsOn: vectorizeAdded ? ['step_vectorize'] : undefined,
      });
      stepIds.push(sId);
    }

    // Step 3: validate_production
    const sIdVal = 'step_validate';
    steps.push({
      id: sIdVal,
      tool: 'validate_production',
      arguments: {},
      description: 'Validar prontidão de produção do documento.',
      dependsOn: stepIds.length > 0 ? [...stepIds] : undefined,
    });

    return {
      schemaVersion: '1.0',
      intent: 'GENERATE_CUT',
      process: 'UNSPECIFIED',
      target: { type: 'DOCUMENT' },
      steps,
      explanation: 'Plano determinístico para geração de faca de corte (create_cutting_workflow).',
    };
  },

  validateFinalState(doc: PrexyonDocument, _executedTools: ExecutedToolRecord[]): ValidationReport {
    const report = validateProductionDocument(doc);
    const issues: ValidationIssue[] = [...(report.issues || [])];

    // Checagem de existência de CutContourNode
    const cutNode = Object.values(doc.nodes || {}).find((n) => n && n.type === 'cut_contour');
    if (!cutNode) {
      issues.push({
        id: 'SKILL_CUT_001',
        ruleId: 'MISSING_CUT_CONTOUR',
        severity: 'error',
        category: 'cut',
        title: 'Faca de Corte Ausente',
        message: 'A execução do workflow de corte não gerou um contorno de corte válido.',
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
 * Detecta intenção do usuário para o workflow de faca de corte em linguagem natural.
 */
export function detectCuttingWorkflowSkillFromUserRequest(
  message: string,
  _doc: PrexyonDocument
): { isCuttingWorkflowSkill: boolean; params?: CuttingWorkflowSkillParams } {
  if (!message || typeof message !== 'string') {
    return { isCuttingWorkflowSkill: false };
  }

  const text = message.toLowerCase().trim();

  // Se a solicitação for multi-intenção / composta (ex: "centraliza e cria faca"),
  // NÃO intercepta como Skill isolada para não descartar outros passos; delega ao Planner.
  if (isMultiIntentRequest(text)) {
    return { isCuttingWorkflowSkill: false };
  }

  // Se o pedido for um workflow completo de adesivo ou dtf uv, não aciona a skill isolada de faca
  if (
    text.includes('virar adesivo') ||
    text.includes('vira adesivo') ||
    text.includes('prepara para adesivo') ||
    text.includes('preparar para adesivo') ||
    text.includes('prepara como adesivo') ||
    text.includes('virar dtf') ||
    text.includes('prepara para dtf')
  ) {
    return { isCuttingWorkflowSkill: false };
  }

  // 1. Identificação de Intenção de Faca / Contorno de Corte
  const hasCutIntent =
    text.includes('faca de corte') ||
    text.includes('cria uma faca') ||
    text.includes('criar faca') ||
    text.includes('cria faca') ||
    text.includes('gerar faca') ||
    text.includes('gera faca') ||
    text.includes('faz o contorno de corte') ||
    text.includes('contorno de corte') ||
    text.includes('linha de corte') ||
    text.includes('gera linha de corte') ||
    text.includes('gerar linha de corte') ||
    text.includes('coloca linha de corte') ||
    (text.includes('faca') && (text.includes('cria') || text.includes('criar') || text.includes('coloca') || text.includes('faz')));

  if (!hasCutIntent) {
    return { isCuttingWorkflowSkill: false };
  }

  // 2. Extração Canônica de Parâmetros (Single Source of Truth)
  const parsedOffset = parseCutContourOffsetFromText(text);
  const cutOffset_mm = parsedOffset !== undefined ? parsedOffset : 2.0;
  const includeInnerContours = parseInnerContoursFromText(text);

  const params: CuttingWorkflowSkillParams = {
    cutOffset_mm,
    includeInnerContours,
  };

  return { isCuttingWorkflowSkill: true, params };
}
