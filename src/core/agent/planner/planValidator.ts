/**
 * Prexyon Agent — Plan Validator
 *
 * Validador determinístico do plano de ação antes da execução:
 * 1. Verifica existência da ferramenta no ToolRegistry.
 * 2. Normaliza argumentos (conversão de unidades cm -> mm via UnitNormalizer).
 * 3. Resolve target reference para nós reais do PDM via TargetResolver.
 * 4. Valida compatibilidade com Policy & Safety Gate.
 * 5. Garante que restrições do operador (constraints) sejam respeitadas.
 */

import { PrexyonDocument } from '../../pdm/types';
import { ToolRegistry } from '../../tools/registry';
import { defaultToolRegistry } from '../../tools';
import { AgentActionPlan, PlanValidationResult, PlannedAction } from './types';
import { resolveTargetReference, injectResolvedNodeIdIntoAction } from './targetResolver';
import { normalizeActionArguments } from './unitNormalizer';
import { evaluatePolicyGate } from './policyGate';

export function validateActionPlan(
  plan: AgentActionPlan,
  doc: PrexyonDocument,
  selectedNodeId?: string,
  registry: ToolRegistry = defaultToolRegistry
): PlanValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!plan || typeof plan !== 'object') {
    return { valid: false, errors: ['Plano de ação nulo ou em formato inválido.'], warnings: [] };
  }

  if (plan.schemaVersion !== '1.0') {
    errors.push(`Versão de schema "${plan.schemaVersion}" não suportada (esperado: "1.0").`);
  }

  // 1. Resolve o nó alvo no PDM
  const targetRes = resolveTargetReference(plan.target, doc, selectedNodeId);
  if (targetRes.error && plan.steps.length > 0) {
    // Se há steps que exigem nó e não foi possível resolver o alvo
    const needsNode = plan.steps.some((s) =>
      ['resize_node', 'vectorize_raster', 'create_cut_contour', 'close_cut_contour', 'simplify_vector_path'].includes(s.tool)
    );
    if (needsNode) {
      errors.push(targetRes.error);
    }
  }

  const resolvedSteps: PlannedAction[] = [];

  // 2. Valida cada ação planejada
  for (let i = 0; i < plan.steps.length; i++) {
    const rawStep = plan.steps[i];
    const stepId = rawStep.id || `step_${i + 1}`;

    // A. Verifica existência no ToolRegistry
    const toolDef = registry.getTool(rawStep.tool);
    if (!toolDef) {
      errors.push(`A ferramenta "${rawStep.tool}" não existe ou não está registrada no Prexyon Agent.`);
      continue;
    }

    // B. Normaliza argumentos de unidades
    let normalizedArgs = normalizeActionArguments(rawStep.tool, rawStep.arguments || {});

    // C. Injeta nodeId resolvido se necessário
    let actionWithTarget: PlannedAction = {
      ...rawStep,
      id: stepId,
      arguments: normalizedArgs,
    };
    actionWithTarget = injectResolvedNodeIdIntoAction(actionWithTarget, targetRes.nodeId);

    // D. Validação de argumentos obrigatórios mínimos
    if (rawStep.tool === 'resize_node') {
      const w = actionWithTarget.arguments.width_mm;
      const h = actionWithTarget.arguments.height_mm;
      if (w === undefined && h === undefined) {
        errors.push(`Ação "${stepId}" (resize_node) requer "width_mm" ou "height_mm".`);
      }
      if (w !== undefined && (typeof w !== 'number' || w <= 0)) {
        errors.push(`Ação "${stepId}" (resize_node) possui largura inválida: ${w}.`);
      }
      if (h !== undefined && (typeof h !== 'number' || h <= 0)) {
        errors.push(`Ação "${stepId}" (resize_node) possui altura inválida: ${h}.`);
      }
    }

    // E. Avaliação pelo Policy Gate
    const gateDecision = evaluatePolicyGate(actionWithTarget, plan, doc);
    if (!gateDecision.allowed) {
      errors.push(`Ação "${stepId}" (${rawStep.tool}) bloqueada: ${gateDecision.blockedReason}`);
      continue;
    }

    resolvedSteps.push(gateDecision.sanitizedAction || actionWithTarget);
  }

  const valid = errors.length === 0;
  const resolvedPlan: AgentActionPlan = {
    ...plan,
    steps: resolvedSteps,
  };

  return {
    valid,
    errors,
    warnings,
    resolvedPlan: valid ? resolvedPlan : undefined,
    resolvedTargetNodeId: targetRes.nodeId || undefined,
  };
}
