/**
 * Prexyon Agent — Safe Auto-Fix Engine (Etapa 6.9)
 *
 * Motor determinístico de planejamento, execução atômica/segura e revalidação
 * obrigatória de problemas de pré-impressão.
 * 
 * Regras Obrigatórias:
 * 1. Somente executa fixes classificados como AUTO_FIXABLE.
 * 2. REVALIDAÇÃO OBRIGATÓRIA: o fix só é declarado aplicado se a revalidação confirmar
 *    que o problema não existe mais no PDM resultante.
 * 3. ANTI-LOOP: Execução atômica em passe único determinístico, sem laços de repetição.
 * 4. Histórico preservado: usa HistoryManager / Command Pattern para suporte completo a Undo/Redo.
 */

import { PrexyonDocument } from '../pdm/types';
import { ExecutedToolRecord } from '../agent/types';
import { ToolExecutionContext } from '../tools/types';
import { defaultToolRegistry, ToolRegistry } from '../tools';
import { validateProductionDocument } from '../validation/productionValidationEngine';
import { detectPrepressIssues } from './issueDetector';
import { FixRegistry, defaultFixRegistry } from './fixRegistry';
import {
  AutoFixPlan,
  AutoFixPlanItem,
  AutoFixResult,
  AttemptedFixRecord,
  AppliedFixRecord,
  FailedFixRecord,
  PrepressIssue,
} from './types';

export interface AutoFixExecutionOptions {
  /** Se deve filtrar apenas para um nó alvo específico */
  targetNodeId?: string;
  /** Registro de ferramentas customizado (útil para testes) */
  toolRegistry?: ToolRegistry;
  /** Registro de fixes customizado */
  fixRegistry?: FixRegistry;
  /** Modo de execução */
  mode?: 'all_safe' | 'only_node';
}

/**
 * Compila o plano determinístico de correções a partir do documento PDM.
 */
export function generateAutoFixPlan(
  doc: PrexyonDocument,
  customIssues?: PrepressIssue[],
  registry: FixRegistry = defaultFixRegistry
): AutoFixPlan {
  const issues = customIssues || detectPrepressIssues(doc);

  const items: AutoFixPlanItem[] = [];
  const seenKeys = new Set<string>();
  let autoFixableCount = 0;
  let requiresConfirmationCount = 0;
  let manualCount = 0;
  let informationalCount = 0;

  for (const issue of issues) {
    if (issue.fixClassification === 'AUTO_FIXABLE') {
      autoFixableCount++;
      const planItem = registry.createPlanItem(issue, doc);
      if (planItem) {
        const dedupeKey = `${planItem.toolName}:${planItem.targetNodeId || 'doc'}:${planItem.issue.code}`;
        if (!seenKeys.has(dedupeKey)) {
          seenKeys.add(dedupeKey);
          items.push(planItem);
        }
      }
    } else if (issue.fixClassification === 'REQUIRES_CONFIRMATION') {
      requiresConfirmationCount++;
    } else if (issue.fixClassification === 'MANUAL') {
      manualCount++;
    } else if (issue.fixClassification === 'INFORMATIONAL') {
      informationalCount++;
    }
  }

  return {
    items,
    autoFixableCount,
    requiresConfirmationCount,
    manualCount,
    informationalCount,
  };
}

/**
 * Executa o fluxo determinístico completo:
 * VALIDATE -> PLAN -> EXECUTE TOOLS -> REVALIDATE -> VERIFY RESOLUTION.
 */
export async function executeAutoFix(
  doc: PrexyonDocument,
  context: ToolExecutionContext,
  options: AutoFixExecutionOptions = {}
): Promise<AutoFixResult> {
  const toolRegistry = options.toolRegistry || defaultToolRegistry;
  const fixRegistry = options.fixRegistry || defaultFixRegistry;

  // 1. VALIDAÇÃO INICIAL
  const initialValidation = validateProductionDocument(doc);
  const issuesBefore = detectPrepressIssues(doc, initialValidation);
  const statusBefore = initialValidation.status;

  // 2. GERAÇÃO DO PLANO DETERMINÍSTICO COM DEDUPLICAÇÃO
  let plan = generateAutoFixPlan(doc, issuesBefore, fixRegistry);

  if (options.targetNodeId) {
    plan = {
      ...plan,
      items: plan.items.filter((item) => item.targetNodeId === options.targetNodeId),
    };
  }

  const attemptedFixes: AttemptedFixRecord[] = [];
  const appliedFixes: AppliedFixRecord[] = [];
  const failedFixes: FailedFixRecord[] = [];
  const executedTools: ExecutedToolRecord[] = [];

  let currentDoc = doc;

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

  for (const item of plan.items) {
    const startTime = Date.now();
    let toolResult: any;

    try {
      toolResult = await toolRegistry.executeTool(
        item.toolName,
        item.parameters,
        { ...dynamicContext, doc: currentDoc }
      );
    } catch (err: any) {
      toolResult = {
        success: false,
        error: {
          code: 'EXECUTION_EXCEPTION',
          message: err?.message || 'Erro inesperado na execução da ferramenta.',
        },
      };
    }

    executedTools.push({
      toolName: item.toolName,
      args: item.parameters,
      result: toolResult,
      timestamp: startTime,
    });

    attemptedFixes.push({
      fixId: item.fixId,
      toolName: item.toolName,
      issueCode: item.issue.code,
      targetNodeId: item.targetNodeId,
      success: !!toolResult?.success,
      error: toolResult?.error?.message,
      parameters: item.parameters,
    });
  }

  // 4. REVALIDAÇÃO OBRIGATÓRIA NO DOCUMENTO RESULTANTE
  const postValidation = validateProductionDocument(currentDoc);
  const issuesAfter = detectPrepressIssues(currentDoc, postValidation);
  const statusAfter = postValidation.status;

  // 5. AUDITORIA ESTREITA DE RESOLUÇÃO (ANTI-ALUCINAÇÃO & ANTI-LOOP)
  for (const attempted of attemptedFixes) {
    if (!attempted.success) {
      failedFixes.push({
        fixId: attempted.fixId,
        toolName: attempted.toolName,
        issueCode: attempted.issueCode,
        targetNodeId: attempted.targetNodeId,
        reason: attempted.error || 'A ferramenta retornou falha na execução.',
      });
      continue;
    }

    const issueStillExists = issuesAfter.some(
      (iss) =>
        iss.code === attempted.issueCode &&
        (!attempted.targetNodeId || iss.affectedNodeId === attempted.targetNodeId)
    );

    if (issueStillExists) {
      failedFixes.push({
        fixId: attempted.fixId,
        toolName: attempted.toolName,
        issueCode: attempted.issueCode,
        targetNodeId: attempted.targetNodeId,
        reason: 'A ferramenta foi executada, porém a revalidação confirmou que o problema persiste.',
      });
    } else {
      appliedFixes.push({
        fixId: attempted.fixId,
        toolName: attempted.toolName,
        issueCode: attempted.issueCode,
        targetNodeId: attempted.targetNodeId,
        summary: formatAppliedFixSummary(attempted.issueCode, attempted.parameters),
      });
    }
  }

  // 6. IDENTIFICAÇÃO DE PROBLEMAS RESTANTES (MANUAL / REQUIRES_CONFIRMATION)
  const remainingManualIssues = issuesAfter.filter(
    (iss) => iss.fixClassification === 'MANUAL' || iss.fixClassification === 'REQUIRES_CONFIRMATION'
  );

  // 7. COMPOSIÇÃO DA MENSAGEM CLARA E HUMANA DE RESUMO
  const summaryMessage = buildHumanSummaryMessage({
    appliedCount: appliedFixes.length,
    failedCount: failedFixes.length,
    remainingManualCount: remainingManualIssues.length,
    statusAfter,
    appliedFixes,
    remainingManualIssues,
  });

  const overallSuccess = attemptedFixes.length === 0 || appliedFixes.length > 0;

  return {
    success: overallSuccess,
    statusBefore,
    statusAfter,
    issuesBefore,
    issuesAfter,
    plan,
    attemptedFixes,
    appliedFixes,
    failedFixes,
    remainingManualIssues,
    executedTools,
    updatedDoc: currentDoc,
    summaryMessage,
  };
}

function formatAppliedFixSummary(
  code: string,
  params: Record<string, unknown>
): string {
  switch (code) {
    case 'MISSING_CUT_CONTOUR':
      return `Faca de corte criada com offset de ${params.offset_mm ?? 2} mm (${params.joinStyle ?? 'round'}).`;
    case 'CUT_CONTOUR_MISALIGNED':
      return 'Faca de corte centralizada e alinhada ao vetor de origem.';
    default:
      return `Correção automática aplicada com sucesso (${code}).`;
  }
}

function buildHumanSummaryMessage(params: {
  appliedCount: number;
  failedCount: number;
  remainingManualCount: number;
  statusAfter: string;
  appliedFixes: AppliedFixRecord[];
  remainingManualIssues: PrepressIssue[];
}): string {
  const parts: string[] = [];

  if (params.appliedCount > 0) {
    parts.push(
      `✓ **${params.appliedCount} ${params.appliedCount === 1 ? 'problema corrigido' : 'problemas corrigidos'} automaticamente:**\n` +
        params.appliedFixes.map((f) => `- ${f.summary}`).join('\n')
    );
  } else if (params.failedCount === 0) {
    parts.push('Nenhuma correção automática e segura estava disponível para os problemas detectados.');
  }

  if (params.failedCount > 0) {
    parts.push(
      `Não consegui corrigir automaticamente ${params.failedCount} irregularidade(s) técnica(s). O arquivo continua bloqueado para corte.`
    );
  }

  if (params.remainingManualCount > 0) {
    parts.push(
      `📌 **${params.remainingManualCount} ${params.remainingManualCount === 1 ? 'item ainda requer atenção manual' : 'itens ainda requerem atenção manual'}:**\n` +
        params.remainingManualIssues
          .map((iss) => `- **${iss.message}**\n  *Recomendação:* ${iss.recommendation}`)
          .join('\n')
    );
  }

  return parts.join('\n\n');
}

