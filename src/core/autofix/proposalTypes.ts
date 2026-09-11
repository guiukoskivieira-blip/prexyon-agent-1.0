/**
 * Prexyon Agent — Assisted Corrections & Proposals Types (Etapa 6.10)
 *
 * Tipagens rigorosas para propostas de correção assistida que exigem confirmação
 * explícita do operador antes de qualquer mutação no documento (REQUIRES_CONFIRMATION).
 */

import { PrepressIssueCode } from './types';

/**
 * Estados do ciclo de vida de uma proposta de correção assistida.
 */
export type ProposalStatus =
  | 'PENDING'   // Proposta gerada, aguardando decisão do operador
  | 'ACCEPTED'  // Operador confirmou a aplicação
  | 'REJECTED'  // Operador optou por manter como está
  | 'EXECUTED'  // Ferramenta real executada e revalidada com sucesso
  | 'FAILED'    // Tentativa de execução falhou na ferramenta ou na revalidação
  | 'STALE';    // Documento foi alterado após a criação da proposta, tornando-a obsoleta

/**
 * Métricas calculadas de impacto antes vs depois.
 */
export interface ProposalExpectedImpact {
  /** Dimensões físicas antes da alteração */
  dimensionsBefore?: { width_mm: number; height_mm: number };
  /** Dimensões físicas estimadas após a alteração */
  dimensionsAfter?: { width_mm: number; height_mm: number };
  /** Posição antes da alteração */
  positionBefore?: { x: number; y: number };
  /** Posição prevista após a alteração */
  positionAfter?: { x: number; y: number };
  /** Resolução efetiva calculada antes */
  dpiBefore?: number;
  /** Resolução efetiva matemática calculada depois */
  dpiAfter?: number;
  /** Quantidade de objetos impactados */
  affectedObjectsCount: number;
  /** Se a arte visual impressa terá escala alterada */
  visualArtChanges: boolean;
  /** Se a geometria técnica de corte/guias será alterada */
  technicalGeometryChanges: boolean;
  /** Resumo claro do impacto em português */
  summary: string;
}

/**
 * Dados geométricos para preview sem mutação do PDM (overlay visual / ghost box).
 */
export interface ProposalPreviewData {
  type: 'bounds_overlay' | 'geometry_shift';
  currentBounds_mm: { x: number; y: number; width_mm: number; height_mm: number };
  proposedBounds_mm: { x: number; y: number; width_mm: number; height_mm: number };
}

/**
 * Modelo completo de proposta de correção assistida.
 */
export interface ProposedFix {
  /** Identificador único determinístico da proposta */
  id: string;

  /** ID da issue de pré-impressão de origem */
  issueId: string;

  /** Código canônico do problema */
  issueCode: PrepressIssueCode;

  /** ID do nó alvo a ser modificado */
  targetNodeId: string;

  /** Nome amigável do nó alvo */
  targetNodeName: string;

  /** Título conciso da proposta */
  title: string;

  /** Descrição clara da alteração para o operador */
  description: string;

  /** Motivo técnico pelo qual a proposta foi gerada */
  reason: string;

  /** Nome da ferramenta real a ser acionada após confirmação */
  toolName: string;

  /** Parâmetros exatos e validados a serem passados para a ferramenta */
  proposedParams: Record<string, unknown>;

  /** Análise matemática e técnica de impacto */
  expectedImpact: ProposalExpectedImpact;

  /** Dados para renderização do preview em overlay */
  previewData: ProposalPreviewData;

  /** Riscos ou ressalvas da alteração */
  risks: string[];

  /** Se a alteração é 100% reversível via Undo */
  reversible: boolean;

  /** Sempre true para correções assistidas */
  requiresConfirmation: true;

  /** Estado atual no ciclo de vida */
  status: ProposalStatus;

  /** Fingerprint / versão do documento para detecção de STALE */
  docVersionFingerprint: string | number;

  /** Timestamp de criação da proposta */
  createdAt: number;

  /** Timestamp de execução (quando aceita) */
  executedAt?: number;
}
