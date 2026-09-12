/**
 * Prexyon Agent — Action Plan Executor
 *
 * Executa planos de ação validados de forma multi-step, sequencial e segura.
 * Interrompe a cadeia de dependências se algum step falhar e gera recibos de execução auditáveis.
 */

import { PrexyonDocument } from '../../pdm/types';
import { normalizeDocument } from '../../pdm/document';
import { ToolRegistry } from '../../tools/registry';
import { defaultToolRegistry } from '../../tools';
import { ToolExecutionContext } from '../../tools/types';
import { ExecutedToolRecord } from '../types';
import { AgentActionPlan, PlanExecutionResult, ActionStepExecutionResult } from './types';
import { validateProductionDocument } from '../../validation/productionValidationEngine';
import { composePlanResponse } from './responseComposer';
import { verifyMutationEvidence, reconcileAgentResponseWithExecutionEvidence } from './responseReconciler';
import { resolveTargetReference } from './targetResolver';

export { verifyMutationEvidence };

export async function executeActionPlan(
  plan: AgentActionPlan,
  initialDoc: PrexyonDocument,
  options?: {
    registry?: ToolRegistry;
    clientExecutionReceipts?: import('../types').ClientExecutionReceipt[];
    toolExecutionContext?: Omit<ToolExecutionContext, 'doc'>;
  }
): Promise<PlanExecutionResult> {
  const registry = options?.registry || defaultToolRegistry;
  let currentDoc = normalizeDocument(initialDoc);
  const receipts = options?.clientExecutionReceipts || [];

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

    const selectedNodeId = (options?.toolExecutionContext as any)?.selectedNodeId;
    let stepArgs = { ...step.arguments };

    // Regra de Ouro: Checa se a ação já foi executada no cliente com recibo E prova no PDM
    let alreadyCompletedOnClient = false;
    if (step.tool === 'vectorize_raster') {
      const hasReceipt = receipts.some((r) => r.action === 'vectorize_raster' && r.status === 'success');
      const targetId = (stepArgs.nodeId as string) || selectedNodeId;
      const targetRaster = targetId ? (currentDoc.nodes[targetId] as import('../../pdm/types').RasterNode) : undefined;
      const derivedVector = Object.values(currentDoc.nodes).find(
        (n) => n && (n.type === 'group' || (n as any).type === 'vector_group') && (
          (n as any).sourceRasterNodeId === targetId ||
          (targetId && currentDoc.nodes[targetId] && n.name === `Vetor: ${currentDoc.nodes[targetId].name}`)
        )
      ) as import('../../pdm/types').VectorGroupNode | undefined;

      const isVectorFresh = Boolean(
        derivedVector && (!targetRaster || (
          Math.abs(derivedVector.physicalWidth_mm - targetRaster.physicalWidth_mm) < 0.1 &&
          Math.abs(derivedVector.physicalHeight_mm - targetRaster.physicalHeight_mm) < 0.1 &&
          Math.abs((derivedVector.position_mm?.x ?? 0) - (targetRaster.position_mm?.x ?? 0)) < 0.1 &&
          Math.abs((derivedVector.position_mm?.y ?? 0) - (targetRaster.position_mm?.y ?? 0)) < 0.1
        ))
      );

      alreadyCompletedOnClient = (hasReceipt && isVectorFresh) || isVectorFresh;
    } else if (step.tool === 'remove_background') {
      const hasReceipt = receipts.some((r) => r.action === 'remove_background' && r.status === 'success');
      alreadyCompletedOnClient = hasReceipt;
    } else if (step.tool === 'generate_white_underbase') {
      const hasReceipt = receipts.some((r) => r.action === 'generate_white_underbase' && r.status === 'success');
      const hasWhiteSep = Boolean(currentDoc.separations?.white && currentDoc.separations.white.status === 'GENERATED');
      alreadyCompletedOnClient = (hasReceipt && hasWhiteSep) || hasWhiteSep;
    } else if (step.tool === 'generate_clear_separation') {
      const hasReceipt = receipts.some((r) => r.action === 'generate_clear_separation' && r.status === 'success');
      const hasClearSep = Boolean(currentDoc.separations?.clear && currentDoc.separations.clear.status === 'GENERATED');
      alreadyCompletedOnClient = (hasReceipt && hasClearSep) || hasClearSep;
    }

    if (alreadyCompletedOnClient) {
      stepResults.push({
        stepId,
        toolName: step.tool,
        args: stepArgs,
        status: 'COMPLETED',
        result: {
          success: true,
          doc: currentDoc,
          message: `Ação "${step.tool}" já executada com sucesso no cliente.`,
          data: { clientExecutionVerified: true },
        },
      });
      executedTools.push({
        toolName: step.tool,
        args: stepArgs,
        result: {
          success: true,
          doc: currentDoc,
          message: `Ação "${step.tool}" já executada com sucesso no cliente.`,
          data: { clientExecutionVerified: true },
        },
        timestamp: Date.now(),
      });
      continue;
    }

    // Resolve argumentos dinamicamente contra o estado atual do PDM (ex: novo VectorGroup produzido no step anterior)
    if (step.tool === 'vectorize_raster') {
      if (!stepArgs.nodeId) {
        const resolved = resolveTargetReference(plan.target, currentDoc, selectedNodeId);
        if (resolved.nodeId) {
          stepArgs.nodeId = resolved.nodeId;
        }
      }
    } else if (step.tool === 'create_cut_contour') {
      const currentSource = stepArgs.sourceNodeId ? currentDoc.nodes[stepArgs.sourceNodeId as string] : null;
      if (!currentSource || (currentSource.type !== 'group' && (currentSource as any).type !== 'vector_group')) {
        const targetRasterId = (stepArgs.sourceNodeId as string) || selectedNodeId;
        const allNodes = Object.values(currentDoc.nodes);
        
        // 1. Procura grupo vetorial derivado do raster alvo
        const matchingVector = allNodes.find(
          (n) => n && (n.type === 'group' || (n as any).type === 'vector_group') && (
            (n as any).sourceRasterNodeId === targetRasterId ||
            (targetRasterId && currentDoc.nodes[targetRasterId] && n.name?.includes(currentDoc.nodes[targetRasterId].name)) ||
            n.name?.includes('Vetor')
          )
        ) || allNodes.find((n) => n && (n.type === 'group' || (n as any).type === 'vector_group'));

        if (matchingVector) {
          stepArgs.sourceNodeId = matchingVector.id;
        } else {
          const resolved = resolveTargetReference(plan.target, currentDoc, selectedNodeId);
          if (resolved.node && (resolved.node.type === 'group' || (resolved.node as any).type === 'vector_group')) {
            stepArgs.sourceNodeId = resolved.node.id;
          } else if (resolved.nodeId && !stepArgs.sourceNodeId) {
            stepArgs.sourceNodeId = resolved.nodeId;
          }
        }
      }
    } else if (step.tool === 'resize_node') {
      if (!stepArgs.nodeId) {
        const resolved = resolveTargetReference(plan.target, currentDoc, selectedNodeId);
        if (resolved.nodeId) {
          stepArgs.nodeId = resolved.nodeId;
        }
      }
    }

    try {
      const execResult = await registry.executeTool(step.tool, stepArgs, {
        ...options?.toolExecutionContext,
        doc: currentDoc,
      });

      executedTools.push({
        toolName: step.tool,
        args: stepArgs,
        result: execResult,
        timestamp: Date.now(),
      });

      if (execResult.success) {
        const nextDoc = execResult.doc || currentDoc;
        const evidence = verifyMutationEvidence(step.tool, stepArgs, currentDoc, nextDoc, execResult);

        if (evidence.verified) {
          currentDoc = nextDoc;
          stepResults.push({
            stepId,
            toolName: step.tool,
            args: stepArgs,
            status: 'COMPLETED',
            result: execResult,
          });
        } else {
          executionHalted = true;
          stepResults.push({
            stepId,
            toolName: step.tool,
            args: stepArgs,
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
          args: stepArgs,
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
        args: stepArgs,
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
