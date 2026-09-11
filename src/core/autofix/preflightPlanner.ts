/**
 * Prexyon Agent — Preflight Planner (Etapa 6.11)
 *
 * Planejador determinístico de pré-impressão que analisa o documento completo,
 * consolida problemas, mapeia dependências técnicas explícitas, prioriza ações,
 * executa passos seguros, integra propostas assistidas e calcula o estado final estimado.
 */

import { PrexyonDocument } from '../pdm/types';
import { ToolExecutionContext } from '../tools/types';
import { defaultToolRegistry, ToolRegistry } from '../tools';
import { validateProductionDocument } from '../validation/productionValidationEngine';
import { detectPrepressIssues } from './issueDetector';
import { defaultFixRegistry, FixRegistry } from './fixRegistry';
import {
  generateProposedFixes,
  calculateDocFingerprint,
} from './proposalGenerator';
import { defaultProposalManager, ProposalManager } from './proposalManager';
import { PrepressIssue } from './types';
import {
  PreflightPlan,
  PreflightPlanStep,
  PreflightDependency,
  PreflightProgress,
  PreflightPlanState,
  PreflightExecutionResult,
} from './preflightPlanTypes';

/**
 * Normaliza e consolida issues redundantes ou correlacionadas
 * para evitar poluir a interface do operador com alertas duplicados.
 */
export function normalizeAndGroupIssues(rawIssues: PrepressIssue[]): PrepressIssue[] {
  const consolidated: PrepressIssue[] = [];
  const processedKeys = new Set<string>();

  for (const issue of rawIssues) {
    const nodeKey = issue.affectedNodeId || 'doc';

    // Agrupamento 1: LOW_DPI e CRITICAL_LOW_DPI no mesmo raster -> consolidar na mais severa
    if (issue.code === 'LOW_DPI' || issue.code === 'CRITICAL_LOW_DPI') {
      const dpiKey = `dpi_group_${nodeKey}`;
      if (processedKeys.has(dpiKey)) {
        continue;
      }
      processedKeys.add(dpiKey);

      const allDpi = rawIssues.filter(
        (i) => (i.code === 'LOW_DPI' || i.code === 'CRITICAL_LOW_DPI') && (i.affectedNodeId || 'doc') === nodeKey
      );
      const isCritical = allDpi.some((i) => i.code === 'CRITICAL_LOW_DPI');
      const primary = isCritical
        ? allDpi.find((i) => i.code === 'CRITICAL_LOW_DPI') || issue
        : allDpi[0];

      consolidated.push(primary);
      continue;
    }

    // Agrupamento 2: Deduplicação exata de código + nó
    const uniqueKey = `${issue.code}_${nodeKey}`;
    if (processedKeys.has(uniqueKey)) {
      continue;
    }
    processedKeys.add(uniqueKey);
    consolidated.push(issue);
  }

  return consolidated;
}

/**
 * Constrói o PreflightPlan determinístico a partir do documento PDM.
 */
export function buildPreflightPlan(
  doc: PrexyonDocument,
  customIssues?: PrepressIssue[],
  proposalManager: ProposalManager = defaultProposalManager,
  fixRegistry: FixRegistry = defaultFixRegistry
): PreflightPlan {
  const validation = validateProductionDocument(doc);
  const rawIssues = customIssues || detectPrepressIssues(doc, validation);
  const issues = normalizeAndGroupIssues(rawIssues);
  const fingerprint = calculateDocFingerprint(doc);

  const rawSteps: PreflightPlanStep[] = [];
  const dependencies: PreflightDependency[] = [];

  // 1. Gera steps a partir das issues consolidadas
  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i];
    const stepId = `step_${issue.code.toLowerCase()}_${issue.affectedNodeId || 'doc'}_${i + 1}`;
    const targetNodeIds = issue.affectedNodeId ? [issue.affectedNodeId] : [];
    const targetNode = issue.affectedNodeId ? doc.nodes[issue.affectedNodeId] : undefined;
    const targetNodeNames = targetNode ? [targetNode.name] : issue.affectedNodeName ? [issue.affectedNodeName] : [];

    let tool: string | undefined;
    let parameters: Record<string, unknown> | undefined;
    let proposedFixId: string | undefined;
    let proposedFix: import('./proposalTypes').ProposedFix | undefined;
    let stepClassification = issue.fixClassification;

    // Checa se há proposta assistida que requer confirmação (ex: LOW_DPI proportional resize ou OUT_OF_BOUNDS move)
    const generatedProposals = generateProposedFixes(doc, [issue]);
    if (generatedProposals.length > 0) {
      proposedFix = generatedProposals[0];
      proposedFixId = proposedFix.id;
      tool = proposedFix.toolName;
      parameters = proposedFix.proposedParams;
      proposalManager.registerProposal(proposedFix);
      stepClassification = 'REQUIRES_CONFIRMATION';
    } else if (issue.fixClassification === 'AUTO_FIXABLE') {
      const fix = fixRegistry.getFix(issue.code);
      if (fix && fix.canApply(issue, doc)) {
        tool = fix.toolName;
        parameters = fix.resolveParameters(issue, doc);
        stepClassification = 'AUTO_FIXABLE';
      }
    }

    const friendlyTitle = getFriendlyStepTitle(issue, proposedFix);
    const friendlyDescription = getFriendlyStepDescription(issue, proposedFix);

    rawSteps.push({
      id: stepId,
      issueId: issue.id,
      issueCode: issue.code,
      order: i + 1,
      title: friendlyTitle,
      description: friendlyDescription,
      classification: stepClassification,
      severity: issue.severity,
      targetNodeIds,
      targetNodeNames,
      tool,
      parameters,
      proposedFixId,
      proposedFix,
      dependsOn: [],
      blocks: [],
      status: 'PENDING',
      evidence: issue.evidence,
      recommendation: issue.recommendation,
    });
  }

  // 2. Mapeamento Determinístico de Dependências Técnicas
  // Regra 1: Vetorização precede criação de faca caso o raster não possua vetor
  const cutContourSteps = rawSteps.filter((s) => s.issueCode === 'MISSING_CUT_CONTOUR');
  for (const cutStep of cutContourSteps) {
    const targetId = cutStep.targetNodeIds[0];
    const targetNode = targetId ? doc.nodes[targetId] : undefined;

    if (targetNode && (targetNode.type === 'raster_image' || (targetNode as any).type === 'raster')) {
      const hasVectorTwin = !!(targetNode as any).vectorTwinId;
      if (!hasVectorTwin) {
        // Encontra ou cria dependência de vetorização
        const vecStep = rawSteps.find(
          (s) => s.tool === 'vectorize_raster' && s.targetNodeIds.includes(targetId)
        );
        if (vecStep) {
          cutStep.dependsOn.push(vecStep.id);
          vecStep.blocks.push(cutStep.id);
          cutStep.dependencyExplanation = 'A faca de corte será criada após a conclusão da vetorização.';
          dependencies.push({
            stepId: cutStep.id,
            dependsOnStepId: vecStep.id,
            reason: cutStep.dependencyExplanation,
          });
        }
      }
    }
  }

  // Regra 2: Reposicionamento / Área Segura precede alinhamento e validação de faca
  const moveSteps = rawSteps.filter((s) => s.issueCode === 'OUT_OF_BOUNDS' || s.tool === 'move_node');
  for (const moveStep of moveSteps) {
    const targetId = moveStep.targetNodeIds[0];
    const dependentCutSteps = rawSteps.filter(
      (s) =>
        s.id !== moveStep.id &&
        (s.issueCode === 'CUT_CONTOUR_MISALIGNED' || s.issueCode === 'MISSING_CUT_CONTOUR') &&
        s.targetNodeIds.includes(targetId)
    );

    for (const depCut of dependentCutSteps) {
      if (!depCut.dependsOn.includes(moveStep.id)) {
        depCut.dependsOn.push(moveStep.id);
        moveStep.blocks.push(depCut.id);
        depCut.dependencyExplanation = 'O ajuste da faca será realizado após o reposicionamento do elemento na área segura.';
        dependencies.push({
          stepId: depCut.id,
          dependsOnStepId: moveStep.id,
          reason: depCut.dependencyExplanation,
        });
      }
    }
  }

  // 3. Ordenação Topológica Estrita + Priorização por Severidade e Segurança
  const sortedSteps = sortStepsTopologically(rawSteps);

  // 4. Atribuição de Status Inicial por Step
  for (let idx = 0; idx < sortedSteps.length; idx++) {
    const step = sortedSteps[idx];
    step.order = idx + 1;

    const isBlocked = step.dependsOn.length > 0;
    if (isBlocked) {
      step.status = 'BLOCKED';
    } else if (step.classification === 'AUTO_FIXABLE') {
      step.status = 'READY';
    } else if (step.classification === 'REQUIRES_CONFIRMATION') {
      step.status = 'WAITING_CONFIRMATION';
    } else {
      step.status = 'PENDING';
    }
  }

  // 5. Agrupamento por Categoria
  const automaticSteps = sortedSteps.filter((s) => s.classification === 'AUTO_FIXABLE');
  const confirmationSteps = sortedSteps.filter((s) => s.classification === 'REQUIRES_CONFIRMATION');
  const manualSteps = sortedSteps.filter((s) => s.classification === 'MANUAL' || s.classification === 'INFORMATIONAL');
  const blockedSteps = sortedSteps.filter((s) => s.status === 'BLOCKED');

  // 6. Cálculo de Progresso
  const progress = calculatePlanProgress(sortedSteps);

  // 7. Estimativa do Estado Final
  const estimatedFinalStatus = estimateFinalValidationStatus(sortedSteps);
  const currentState = computePlanState(sortedSteps);

  return {
    id: `preflight_${doc.id}_${Date.now()}`,
    documentRevision: fingerprint,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    initialStatus: validation.status,
    estimatedFinalStatus,
    issues,
    steps: sortedSteps,
    dependencies,
    automaticSteps,
    confirmationSteps,
    manualSteps,
    blockedSteps,
    progress,
    currentState,
  };
}

/**
 * Executa determinística e parcialmente as etapas seguras do plano de preparação.
 */
export async function executePreflightPlan(
  plan: PreflightPlan,
  context: ToolExecutionContext,
  options: {
    autoOnly?: boolean;
    toolRegistry?: ToolRegistry;
    proposalManager?: ProposalManager;
  } = {}
): Promise<PreflightExecutionResult> {
  const toolRegistry = options.toolRegistry || defaultToolRegistry;

  let currentDoc = context.doc;
  const executedSteps: PreflightPlanStep[] = [];
  const receipts: import('../production/review/types').ToolExecutionReceipt[] = [];

  const dynamicContext: ToolExecutionContext = {
    ...context,
    doc: currentDoc,
    setDoc: (newDoc: PrexyonDocument) => {
      currentDoc = newDoc;
      if (context.setDoc) {
        context.setDoc(newDoc);
      }
    },
  };

  // Itera nos steps em ordem topológica
  for (const step of plan.steps) {
    // Apenas executa steps prontos e classificados como AUTO_FIXABLE
    if (step.status !== 'READY' || step.classification !== 'AUTO_FIXABLE' || !step.tool || !step.parameters) {
      continue;
    }

    step.status = 'EXECUTING';
    const startTime = Date.now();
    let toolResult: any;

    try {
      toolResult = await toolRegistry.executeTool(step.tool, step.parameters, {
        ...dynamicContext,
        doc: currentDoc,
      });
    } catch (err: any) {
      toolResult = {
        success: false,
        error: {
          code: 'TOOL_EXECUTION_EXCEPTION',
          message: err?.message || 'Erro inesperado na execução da ferramenta.',
        },
      };
    }

    const receipt: import('../production/review/types').ToolExecutionReceipt = {
      id: `rcpt_${step.tool}_${Date.now()}`,
      toolName: step.tool,
      timestamp: startTime,
      status: toolResult.success ? 'success' : 'failure',
      title: step.title,
      summary: toolResult.message || `Execução de ${step.tool}.`,
      affectedNodeIds: step.targetNodeIds,
      affectedNodeNames: step.targetNodeNames || [],
      parameters: step.parameters,
      resultData: toolResult.data,
      error: toolResult.error,
    };
    receipts.push(receipt);

    if (toolResult.success) {
      step.status = 'COMPLETED';
      step.result = {
        success: true,
        message: toolResult.message || 'Etapa executada com sucesso.',
        receipt,
      };
      executedSteps.push(step);

      // Desbloqueia steps dependentes se todas as suas dependências foram atendidas
      for (const otherStep of plan.steps) {
        if (otherStep.status === 'BLOCKED' && otherStep.dependsOn.includes(step.id)) {
          const allDepsCompleted = otherStep.dependsOn.every(
            (depId) => plan.steps.find((s) => s.id === depId)?.status === 'COMPLETED'
          );
          if (allDepsCompleted) {
            otherStep.status =
              otherStep.classification === 'AUTO_FIXABLE'
                ? 'READY'
                : otherStep.classification === 'REQUIRES_CONFIRMATION'
                ? 'WAITING_CONFIRMATION'
                : 'PENDING';
          }
        }
      }
    } else {
      step.status = 'FAILED';
      step.result = {
        success: false,
        message: toolResult.error?.message || 'Falha na execução da ferramenta.',
        receipt,
        error: toolResult.error?.message,
      };
      executedSteps.push(step);

      // Bloqueia permanentemente dependentes com aviso explicativo
      for (const otherStep of plan.steps) {
        if (otherStep.dependsOn.includes(step.id)) {
          otherStep.status = 'BLOCKED';
          otherStep.dependencyExplanation = `Bloqueado devido à falha na etapa anterior: "${step.title}".`;
        }
      }
    }
  }

  // REVALIDAÇÃO OBRIGATÓRIA PÓS-EXECUÇÃO
  const postValidation = validateProductionDocument(currentDoc);
  const remainingIssues = detectPrepressIssues(currentDoc, postValidation);

  // DETECÇÃO DE RESOLUÇÃO INDIRETA (Side-effects que solucionaram outras etapas)
  for (const step of plan.steps) {
    if (step.status === 'PENDING' || step.status === 'WAITING_CONFIRMATION' || step.status === 'READY') {
      const issueStillPresent = remainingIssues.some(
        (iss) =>
          iss.code === step.issueCode &&
          (!step.targetNodeIds.length || (iss.affectedNodeId && step.targetNodeIds.includes(iss.affectedNodeId)))
      );

      if (!issueStillPresent) {
        step.status = 'COMPLETED';
        step.result = {
          success: true,
          message: 'Resolvido indiretamente por alteração prévia no documento.',
          resolvedIndirectly: true,
        };
      }
    }
  }

  // Atualiza agrupamentos e progresso
  plan.updatedAt = Date.now();
  plan.documentRevision = calculateDocFingerprint(currentDoc);
  plan.automaticSteps = plan.steps.filter((s) => s.classification === 'AUTO_FIXABLE');
  plan.confirmationSteps = plan.steps.filter((s) => s.classification === 'REQUIRES_CONFIRMATION');
  plan.manualSteps = plan.steps.filter((s) => s.classification === 'MANUAL' || s.classification === 'INFORMATIONAL');
  plan.blockedSteps = plan.steps.filter((s) => s.status === 'BLOCKED');
  plan.progress = calculatePlanProgress(plan.steps);
  plan.currentState = computePlanState(plan.steps);
  plan.estimatedFinalStatus = postValidation.status;

  const summaryMessage = buildPreflightExecutionSummary(plan);

  return {
    success: executedSteps.every((s) => s.status === 'COMPLETED'),
    plan,
    executedSteps,
    receipts,
    summaryMessage,
  };
}

/**
 * Verifica se um plano existente está obsoleto em relação ao documento atual.
 */
export function isPreflightPlanStale(plan: PreflightPlan, currentDoc: PrexyonDocument): boolean {
  const currentFingerprint = calculateDocFingerprint(currentDoc);
  return plan.documentRevision !== currentFingerprint;
}

// ----------------------------------------------------------------------------
// Funções Utilitárias Internas
// ----------------------------------------------------------------------------

function sortStepsTopologically(steps: PreflightPlanStep[]): PreflightPlanStep[] {
  const sorted: PreflightPlanStep[] = [];
  const visited = new Set<string>();
  const temp = new Set<string>();

  const stepMap = new Map<string, PreflightPlanStep>();
  for (const step of steps) {
    stepMap.set(step.id, step);
  }

  function visit(stepId: string) {
    if (visited.has(stepId)) return;
    if (temp.has(stepId)) return; // Evita loop em grafo cíclico

    temp.add(stepId);
    const step = stepMap.get(stepId);
    if (step) {
      for (const depId of step.dependsOn) {
        visit(depId);
      }
      visited.add(stepId);
      sorted.push(step);
    }
    temp.delete(stepId);
  }

  // Priorização secundária: Severidade (error > warning > info) e Classificação
  const priorityOrder: Record<string, number> = {
    error: 3,
    warning: 2,
    info: 1,
  };

  const classOrder: Record<string, number> = {
    AUTO_FIXABLE: 4,
    REQUIRES_CONFIRMATION: 3,
    MANUAL: 2,
    INFORMATIONAL: 1,
  };

  const sortedCandidates = [...steps].sort((a, b) => {
    const pA = priorityOrder[a.severity] || 0;
    const pB = priorityOrder[b.severity] || 0;
    if (pA !== pB) return pB - pA;

    const cA = classOrder[a.classification] || 0;
    const cB = classOrder[b.classification] || 0;
    return cB - cA;
  });

  for (const step of sortedCandidates) {
    visit(step.id);
  }

  return sorted;
}

function calculatePlanProgress(steps: PreflightPlanStep[]): PreflightProgress {
  const total = steps.length;
  const completed = steps.filter((s) => s.status === 'COMPLETED').length;
  const waitingConfirmation = steps.filter((s) => s.status === 'WAITING_CONFIRMATION').length;
  const manual = steps.filter((s) => (s.classification === 'MANUAL' || s.classification === 'INFORMATIONAL') && s.status !== 'COMPLETED').length;
  const blocked = steps.filter((s) => s.status === 'BLOCKED').length;
  const failed = steps.filter((s) => s.status === 'FAILED').length;
  const skipped = steps.filter((s) => s.status === 'SKIPPED').length;

  const summaryText = total === 0
    ? 'Documento pronto para produção (nenhum ajuste pendente)'
    : `${completed} de ${total} ${total === 1 ? 'etapa resolvida' : 'etapas resolvidas'}`;

  return {
    total,
    completed,
    waitingConfirmation,
    manual,
    blocked,
    failed,
    skipped,
    summaryText,
  };
}

function computePlanState(steps: PreflightPlanStep[]): PreflightPlanState {
  if (steps.length === 0) return 'READY_FOR_PRODUCTION';

  const hasFailed = steps.some((s) => s.status === 'FAILED');
  const hasBlocked = steps.some((s) => s.status === 'BLOCKED');
  const hasWaitingConfirm = steps.some((s) => s.status === 'WAITING_CONFIRMATION');
  const allCompleted = steps.every((s) => s.status === 'COMPLETED');
  const hasManualUnresolved = steps.some(
    (s) => s.classification === 'MANUAL' && s.severity === 'error' && s.status !== 'COMPLETED'
  );

  if (hasManualUnresolved || hasFailed) return 'BLOCKED';
  if (allCompleted) return 'READY_FOR_PRODUCTION';
  if (hasWaitingConfirm) return 'AWAITING_CONFIRMATION';
  if (hasBlocked) return 'BLOCKED';

  return 'PARTIALLY_EXECUTED';
}

function estimateFinalValidationStatus(
  steps: PreflightPlanStep[]
): import('../validation/types').ValidationStatus {
  const remainingManualBlockers = steps.some(
    (s) => s.classification === 'MANUAL' && s.severity === 'error' && s.status !== 'COMPLETED'
  );
  if (remainingManualBlockers) return 'blocked';

  const remainingWarnings = steps.some(
    (s) => s.severity === 'warning' && s.status !== 'COMPLETED'
  );
  if (remainingWarnings) return 'attention';

  return 'ready';
}

function getFriendlyStepTitle(
  issue: PrepressIssue,
  proposedFix?: import('./proposalTypes').ProposedFix
): string {
  if (proposedFix?.title) return proposedFix.title;

  switch (issue.code) {
    case 'MISSING_CUT_CONTOUR':
      return 'Criar faca de corte externa automática';
    case 'CUT_CONTOUR_MISALIGNED':
      return 'Centralizar e alinhar faca de corte';
    case 'LOW_DPI':
    case 'CRITICAL_LOW_DPI':
      return 'Ajustar escala para adequação de DPI';
    case 'OUT_OF_BOUNDS':
    case 'CUT_CONTOUR_OUTSIDE_ARTBOARD':
      return 'Reposicionar elemento para dentro da área segura';
    case 'RGB_RASTER':
      return 'Converter perfil de cor RGB para CMYK';
    case 'INVALID_DIMENSIONS':
      return 'Corrigir dimensões inválidas da prancheta';
    case 'NO_GRAPHIC_ELEMENTS':
      return 'Inserir elementos gráficos no documento';
    default:
      return issue.message || 'Ajuste técnico de pré-impressão';
  }
}

function getFriendlyStepDescription(
  issue: PrepressIssue,
  proposedFix?: import('./proposalTypes').ProposedFix
): string {
  if (proposedFix?.description) return proposedFix.description;

  switch (issue.code) {
    case 'MISSING_CUT_CONTOUR':
      return 'Gera uma faca de corte externa com sangria e offset seguro de 2.0 mm.';
    case 'CUT_CONTOUR_MISALIGNED':
      return 'Realinha a geometria do contorno de corte com o centro do vetor de origem.';
    case 'LOW_DPI':
    case 'CRITICAL_LOW_DPI':
      return 'A resolução da imagem está abaixo do recomendável para impressão nítida.';
    case 'OUT_OF_BOUNDS':
      return 'O elemento ultrapassa as margens do artboard e sofreria corte indesejado.';
    default:
      return issue.recommendation || issue.message;
  }
}

function buildPreflightExecutionSummary(plan: PreflightPlan): string {
  const parts: string[] = [];

  parts.push(`📋 **Plano de Preparação: ${plan.progress.summaryText}**`);

  const completed = plan.steps.filter((s) => s.status === 'COMPLETED');
  if (completed.length > 0) {
    parts.push(
      '✓ **Etapas Concluídas:**\n' +
        completed.map((s) => `  - ${s.title}${s.result?.resolvedIndirectly ? ' *(resolvido indiretamente)*' : ''}`).join('\n')
    );
  }

  const waiting = plan.steps.filter((s) => s.status === 'WAITING_CONFIRMATION');
  if (waiting.length > 0) {
    parts.push(
      '⏳ **Aguardando sua Confirmação:**\n' +
        waiting.map((s) => `  - **${s.title}**: ${s.description}`).join('\n')
    );
  }

  const manual = plan.steps.filter((s) => s.classification === 'MANUAL' && s.status !== 'COMPLETED');
  if (manual.length > 0) {
    parts.push(
      '⚠ **Atenção Manual Necessária:**\n' +
        manual.map((s) => `  - **${s.title}**: ${s.recommendation}`).join('\n')
    );
  }

  const blocked = plan.steps.filter((s) => s.status === 'BLOCKED');
  if (blocked.length > 0) {
    parts.push(
      '🚫 **Etapas Bloqueadas por Dependência:**\n' +
        blocked.map((s) => `  - ${s.title} *(${s.dependencyExplanation || 'Aguardando etapa anterior'})*`).join('\n')
    );
  }

  return parts.join('\n\n');
}
