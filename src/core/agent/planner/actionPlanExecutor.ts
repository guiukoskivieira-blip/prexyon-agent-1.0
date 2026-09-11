/**
 * Prexyon Agent — Action Plan Executor
 *
 * Executa planos de ação validados de forma multi-step, sequencial e segura.
 * Interrompe a cadeia de dependências se algum step falhar e gera recibos de execução auditáveis.
 */

import { PrexyonDocument } from '../../pdm/types';
import { ToolRegistry } from '../../tools/registry';
import { defaultToolRegistry } from '../../tools';
import { ToolExecutionContext } from '../../tools/types';
import { ExecutedToolRecord } from '../types';
import { AgentActionPlan, PlanExecutionResult, ActionStepExecutionResult } from './types';
import { validateProductionDocument } from '../../validation/productionValidationEngine';
import { composePlanResponse } from './responseComposer';
import { verifyMutationEvidence, reconcileAgentResponseWithExecutionEvidence } from './responseReconciler';

export { verifyMutationEvidence };

export async function executeActionPlan(
  plan: AgentActionPlan,
  initialDoc: PrexyonDocument,
  options?: {
    registry?: ToolRegistry;
    toolExecutionContext?: Omit<ToolExecutionContext, 'doc'>;
  }
): Promise<PlanExecutionResult> {
  const registry = options?.registry || defaultToolRegistry;
  let currentDoc = initialDoc;

  // Atualiza profile no PDM se explicitamente indicado pelo plano
  if (plan.process === 'DTF_UV' && currentDoc.profileId !== 'dtf-uv') {
    currentDoc = { ...currentDoc, profileId: 'dtf-uv' };
  } else if (plan.process === 'GENERIC_STICKER' && currentDoc.profileId !== 'generic-sticker') {
    currentDoc = { ...currentDoc, profileId: 'generic-sticker' };
  }

  const stepResults: ActionStepExecutionResult[] = [];
  const executedTools: ExecutedToolRecord[] = [];
  let executionHalted = false;

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const stepId = step.id || `step_${i + 1}`;

    // Se houve falha anterior em steps interdependentes, bloqueia os subsequentes
    if (executionHalted) {
      stepResults.push({
        stepId,
        toolName: step.tool,
        args: step.arguments,
        status: 'BLOCKED',
        error: 'Etapa bloqueada devido a falha na etapa anterior.',
      });
      continue;
    }

    try {
      const execResult = await registry.executeTool(step.tool, step.arguments, {
        ...options?.toolExecutionContext,
        doc: currentDoc,
      });

      executedTools.push({
        toolName: step.tool,
        args: step.arguments,
        result: execResult,
        timestamp: Date.now(),
      });

      if (execResult.success) {
        const nextDoc = execResult.doc || currentDoc;
        const evidence = verifyMutationEvidence(step.tool, step.arguments, currentDoc, nextDoc, execResult);

        if (evidence.verified) {
          currentDoc = nextDoc;
          stepResults.push({
            stepId,
            toolName: step.tool,
            args: step.arguments,
            status: 'COMPLETED',
            result: execResult,
          });
        } else {
          executionHalted = true;
          stepResults.push({
            stepId,
            toolName: step.tool,
            args: step.arguments,
            status: 'FAILED',
            result: execResult,
            error: evidence.error || 'A mutação esperada não foi encontrada no documento.',
          });
        }
      } else {
        executionHalted = true;
        stepResults.push({
          stepId,
          toolName: step.tool,
          args: step.arguments,
          status: 'FAILED',
          result: execResult,
          error: execResult.error?.message || 'Falha na execução da ferramenta.',
        });
      }
    } catch (err: unknown) {
      executionHalted = true;
      const msg = err instanceof Error ? err.message : 'Exceção inesperada na execução.';
      stepResults.push({
        stepId,
        toolName: step.tool,
        args: step.arguments,
        status: 'FAILED',
        error: msg,
      });
    }
  }

  // Revalidação pós-execução
  const validationReport = validateProductionDocument(currentDoc);

  const rawReply = composePlanResponse(plan, stepResults, validationReport, currentDoc);
  const reconciled = reconcileAgentResponseWithExecutionEvidence({
    rawReply,
    plan,
    executedTools,
    initialDoc,
    finalDoc: currentDoc,
    validationReport,
  });

  return {
    success: reconciled.success,
    doc: currentDoc,
    plan,
    stepResults,
    reply: reconciled.reply,
    executedTools,
    ...(reconciled.success ? {} : {
      error: {
        code: 'PLAN_EXECUTION_FAILED',
        message: stepResults.find((s) => s.status === 'FAILED')?.error || reconciled.error?.message || 'Uma ou mais etapas do plano falharam.',
      },
    }),
  };
}
