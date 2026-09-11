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

function verifyMutationEvidence(
  toolName: string,
  _args: any,
  _prevDoc: PrexyonDocument,
  nextDoc: PrexyonDocument,
  execResult: any
): { verified: boolean; error?: string } {
  if (toolName === 'vectorize_raster') {
    const hasVectorNode = Object.values(nextDoc.nodes || {}).some(
      (n) => n && (n.type === 'group' || (n as any).type === 'vector_group')
    );
    if (!hasVectorNode) {
      return {
        verified: false,
        error: 'Nenhum nó vetorial foi gerado no documento.',
      };
    }
  } else if (toolName === 'create_cut_contour') {
    const hasCutNode = Object.values(nextDoc.nodes || {}).some(
      (n) => n && n.type === 'cut_contour'
    );
    if (!hasCutNode) {
      return {
        verified: false,
        error: 'Nenhum contorno de corte foi gerado no documento.',
      };
    }
  } else if (toolName === 'generate_white_underbase') {
    const whiteSep = nextDoc.separations?.white || (nextDoc.separations as any)?.WHITE;
    const hasWhiteSeparation = Boolean(
      (whiteSep && whiteSep.valid) ||
      (execResult.data?.separation && execResult.data.separation.valid) ||
      execResult.data?.role === 'WHITE'
    );
    if (!hasWhiteSeparation) {
      return {
        verified: false,
        error: 'A separação de Base Branca não foi gerada.',
      };
    }
  } else if (toolName === 'generate_clear_separation') {
    const clearSep = nextDoc.separations?.clear || (nextDoc.separations as any)?.CLEAR;
    const hasClearSeparation = Boolean(
      (clearSep && clearSep.valid) ||
      (execResult.data?.separation && execResult.data.separation.valid) ||
      execResult.data?.role === 'CLEAR'
    );
    if (!hasClearSeparation) {
      return {
        verified: false,
        error: 'A separação de Verniz/Clear não foi gerada.',
      };
    }
  } else if (
    toolName === 'generate_dtf_uv_production_package' ||
    toolName === 'create_production_package' ||
    toolName === 'build_production_package'
  ) {
    const pkg = execResult.data?.package || execResult.data;
    const artifacts = pkg?.artifacts || execResult.data?.artifacts;
    if (!Array.isArray(artifacts) || artifacts.length === 0) {
      return {
        verified: false,
        error: 'Nenhum artefato de produção foi gerado no pacote.',
      };
    }
  }

  return { verified: true };
}

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

  const overallSuccess = stepResults.length > 0
    ? stepResults.every((s) => s.status === 'COMPLETED')
    : true;

  // Composição da resposta final baseada em fatos reais
  const reply = composePlanResponse(plan, stepResults, validationReport, currentDoc);

  return {
    success: overallSuccess,
    doc: currentDoc,
    plan,
    stepResults,
    reply,
    executedTools,
    ...(overallSuccess ? {} : {
      error: {
        code: 'PLAN_EXECUTION_FAILED',
        message: stepResults.find((s) => s.status === 'FAILED')?.error || 'Uma ou mais etapas do plano falharam.',
      },
    }),
  };
}
