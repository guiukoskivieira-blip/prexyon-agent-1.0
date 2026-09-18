/**
 * Prexyon Agent — Pending Action Invalidation Rules (ETAPA 8.31.1)
 *
 * Garante que ações pendentes não sejam executadas em contexto inválido,
 * outro documento ou após tempo excessivo de inatividade.
 */

import { PrexyonDocument } from '../../pdm/types';
import { PendingAction } from './types';

// Timeout de expiração de uma ação pendente: 10 minutos (600.000ms)
export const PENDING_ACTION_EXPIRATION_MS = 10 * 60 * 1000;

export interface InvalidationResult {
  valid: boolean;
  reason?: string;
}

export function validatePendingActionState(
  pendingAction: PendingAction | null | undefined,
  currentDoc: PrexyonDocument
): InvalidationResult {
  if (!pendingAction) {
    return { valid: false, reason: 'Nenhuma ação pendente fornecida.' };
  }

  // 1. Invalidação por divergência de documento
  if (!currentDoc || !currentDoc.id || pendingAction.documentId !== currentDoc.id) {
    return {
      valid: false,
      reason: `Ação pendente pertencia ao documento "${pendingAction.documentId}", mas o documento atual é "${currentDoc?.id}".`,
    };
  }

  // 2. Invalidação por tempo decorrido
  const elapsed = Date.now() - pendingAction.createdAt;
  if (elapsed > PENDING_ACTION_EXPIRATION_MS) {
    return {
      valid: false,
      reason: `Ação pendente expirou por inatividade (${Math.round(elapsed / 1000)}s decorridos).`,
    };
  }

  // 3. Invalidação por exclusão dos nós alvos referenciados em resolvedArgs
  if (pendingAction.resolvedArgs?.nodeIds && Array.isArray(pendingAction.resolvedArgs.nodeIds)) {
    const existingNodeIds = new Set(Object.keys(currentDoc.nodes || {}));
    const missingNodes = pendingAction.resolvedArgs.nodeIds.filter((id: string) => !existingNodeIds.has(id));
    if (missingNodes.length > 0) {
      return {
        valid: false,
        reason: `Os nós alvos da ação pendente foram modificados ou removidos do documento (${missingNodes.join(', ')}).`,
      };
    }
  }

  return { valid: true };
}
