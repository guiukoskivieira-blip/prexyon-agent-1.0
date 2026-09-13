/**
 * Prexyon Agent — Production Readiness Single Source of Truth (SSOT)
 *
 * Módulo determinístico central para cálculo e governança do estado de prontidão técnica
 * para produção gráfica (Sticker, DTF UV, etc.).
 *
 * Consumido unificadamente por:
 * 1. ProductionStatusBanner (Header do Workspace)
 * 2. ProductionWorkspace
 * 3. ProductionReviewPanel & ReviewBuilder
 * 4. ResponseReconciler (Chat Agent)
 */

import { PrexyonDocument, CutContourNode } from '../pdm/types';
import { ValidationReport } from '../validation/types';
import { validateProductionDocument } from '../validation/productionValidationEngine';
import { ProposedFix } from '../autofix/proposalTypes';
import { validateCutContourIntegrity } from '../geometry/vectorPathIntegrity';

export type CanonicalReadinessStatus =
  | 'WAITING_FOR_FILE'
  | 'AWAITING_CONFIRMATION'
  | 'BLOCKED'
  | 'READY_WITH_WARNINGS'
  | 'READY';

export interface ReadinessEvaluationParams {
  doc?: PrexyonDocument | null;
  validationReport?: ValidationReport | null;
  proposedFixes?: ProposedFix[] | null;
  profileId?: string;
  hasToolFailure?: boolean;
  packageEvidence?: {
    status?: string;
    [key: string]: any;
  } | null;
}

export interface ProductionReadinessResult {
  status: CanonicalReadinessStatus;
  statusLabel: string;
  badgeLabel: string;
  variant: 'success' | 'warning' | 'danger' | 'info';
  isReady: boolean;
  isBlocked: boolean;
  isWaitingConfirmation: boolean;
  blockers: string[];
  warnings: string[];
  infoNotes: string[];
  manualActions: string[];
  pendingConfirmationsCount: number;
}

/**
 * Calcula determinística e canonicamente o estado de prontidão para produção.
 */
export function getProductionReadiness(
  params: ReadinessEvaluationParams
): ProductionReadinessResult {
  const {
    doc,
    validationReport,
    proposedFixes = [],
    profileId,
    hasToolFailure = false,
    packageEvidence,
  } = params;

  // 1. Verificação de Documento Vazio ou Sem Arte
  if (!doc) {
    return {
      status: 'WAITING_FOR_FILE',
      statusLabel: 'Aguardando Arquivo',
      badgeLabel: 'Aguardando',
      variant: 'info',
      isReady: false,
      isBlocked: false,
      isWaitingConfirmation: false,
      blockers: [],
      warnings: [],
      infoNotes: [],
      manualActions: [],
      pendingConfirmationsCount: 0,
    };
  }

  const graphicNodes = Object.values(doc.nodes || {}).filter(
    (n) => n && n.type !== 'technical_guide'
  );

  if (graphicNodes.length === 0 || validationReport?.status === 'waiting_for_file') {
    return {
      status: 'WAITING_FOR_FILE',
      statusLabel: 'Aguardando Arquivo',
      badgeLabel: 'Aguardando',
      variant: 'info',
      isReady: false,
      isBlocked: false,
      isWaitingConfirmation: false,
      blockers: [],
      warnings: [],
      infoNotes: [],
      manualActions: [],
      pendingConfirmationsCount: 0,
    };
  }

  // 2. Relatório de Validação de Pré-Impressão
  const effectiveProfileId = profileId || doc.profileId || 'generic-sticker';
  const report =
    validationReport ||
    validateProductionDocument(doc, {
      profileId: effectiveProfileId as any,
      recommendedDpi: 300,
      criticalDpi: 150,
      requireCutContour: effectiveProfileId === 'generic-sticker',
      customConfig:
        effectiveProfileId === 'dtf-uv' && packageEvidence
          ? ({
              dtfUv: {
                whitePolicy: 'REQUIRED',
              },
            } as any)
          : undefined,
    });

  const blockers: string[] = [];
  const warnings: string[] = [];
  const infoNotes: string[] = [];
  const manualActions: string[] = [];

  for (const issue of report.issues) {
    if (issue.severity === 'error') {
      if (!blockers.includes(issue.message)) blockers.push(issue.message);
      if (!issue.fixable) manualActions.push(issue.message);
    } else if (issue.severity === 'warning') {
      if (!warnings.includes(issue.message)) warnings.push(issue.message);
    } else if (issue.severity === 'info') {
      if (!infoNotes.includes(issue.message)) infoNotes.push(issue.message);
    }
  }

  // 3. Validação Estrita de Integridade Geométrica de Facas de Corte
  const cutNodes = Object.values(doc.nodes || {}).filter(
    (n) => n && n.type === 'cut_contour'
  ) as CutContourNode[];

  for (const cutNode of cutNodes) {
    const integrity = validateCutContourIntegrity(cutNode.contours || []);
    if (!integrity.isValid) {
      for (const reason of integrity.failureReasons) {
        if (!blockers.includes(reason)) blockers.push(reason);
        if (!manualActions.includes(reason)) manualActions.push(reason);
      }
    }
  }

  // 4. Verificação de Faca Obrigatória para Adesivos Convencionais
  if (effectiveProfileId === 'generic-sticker' && cutNodes.length === 0 && graphicNodes.length > 0) {
    const msg = 'O perfil de Adesivo Convencional exige uma faca de corte técnica (CutContour).';
    if (!blockers.includes(msg)) blockers.push(msg);
  }

  // 4b. Verificação de Base Branca Obrigatória para DTF UV
  if (effectiveProfileId === 'dtf-uv' && graphicNodes.length > 0 && packageEvidence) {
    const isRipControlled =
      (doc as any)?.activeProfile?.rules?.whiteUnderbasePolicy === 'RIP_CONTROLLED' ||
      (doc as any)?.activeProfile?.dtfUvConfig?.whitePolicy === 'RIP_CONTROLLED';
    if (!isRipControlled) {
      const whiteSep = doc.separations?.['WHITE'] || doc.separations?.['white'];
      const hasWhite = Boolean(
        whiteSep && (whiteSep.status === 'GENERATED' || (whiteSep as any).valid || whiteSep.maskDataUrl)
      );
      if (!hasWhite) {
        const msg = 'O perfil de produção DTF UV exige a preparação da camada de Base Branca (White Underbase).';
        if (!blockers.includes(msg)) blockers.push(msg);
        if (!manualActions.includes(msg)) manualActions.push(msg);
      }
    }
  }

  // 5. Falha de Execução de Ferramentas ou Bloqueio de Pacote
  if (hasToolFailure) {
    const msg = 'Houve falha na execução de uma ou mais etapas operacionais.';
    if (!blockers.includes(msg)) blockers.push(msg);
  }

  if (packageEvidence && packageEvidence.status === 'BLOCKED') {
    const msg = 'O pacote de produção gerado está com status bloqueado.';
    if (!blockers.includes(msg)) blockers.push(msg);
  }

  // 6. Propostas Pendentes de Confirmação
  const pendingFixes = (proposedFixes || []).filter(
    (p) =>
      p.status === 'PENDING' ||
      (p.status as any) === 'proposed' ||
      p.status === undefined ||
      (p as any).needsConfirmation
  );
  const pendingConfirmationsCount = pendingFixes.length;

  // 7. Resolução de Estado Canônico
  let status: CanonicalReadinessStatus = 'READY';
  let statusLabel = 'Pronto para Produção';
  let badgeLabel = 'Liberado';
  let variant: 'success' | 'warning' | 'danger' | 'info' = 'success';

  if (blockers.length > 0) {
    status = 'BLOCKED';
    statusLabel = 'Produção Bloqueada';
    badgeLabel = 'Bloqueado';
    variant = 'danger';
  } else if (pendingConfirmationsCount > 0) {
    status = 'AWAITING_CONFIRMATION';
    statusLabel = 'Aguardando Confirmação';
    badgeLabel = 'Aprovação';
    variant = 'info';
  } else if (warnings.length > 0) {
    status = 'READY_WITH_WARNINGS';
    statusLabel = 'Pronto com Avisos';
    badgeLabel = 'Avisos';
    variant = 'warning';
  } else {
    status = 'READY';
    statusLabel = 'Pronto para Produção';
    badgeLabel = 'Liberado';
    variant = 'success';
  }

  return {
    status,
    statusLabel,
    badgeLabel,
    variant,
    isReady: status === 'READY' || status === 'READY_WITH_WARNINGS',
    isBlocked: status === 'BLOCKED',
    isWaitingConfirmation: status === 'AWAITING_CONFIRMATION',
    blockers,
    warnings,
    infoNotes,
    manualActions,
    pendingConfirmationsCount,
  };
}
