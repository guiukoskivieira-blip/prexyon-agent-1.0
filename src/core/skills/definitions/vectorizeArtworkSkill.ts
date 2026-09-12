/**
 * Prexyon Agent — Vectorize Artwork Skill (v1.0)
 *
 * Skill determinística para vetorizar imagens raster em grupos vetoriais reutilizáveis
 * sem criar faca de corte, sem alterar o perfil e sem gerar pacote final de saída.
 */

import { SkillDefinition, SkillPreconditionResult } from '../types';
import { PrexyonDocument, VectorGroupNode } from '../../pdm/types';
import { AgentActionPlan, PlannedAction } from '../../agent/planner/types';
import { ExecutedToolRecord } from '../../agent/types';
import { ValidationReport, ValidationIssue, ValidationStatus } from '../../validation/types';
import { validateProductionDocument } from '../../validation/productionValidationEngine';

export interface VectorizeArtworkSkillParams {
  preset?: 'logo' | 'illustration' | 'detailed';
  nodeId?: string;
}

export const vectorizeArtworkSkill: SkillDefinition<VectorizeArtworkSkillParams> = {
  id: 'vectorize_artwork',
  name: 'Vetorizar Arte',
  description: 'Workflow determinístico para vetorização de imagens raster em grupos vetoriais sem geração de faca.',
  supportedProfiles: ['all'],
  requiredCapabilities: [
    'vectorization',
    'production-validation',
  ],

  checkPreconditions(doc: PrexyonDocument, _params?: VectorizeArtworkSkillParams): SkillPreconditionResult {
    // 1. Documento nulo
    if (!doc) {
      return { valid: false, reason: 'Documento PDM não fornecido.' };
    }

    // 2. Procura imagem raster visível
    const rasterNodes = Object.values(doc.nodes || {}).filter(
      (n) => n && n.visible !== false && n.type === 'raster_image'
    );

    if (rasterNodes.length === 0) {
      return {
        valid: false,
        reason: 'Documento não possui imagem raster para vetorização.',
      };
    }

    return { valid: true };
  },

  buildPlan(doc: PrexyonDocument, params?: VectorizeArtworkSkillParams): AgentActionPlan {
    const preset = params?.preset || 'logo';

    const rasterNodes = Object.values(doc.nodes || {}).filter(
      (n) => n && n.visible !== false && n.type === 'raster_image'
    );

    let targetNode = params?.nodeId ? doc.nodes[params.nodeId] : undefined;
    if (!targetNode) {
      targetNode = rasterNodes[0];
    }

    const targetNodeId = targetNode ? targetNode.id : undefined;

    const steps: PlannedAction[] = [];
    const stepIds: string[] = [];

    // Step 1: vectorize_raster
    if (targetNodeId) {
      const sId = 'step_vectorize';
      steps.push({
        id: sId,
        tool: 'vectorize_raster',
        arguments: {
          nodeId: targetNodeId,
          preset,
        },
        description: `Vetorizar imagem raster com preset ${preset}.`,
      });
      stepIds.push(sId);
    }

    // Step 2: validate_production
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
      intent: 'VECTORIZE',
      process: 'UNSPECIFIED',
      target: { type: 'DOCUMENT' },
      steps,
      explanation: 'Plano determinístico para vetorização de imagem raster (vectorize_artwork).',
    };
  },

  validateFinalState(doc: PrexyonDocument, _executedTools: ExecutedToolRecord[]): ValidationReport {
    const report = validateProductionDocument(doc);
    const issues: ValidationIssue[] = [...(report.issues || [])];

    // Checagem de existência de VectorGroupNode
    const vectorGroup = Object.values(doc.nodes || {}).find(
      (n) => n && (n.type === 'group' || (n as any).type === 'vector_group')
    ) as VectorGroupNode | undefined;

    if (!vectorGroup) {
      issues.push({
        id: 'SKILL_VEC_001',
        ruleId: 'MISSING_VECTOR_GROUP',
        severity: 'error',
        category: 'geometry',
        title: 'Vetorização Ausente',
        message: 'A execução da vetorização não gerou um grupo de vetores válido.',
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
 * Detecta intenção do usuário para vetorização de arte em linguagem natural.
 */
export function detectVectorizeArtworkSkillFromUserRequest(
  message: string,
  _doc: PrexyonDocument
): { isVectorizeSkill: boolean; params?: VectorizeArtworkSkillParams } {
  if (!message || typeof message !== 'string') {
    return { isVectorizeSkill: false };
  }

  const text = message.toLowerCase().trim();

  // Se o pedido contiver intenção de faca/corte ou workflow completo de adesivo/dtf, não aciona vetorização pura
  if (
    text.includes('faca') ||
    text.includes('corte') ||
    text.includes('sangria') ||
    text.includes('adesivo') ||
    text.includes('dtf')
  ) {
    return { isVectorizeSkill: false };
  }

  // 1. Identificação de Intenção de Vetorização
  const hasVectorizeIntent =
    text.includes('vetoriza') ||
    text.includes('vetorizar') ||
    text.includes('transforma em vetor') ||
    text.includes('transformar em vetor') ||
    text.includes('transforma essa imagem em vetor') ||
    text.includes('transformar essa imagem em vetor') ||
    text.includes('gera vetor') ||
    text.includes('gerar vetor') ||
    text.includes('vetor da arte') ||
    text.includes('vetor desta logo') ||
    text.includes('vetorizar este raster') ||
    text.includes('vetorizar imagem');

  if (!hasVectorizeIntent) {
    return { isVectorizeSkill: false };
  }

  // 2. Extração de Preset
  let preset: 'logo' | 'illustration' | 'detailed' = 'logo';
  if (text.includes('ilustração') || text.includes('ilustracao')) {
    preset = 'illustration';
  } else if (text.includes('detalhado') || text.includes('detalhes')) {
    preset = 'detailed';
  }

  const params: VectorizeArtworkSkillParams = {
    preset,
  };

  return { isVectorizeSkill: true, params };
}
