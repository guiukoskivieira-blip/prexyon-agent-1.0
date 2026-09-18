/**
 * Prexyon Agent — Clarification & Parameter Resolution Types (ETAPA 8.31.1)
 *
 * Contratos tipados para detecção de parâmetros ausentes, ambiguidades críticas,
 * geração estruturada de ASK_USER e continuação conversacional via PendingAction.
 */

import { PrexyonDocument } from '../../pdm/types';

export type ParameterResolutionStatus =
  | 'COMPLETE'
  | 'USE_DEFAULT'
  | 'ASK_USER'
  | 'UNSUPPORTED';

export interface PendingAction {
  id: string;
  intent: string;
  tool: string;
  resolvedArgs: Record<string, any>;
  missingArgs: string[];
  clarificationQuestion: string;
  documentId: string;
  documentNodeCount: number;
  createdAt: number;
}

export interface ParameterResolutionResult {
  status: ParameterResolutionStatus;
  tool: string;
  resolvedArgs: Record<string, any>;
  missingArgs: string[];
  question?: string;
  pendingAction?: PendingAction | null;
  unsupportedReason?: string;
}

export interface ResolutionContext {
  doc: PrexyonDocument;
  selectedNodeId?: string | null;
  selectedNodeIds?: string[];
  pendingAction?: PendingAction | null;
}
