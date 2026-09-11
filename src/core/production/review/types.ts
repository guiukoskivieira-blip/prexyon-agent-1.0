/**
 * Prexyon Agent — Production Review Types (Etapa 6.8)
 *
 * Modelo de dados tipado para recibos de execução, evidência técnica,
 * resumo de alterações e estado do painel de Production Review.
 */

import { PackageStatus } from '../package/types';
import { ProposedFix } from '../../autofix/proposalTypes';
import { PreflightPlan } from '../../autofix/preflightPlanTypes';

export type ReviewStatus = 'READY' | 'READY_WITH_WARNINGS' | 'BLOCKED' | 'INFO';

export interface ToolExecutionReceipt {
  /** Identificador único do recibo */
  id: string;
  /** Nome da ferramenta executada */
  toolName: string;
  /** Timestamp da execução */
  timestamp: number;
  /** Status da execução */
  status: 'success' | 'failure' | 'warning';
  /** Título amigável da operação */
  title: string;
  /** Resumo operacional em linguagem clara */
  summary: string;
  /** IDs dos nós afetados */
  affectedNodeIds: string[];
  /** Nomes legíveis dos nós afetados */
  affectedNodeNames: string[];
  /** Parâmetros operacionais relevantes */
  parameters: Record<string, unknown>;
  /** Dados estruturados retornados */
  resultData?: Record<string, unknown>;
  /** Avisos operacionais */
  warnings?: string[];
  /** Erro estruturado se houver falha */
  error?: {
    code: string;
    message: string;
  };
  /** Evidências técnicas extraídas */
  evidence?: {
    dimensions_mm?: { width_mm: number; height_mm: number };
    offset_mm?: number;
    contoursCount?: number;
    artifactsCount?: number;
    packageStatus?: string;
  };
}

export interface ReviewOperationStep {
  order: number;
  name: string;
  description: string;
  status: 'success' | 'warning' | 'error';
  details?: string;
}

export interface ReviewAffectedNode {
  id: string;
  name: string;
  type: string;
  changeType: 'created' | 'modified' | 'deleted' | 'inspected';
  details?: string;
}

export interface BeforeAfterSummary {
  beforeNodesCount: number;
  afterNodesCount: number;
  addedNodes: string[];
  modifiedNodes: string[];
  deletedNodes: string[];
}

export interface CutContourEvidence {
  present: boolean;
  nodeId: string;
  nodeName: string;
  offset_mm: number;
  joinStyle: string;
  contoursCount: number;
  strokeWidth_mm: number;
  sourceNodeId?: string;
  sourceNodeName?: string;
}

export interface PackageEvidence {
  profileId: string;
  profileName: string;
  status: PackageStatus;
  artifacts: {
    fileName: string;
    format: string;
    mimeType: string;
    description: string;
    blob?: Blob;
  }[];
  zipArtifact?: {
    fileName: string;
    mimeType: string;
    size_bytes?: number;
    blob?: Blob;
  };
}

export interface ValidationIssueReview {
  title: string;
  message: string;
  affectedNodeId?: string;
  suggestedAction?: string;
}

export interface AutoFixReviewItem {
  code: string;
  status: 'fixed' | 'pending_manual' | 'requires_confirmation' | 'failed';
  title: string;
  message: string;
  recommendation?: string;
}

export interface AutoFixSummaryReview {
  appliedCount: number;
  pendingCount: number;
  failedCount: number;
  items: AutoFixReviewItem[];
}

export interface ProductionReviewModel {
  /** ID do relatório de revisão */
  id: string;
  /** Timestamp da criação */
  timestamp: number;
  /** Título principal da revisão */
  title: string;
  /** Status consolidado */
  status: ReviewStatus;
  /** Rótulo amigável em português (ex: "Pronto para produção") */
  statusLabel: string;
  /** Variante visual de status */
  statusVariant: 'success' | 'warning' | 'danger' | 'info';
  /** Resumo geral das ações realizadas */
  summary: string;
  /** Passos da operação (para operações simples ou compostas) */
  operations: ReviewOperationStep[];
  /** Nós alterados ou criados */
  affectedNodes: ReviewAffectedNode[];
  /** Comparativo estrutural antes e depois */
  beforeAfter: BeforeAfterSummary;
  /** Evidência específica da faca de corte */
  cutContourEvidence?: CutContourEvidence;
  /** Evidência específica do pacote de produção gerado */
  packageEvidence?: PackageEvidence;
  /** Resumo estruturado de Safe Auto-Fix (quando aplicável) */
  autoFixSummary?: AutoFixSummaryReview;
  /** Propostas de correções assistidas que exigem confirmação (REQUIRES_CONFIRMATION) */
  proposedFixes?: ProposedFix[];
  /** Plano determinístico de preparação para produção (PreflightPlan) */
  preflightPlan?: PreflightPlan;
  /** Auditoria de validação */
  validation: {
    status: PackageStatus;
    blockers: ValidationIssueReview[];
    warnings: ValidationIssueReview[];
  };
  /** Recibos detalhados de cada ferramenta */
  receipts: ToolExecutionReceipt[];
  /** Indica se a operação foi desfeita no histórico de Undo */
  isUndone?: boolean;
  /** ID do documento PDM associado */
  docId: string;
  /** Versão do documento */
  docVersion: string | number;
}
