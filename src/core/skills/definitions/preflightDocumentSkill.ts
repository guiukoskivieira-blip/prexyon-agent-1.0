/**
 * Prexyon Agent — Preflight Document Skill (v1.0)
 *
 * Skill determinística de inspeção e preflight sem mutações gráficas no documento.
 * Avalia a prontidão de produção e relata problemas sem alterar a geometria ou camadas.
 */

import { SkillDefinition, SkillPreconditionResult } from '../types';
import { PrexyonDocument } from '../../pdm/types';
import { AgentActionPlan, PlannedAction } from '../../agent/planner/types';
import { ExecutedToolRecord } from '../../agent/types';
import { ValidationReport } from '../../validation/types';
import { validateProductionDocument } from '../../validation/productionValidationEngine';

export interface PreflightDocumentSkillParams {}

export const preflightDocumentSkill: SkillDefinition<PreflightDocumentSkillParams> = {
  id: 'preflight_document',
  name: 'Preflight do Documento',
  description: 'Workflow determinístico de inspeção e preflight de produção sem mutações no documento.',
  supportedProfiles: ['all'],
  requiredCapabilities: [
    'production-validation',
  ],

  checkPreconditions(doc: PrexyonDocument, _params?: PreflightDocumentSkillParams): SkillPreconditionResult {
    if (!doc) {
      return { valid: false, reason: 'Documento PDM não fornecido para preflight.' };
    }
    return { valid: true };
  },

  buildPlan(_doc: PrexyonDocument, _params?: PreflightDocumentSkillParams): AgentActionPlan {
    const steps: PlannedAction[] = [
      {
        id: 'step_validate',
        tool: 'validate_production',
        arguments: {},
        description: 'Executar verificação de preflight e prontidão de produção.',
      },
    ];

    return {
      schemaVersion: '1.0',
      intent: 'ANALYZE',
      process: 'UNSPECIFIED',
      target: { type: 'DOCUMENT' },
      steps,
      explanation: 'Plano determinístico de inspecao e preflight (preflight_document).',
    };
  },

  validateFinalState(doc: PrexyonDocument, _executedTools: ExecutedToolRecord[]): ValidationReport {
    return validateProductionDocument(doc);
  },
};

/**
 * Detecta intenção do usuário para inspecionar / realizar preflight do documento em linguagem natural.
 */
export function detectPreflightDocumentSkillFromUserRequest(
  message: string,
  _doc: PrexyonDocument
): { isPreflightSkill: boolean; params?: PreflightDocumentSkillParams } {
  if (!message || typeof message !== 'string') {
    return { isPreflightSkill: false };
  }

  const text = message.toLowerCase().trim();

  // 1. Identificação de Intenção de Preflight / Inspeção
  const hasPreflightIntent =
    text.includes('analisa essa arte') ||
    text.includes('analisar essa arte') ||
    text.includes('analisa o documento') ||
    text.includes('analisar o documento') ||
    text.includes('faz um preflight') ||
    text.includes('fazer preflight') ||
    text.includes('faz preflight') ||
    text.includes('fazer um preflight') ||
    text.includes('preflight') ||
    text.includes('verifica se o arquivo está pronto') ||
    text.includes('verificar se o arquivo está pronto') ||
    text.includes('checa os erros') ||
    text.includes('checar erros') ||
    text.includes('checa erros') ||
    text.includes('inspeciona a arte') ||
    text.includes('inspecionar a arte');

  if (!hasPreflightIntent) {
    return { isPreflightSkill: false };
  }

  return { isPreflightSkill: true, params: {} };
}
