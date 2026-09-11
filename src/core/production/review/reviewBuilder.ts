/**
 * Prexyon Agent — Production Review Model Builder (Etapa 6.8)
 *
 * Compila recibos reais de execução, alterações de PDM, evidências geométricas da faca,
 * manifesto, pacote e auditoria de validação em um modelo unificado de Production Review.
 * 
 * Regra Arquitetural: O chat NÃO é a fonte da verdade; o modelo de revisão é construído
 * estritamente a partir de dados determinísticos de PDM e ToolResults.
 */

import { ExecutedToolRecord } from '../../agent/types';
import { PrexyonDocument, CutContourNode } from '../../pdm/types';
import {
  ProductionReviewModel,
  ReviewStatus,
  ReviewOperationStep,
  ReviewAffectedNode,
  BeforeAfterSummary,
  CutContourEvidence,
  PackageEvidence,
  ValidationIssueReview,
} from './types';
import { buildToolExecutionReceipt } from './receiptBuilder';
import { validateDocumentForPackage } from '../package/packageValidator';
import { GENERIC_STICKER_PROFILE } from '../profile/genericStickerProfile';
import { generateProposedFixes, defaultProposalManager } from '../../autofix';

export interface BuildReviewParams {
  executedTools: ExecutedToolRecord[];
  beforeDoc: PrexyonDocument;
  afterDoc: PrexyonDocument;
  customTitle?: string;
}

export function buildProductionReview({
  executedTools,
  beforeDoc,
  afterDoc,
  customTitle,
}: BuildReviewParams): ProductionReviewModel {
  const timestamp = Date.now();
  const reviewId = `rev_${afterDoc.id}_${timestamp}_${Math.random().toString(36).substring(2, 6)}`;

  // 1. Recibos individuais de cada ferramenta executada
  const receipts = executedTools.map((record) =>
    buildToolExecutionReceipt(record, beforeDoc, afterDoc)
  );

  // 2. Passos do processo operacional (operações simples ou compostas)
  const operations: ReviewOperationStep[] = receipts.map((r, idx) => ({
    order: idx + 1,
    name: r.title,
    description: r.summary,
    status: r.status === 'failure' ? 'error' : r.status === 'warning' ? 'warning' : 'success',
    details: r.error ? `Erro: ${r.error.message}` : undefined,
  }));

  // 3. Comparativo estrutural Antes e Depois (PDM Diff)
  const beforeNodes = beforeDoc.nodes || {};
  const afterNodes = afterDoc.nodes || {};

  const beforeIds = Object.keys(beforeNodes);
  const afterIds = Object.keys(afterNodes);

  const addedIds = afterIds.filter((id) => !beforeNodes[id]);
  const deletedIds = beforeIds.filter((id) => !afterNodes[id]);
  const modifiedIds = afterIds.filter((id) => {
    if (!beforeNodes[id]) return false;
    const b = beforeNodes[id] as any;
    const a = afterNodes[id] as any;
    return (
      b.position_mm?.x !== a.position_mm?.x ||
      b.position_mm?.y !== a.position_mm?.y ||
      b.physicalWidth_mm !== a.physicalWidth_mm ||
      b.physicalHeight_mm !== a.physicalHeight_mm ||
      b.offset_mm !== a.offset_mm
    );
  });

  const beforeAfter: BeforeAfterSummary = {
    beforeNodesCount: beforeIds.length,
    afterNodesCount: afterIds.length,
    addedNodes: addedIds.map((id) => afterNodes[id]?.name || id),
    modifiedNodes: modifiedIds.map((id) => afterNodes[id]?.name || id),
    deletedNodes: deletedIds.map((id) => beforeNodes[id]?.name || id),
  };

  // 4. Lista consolidada de nós afetados
  const affectedNodes: ReviewAffectedNode[] = [];

  for (const id of addedIds) {
    const node = afterNodes[id];
    if (node) {
      affectedNodes.push({
        id: node.id,
        name: node.name || node.id,
        type: node.type,
        changeType: 'created',
        details: node.type === 'cut_contour' ? `Faca de corte (${(node as any).offset_mm ?? 2} mm)` : 'Elemento criado',
      });
    }
  }

  for (const id of modifiedIds) {
    const node = afterNodes[id];
    if (node) {
      affectedNodes.push({
        id: node.id,
        name: node.name || node.id,
        type: node.type,
        changeType: 'modified',
        details: 'Geometria ou posição atualizada',
      });
    }
  }

  for (const id of deletedIds) {
    const node = beforeNodes[id];
    if (node) {
      affectedNodes.push({
        id: node.id,
        name: node.name || node.id,
        type: node.type,
        changeType: 'deleted',
        details: 'Elemento removido do documento',
      });
    }
  }

  // 5. Evidência técnica da Faca de Corte
  let cutContourEvidence: CutContourEvidence | undefined;
  const cutNode = Object.values(afterNodes).find(
    (n): n is CutContourNode => n.type === 'cut_contour'
  );

  if (cutNode) {
    const sourceNode = cutNode.sourceNodeId ? afterNodes[cutNode.sourceNodeId] : undefined;
    cutContourEvidence = {
      present: true,
      nodeId: cutNode.id,
      nodeName: cutNode.name || 'Faca de Corte',
      offset_mm: cutNode.offset_mm,
      joinStyle: cutNode.joinStyle,
      contoursCount: Array.isArray(cutNode.contours) ? cutNode.contours.length : 1,
      strokeWidth_mm: cutNode.strokeWidth_mm,
      sourceNodeId: cutNode.sourceNodeId,
      sourceNodeName: sourceNode?.name || cutNode.sourceNodeId,
    };
  }

  // 6. Evidência do Pacote de Produção
  let packageEvidence: PackageEvidence | undefined;
  const pkgReceipt = receipts.find((r) => r.toolName === 'create_production_package' && r.status !== 'failure');

  if (pkgReceipt && pkgReceipt.resultData) {
    const pkg = pkgReceipt.resultData as any;
    packageEvidence = {
      profileId: pkg.profile?.id || 'generic-sticker',
      profileName: pkg.profile?.name || 'Perfil Genérico de Adesivos',
      status: pkg.status || 'READY',
      artifacts: Array.isArray(pkg.artifacts)
        ? pkg.artifacts.map((a: any) => ({
            fileName: a.fileName,
            format: a.format,
            mimeType: a.mimeType,
            description: a.description,
            blob: a.blob,
          }))
        : [],
      zipArtifact: pkg.zipArtifact
        ? {
            fileName: pkg.zipArtifact.fileName,
            mimeType: pkg.zipArtifact.mimeType,
            size_bytes: pkg.zipArtifact.size_bytes,
            blob: pkg.zipArtifact.blob,
          }
        : undefined,
    };
  }

  // 7. Auditoria de Validação Determinística
  const validationReport = validateDocumentForPackage(afterDoc, GENERIC_STICKER_PROFILE);

  const blockers: ValidationIssueReview[] = validationReport.blockers.map((msg) => ({
    title: 'Bloqueio Crítico de Produção',
    message: msg,
    suggestedAction: msg.includes('Faca de corte')
      ? 'Gere a faca de corte externa para este adesivo antes de liberar a produção.'
      : 'Corrija as inconsistências nas dimensões ou arte do documento.',
  }));

  const warnings: ValidationIssueReview[] = validationReport.warnings.map((msg) => ({
    title: 'Aviso Técnico',
    message: msg,
    suggestedAction: msg.includes('DPI')
      ? 'A imagem pode perder nitidez na impressão final. Se possível, utilize uma imagem com resolução de 300 DPI.'
      : 'Verifique se a arte cobre a sangria para evitar bordas brancas após o corte.',
  }));

  // 8. Resumo de Auto-Fix (quando auto_fix_prepress_issues ou fixes foram acionados)
  let autoFixSummary: ProductionReviewModel['autoFixSummary'];
  const autoFixReceipt = receipts.find((r) => r.toolName === 'auto_fix_prepress_issues');

  if (autoFixReceipt && autoFixReceipt.resultData) {
    const data = autoFixReceipt.resultData as any;
    const items: ProductionReviewModel['autoFixSummary'] extends { items: infer T } ? T : any = [];

    if (Array.isArray(data.appliedFixes)) {
      for (const applied of data.appliedFixes) {
        items.push({
          code: applied.issueCode,
          status: 'fixed',
          title: 'Corrigido Automaticamente',
          message: applied.summary,
        });
      }
    }

    if (Array.isArray(data.failedFixes)) {
      for (const failed of data.failedFixes) {
        items.push({
          code: failed.issueCode,
          status: 'failed',
          title: 'Falha na Correção',
          message: failed.reason,
        });
      }
    }

    if (Array.isArray(data.remainingManualIssues)) {
      for (const iss of data.remainingManualIssues) {
        items.push({
          code: iss.code,
          status: iss.fixClassification === 'REQUIRES_CONFIRMATION' ? 'requires_confirmation' : 'pending_manual',
          title: iss.fixClassification === 'REQUIRES_CONFIRMATION' ? 'Confirmação Necessária' : 'Ação Manual Necessária',
          message: iss.message,
          recommendation: iss.recommendation,
        });
      }
    }

    autoFixSummary = {
      appliedCount: data.appliedFixes?.length ?? 0,
      pendingCount: data.remainingManualIssues?.length ?? 0,
      failedCount: data.failedFixes?.length ?? 0,
      items,
    };
  }

  // 9. Geração e Registro de Propostas Assistidas (REQUIRES_CONFIRMATION)
  const proposedFixes = generateProposedFixes(afterDoc);
  defaultProposalManager.registerProposals(proposedFixes);

  // 10. Cálculo Consolidado de Status
  let status: ReviewStatus = 'READY';
  let statusLabel = 'Pronto para produção';
  let statusVariant: ProductionReviewModel['statusVariant'] = 'success';

  const hasToolFailure = receipts.some((r) => r.status === 'failure');

  if (blockers.length > 0 || hasToolFailure || packageEvidence?.status === 'BLOCKED') {
    status = 'BLOCKED';
    statusLabel = 'Correção necessária';
    statusVariant = 'danger';
  } else if (warnings.length > 0 || packageEvidence?.status === 'READY_WITH_WARNINGS') {
    status = 'READY_WITH_WARNINGS';
    statusLabel = 'Pronto com avisos';
    statusVariant = 'warning';
  } else if (receipts.length === 0) {
    status = 'INFO';
    statusLabel = 'Revisão do documento';
    statusVariant = 'info';
  }

  // 11. Resumo Geral
  let summary = 'Operação analisada com sucesso.';
  if (autoFixSummary && autoFixSummary.appliedCount > 0) {
    summary = `${autoFixSummary.appliedCount} problema(s) corrigido(s) automaticamente de forma segura.`;
  } else if (packageEvidence && cutContourEvidence) {
    summary = `Adesivo preparado com faca de corte (${cutContourEvidence.offset_mm} mm) e pacote final consolidado.`;
  } else if (cutContourEvidence) {
    summary = `Faca de corte técnica (${cutContourEvidence.offset_mm} mm) gerada e vinculada à arte.`;
  } else if (hasToolFailure) {
    summary = 'A operação solicitada não pôde ser concluída e requer atenção.';
  }

  return {
    id: reviewId,
    timestamp,
    title: customTitle || 'Revisão de Produção — Prexyon Agent',
    status,
    statusLabel,
    statusVariant,
    summary,
    operations,
    affectedNodes,
    beforeAfter,
    cutContourEvidence,
    packageEvidence,
    autoFixSummary,
    proposedFixes,
    validation: {
      status: validationReport.status,
      blockers,
      warnings,
    },
    receipts,
    docId: afterDoc.id,
    docVersion: afterDoc.version,
  };
}
