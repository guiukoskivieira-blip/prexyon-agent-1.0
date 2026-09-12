/**
 * Prexyon Agent — SkillExecutor (v1.0)
 *
 * Executor de procedimentos da Camada de Skills.
 * REUTILIZA estritamente o ActionPlanExecutor, TargetResolver, PolicyGate e ProductionValidationEngine.
 * NÃO duplica o motor de execução de ferramentas.
 */

import { PrexyonDocument } from '../pdm/types';
import { normalizeDocument } from '../pdm/document';
import { validateActionPlan, executeActionPlan } from '../agent/planner';
import { validateProductionDocument } from '../validation/productionValidationEngine';
import { SkillRegistry, defaultSkillRegistry } from './registry';
import { SkillExecutionOptions, SkillExecutionResult, SkillExecutionStatus } from './types';
import { ValidationReport } from '../validation/types';

export async function executeSkill<TParams = any, TResult = any>(
  skillId: string,
  params: TParams,
  initialDoc: PrexyonDocument,
  options?: SkillExecutionOptions,
  customRegistry?: SkillRegistry
): Promise<SkillExecutionResult<TResult>> {
  const registry = customRegistry || defaultSkillRegistry;
  const doc = normalizeDocument(initialDoc);

  // 1. Consulta SkillRegistry
  const skill = registry.get(skillId);
  if (!skill) {
    return {
      skillId,
      status: 'FAILED',
      originalDocument: doc,
      resultingDocument: doc,
      executedTools: [],
      clientReceipts: options?.clientExecutionReceipts || [],
      evidence: {},
      reason: `Skill com ID "${skillId}" não foi encontrada no registro de Skills.`,
    };
  }

  // 2. Verifica capacidades do ambiente (se informadas)
  if (options?.environmentCapabilities) {
    const capValidation = registry.validateCapabilities(skillId, options.environmentCapabilities);
    if (!capValidation.valid) {
      return {
        skillId,
        status: 'BLOCKED',
        originalDocument: doc,
        resultingDocument: doc,
        executedTools: [],
        clientReceipts: options?.clientExecutionReceipts || [],
        evidence: { missingCapabilities: capValidation.missing },
        reason: `A execução da Skill "${skill.name}" foi bloqueada por ausência de capacidades no ambiente: ${capValidation.missing.join(', ')}.`,
      };
    }
  }

  // 3. Executa checkPreconditions
  const preconditionResult = skill.checkPreconditions(doc, params as any);
  if (!preconditionResult.valid) {
    return {
      skillId,
      status: 'BLOCKED',
      originalDocument: doc,
      resultingDocument: doc,
      executedTools: [],
      clientReceipts: options?.clientExecutionReceipts || [],
      evidence: { preconditionResult },
      reason: preconditionResult.reason || `Pré-condições para a Skill "${skill.name}" não foram atendidas.`,
    };
  }

  // 4. Solicita buildPlan
  let plan;
  try {
    plan = skill.buildPlan(doc, params as any);
  } catch (planErr: any) {
    return {
      skillId,
      status: 'FAILED',
      originalDocument: doc,
      resultingDocument: doc,
      executedTools: [],
      clientReceipts: options?.clientExecutionReceipts || [],
      evidence: {},
      reason: `Erro ao construir o plano de ação da Skill "${skill.name}": ${planErr?.message || planErr}`,
    };
  }

  if (!plan || !Array.isArray(plan.steps)) {
    return {
      skillId,
      status: 'FAILED',
      originalDocument: doc,
      resultingDocument: doc,
      executedTools: [],
      clientReceipts: options?.clientExecutionReceipts || [],
      evidence: {},
      reason: `O plano de ação construído pela Skill "${skill.name}" é inválido ou malformado.`,
    };
  }

  // 5. Valida plano no PolicyGate
  const planValidation = validateActionPlan(plan, doc, options?.selectedNodeId, options?.registry);
  if (!planValidation.valid) {
    return {
      skillId,
      status: 'BLOCKED',
      originalDocument: doc,
      resultingDocument: doc,
      executedTools: [],
      clientReceipts: options?.clientExecutionReceipts || [],
      evidence: { planValidationErrors: planValidation.errors },
      reason: `O plano da Skill "${skill.name}" foi bloqueado pelo PolicyGate: ${planValidation.errors.join('; ')}`,
    };
  }

  // 6. Encaminha plano para infraestrutura EXISTENTE (ActionPlanExecutor)
  const planExecutionResult = await executeActionPlan(planValidation.resolvedPlan!, doc, {
    registry: options?.registry,
    clientExecutionReceipts: options?.clientExecutionReceipts,
    toolExecutionContext: options?.toolExecutionContext,
  });

  if (!planExecutionResult.success) {
    const errMsg = typeof planExecutionResult.error === 'string'
      ? planExecutionResult.error
      : (planExecutionResult.error as any)?.message || `Falha na execução de uma das etapas da Skill "${skill.name}".`;

    return {
      skillId,
      status: 'FAILED',
      originalDocument: doc,
      resultingDocument: planExecutionResult.doc || doc,
      executedTools: planExecutionResult.executedTools,
      clientReceipts: options?.clientExecutionReceipts || [],
      evidence: { stepResults: planExecutionResult.stepResults },
      reason: errMsg,
    };
  }

  const targetProfile = skill.supportedProfiles.find((p) => p !== 'all');
  const resultingDoc = {
    ...planExecutionResult.doc,
    ...(targetProfile ? { profileId: targetProfile } : {}),
  };

  // 7. Executa validateFinalState (Validação Final de Produção)
  let validationReport: ValidationReport;
  if (typeof skill.validateFinalState === 'function') {
    validationReport = skill.validateFinalState(resultingDoc, planExecutionResult.executedTools);
  } else {
    validationReport = validateProductionDocument(resultingDoc);
  }

  // Regra de Ouro: TOOL SUCCESS != SKILL SUCCESS
  let finalStatus: SkillExecutionStatus = 'SUCCESS';
  let failureReason: string | undefined = undefined;

  const hasCriticalErrors =
    validationReport.issues?.some((i) => i.severity === 'error') ||
    validationReport.status === 'blocked';
  const hasWarnings =
    validationReport.issues?.some((i) => i.severity === 'warning') ||
    validationReport.status === 'attention';

  if (hasCriticalErrors) {
    finalStatus = 'BLOCKED';
    const criticalMsgs = validationReport.issues
      .filter((i) => i.severity === 'error')
      .map((i) => i.message)
      .join('; ');
    failureReason = `A validação final de produção da Skill "${skill.name}" falhou com erros críticos: ${criticalMsgs || 'Erro de validação técnica.'}`;
  } else if (hasWarnings) {
    finalStatus = 'SUCCESS_WITH_WARNINGS';
  }

  // 8. Compila evidências factuais do documento final
  const nodeCount = Object.keys(resultingDoc.nodes || {}).length;
  const profileId = resultingDoc.profileId || targetProfile || 'generic';
  const evidence: Record<string, any> = {
    profileId,
    dimensions_mm: resultingDoc.dimensions,
    nodeCount,
    separations: resultingDoc.separations ? Object.keys(resultingDoc.separations) : [],
    validationStatus: validationReport.status,
    executedToolsCount: planExecutionResult.executedTools.length,
  };

  return {
    skillId,
    status: finalStatus,
    originalDocument: doc,
    resultingDocument: resultingDoc,
    executedTools: planExecutionResult.executedTools,
    clientReceipts: options?.clientExecutionReceipts || [],
    validation: validationReport,
    evidence,
    reason: failureReason,
  };
}
