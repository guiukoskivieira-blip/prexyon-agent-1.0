/**
 * Prexyon Agent — Preflight Plan Types (Etapa 6.11)
 *
 * Modelo de dados tipado para o planejador determinístico de pré-impressão,
 * dependências entre correções, execução parcial, replanejamento e rastreamento de progresso.
 */

import { ValidationStatus, ValidationSeverity } from '../validation/types';
import { PrepressIssue, FixClassification } from './types';
import { ProposedFix } from './proposalTypes';
import { ToolExecutionReceipt } from '../production/review/types';

/**
 * Status individual de cada etapa do plano de pré-impressão.
 */
export type PreflightStepStatus =
  | 'PENDING'               // Aguardando processamento
  | 'READY'                 // Pré-requisitos atendidos, pronta para execução automática
  | 'WAITING_CONFIRMATION'  // Requer confirmação explícita do operador
  | 'BLOCKED'               // Bloqueada por dependência não concluída
  | 'EXECUTING'             // Em execução
  | 'COMPLETED'             // Executada com sucesso e confirmada pela revalidação
  | 'FAILED'                // Falha na execução da ferramenta
  | 'SKIPPED'               // Rejeitada pelo operador ou pulada
  | 'STALE';                // Obsoleta devido a alteração externa no documento

/**
 * Estado geral de prontidão do plano de preparação.
 */
export type PreflightPlanState =
  | 'PLANNING'                // Em fase inicial de planejamento
  | 'PARTIALLY_EXECUTED'      // Etapas automáticas executadas, pendências restantes
  | 'AWAITING_CONFIRMATION'   // Bloqueado aguardando decisão humana em uma ou mais propostas
  | 'READY_FOR_PRODUCTION'    // Todas as etapas necessárias concluídas com sucesso
  | 'BLOCKED';                // Impossibilitado de avançar devido a bloqueios críticos ou falhas

/**
 * Registro explícito de dependência entre duas etapas do plano.
 */
export interface PreflightDependency {
  stepId: string;
  dependsOnStepId: string;
  reason: string;
}

/**
 * Etapa individual e estruturada do plano de preparação.
 */
export interface PreflightPlanStep {
  /** Identificador único determinístico do step */
  id: string;

  /** ID da issue de origem que gerou este step */
  issueId: string;

  /** Código da issue tratada */
  issueCode: string;

  /** Ordem topológica de execução (1, 2, 3...) */
  order: number;

  /** Título claro e compreensível para operador leigo */
  title: string;

  /** Descrição detalhada da ação */
  description: string;

  /** Classificação de segurança (AUTO_FIXABLE, REQUIRES_CONFIRMATION, MANUAL, INFORMATIONAL) */
  classification: FixClassification;

  /** Nível de severidade original */
  severity: ValidationSeverity;

  /** IDs dos nós do PDM envolvidos */
  targetNodeIds: string[];

  /** Nomes legíveis dos nós envolvidos */
  targetNodeNames?: string[];

  /** Nome da ferramenta determinística a ser invocada (quando houver) */
  tool?: string;

  /** Parâmetros seguros para a ferramenta */
  parameters?: Record<string, unknown>;

  /** ID da proposta assistida associada (se REQUIRES_CONFIRMATION) */
  proposedFixId?: string;

  /** Dados completos da proposta assistida (se aplicável) */
  proposedFix?: ProposedFix;

  /** IDs dos steps que precisam ser concluídos ANTES deste */
  dependsOn: string[];

  /** IDs dos steps que dependem da conclusão deste */
  blocks: string[];

  /** Explicação em linguagem natural sobre o bloqueio/dependência */
  dependencyExplanation?: string;

  /** Status atual do step */
  status: PreflightStepStatus;

  /** Evidências técnicas coletadas */
  evidence?: Record<string, unknown>;

  /** Recomendação operacional (especialmente para MANUAL) */
  recommendation?: string;

  /** Resultado da execução (quando já executado) */
  result?: {
    success: boolean;
    message: string;
    receipt?: ToolExecutionReceipt;
    error?: string;
    resolvedIndirectly?: boolean;
  };
}

/**
 * Métricas de progresso real do plano de preparação.
 */
export interface PreflightProgress {
  total: number;
  completed: number;
  waitingConfirmation: number;
  manual: number;
  blocked: number;
  failed: number;
  skipped: number;
  summaryText: string;
}

/**
 * Plano completo de preparação para produção (PreflightPlan).
 */
export interface PreflightPlan {
  /** Identificador único do plano */
  id: string;

  /** Fingerprint de revisão do documento associado */
  documentRevision: string;

  /** Timestamp de criação */
  createdAt: number;

  /** Timestamp da última atualização */
  updatedAt: number;

  /** Status de validação antes da aplicação do plano */
  initialStatus: ValidationStatus;

  /** Status provável estimado após a execução das etapas possíveis */
  estimatedFinalStatus: ValidationStatus;

  /** Lista consolidada e normalizada de issues tratadas */
  issues: PrepressIssue[];

  /** Lista ordenada de todos os steps do plano */
  steps: PreflightPlanStep[];

  /** Relações explícitas de dependência */
  dependencies: PreflightDependency[];

  /** Steps que podem ser executados automaticamente de forma segura */
  automaticSteps: PreflightPlanStep[];

  /** Steps que exigem confirmação do operador */
  confirmationSteps: PreflightPlanStep[];

  /** Steps que exigem ação manual do operador */
  manualSteps: PreflightPlanStep[];

  /** Steps bloqueados por dependências incompletas */
  blockedSteps: PreflightPlanStep[];

  /** Progresso quantitativo e qualitativo */
  progress: PreflightProgress;

  /** Estado atual de governança do plano */
  currentState: PreflightPlanState;
}

/**
 * Resultado auditável da execução de etapas do plano de preparação.
 */
export interface PreflightExecutionResult {
  success: boolean;
  plan: PreflightPlan;
  executedSteps: PreflightPlanStep[];
  receipts: ToolExecutionReceipt[];
  summaryMessage: string;
}
