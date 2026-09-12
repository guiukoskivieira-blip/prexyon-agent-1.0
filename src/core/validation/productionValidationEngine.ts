/**
 * Production Validation Engine (v1.0 & DTF UV Etapa 2)
 *
 * Motor determinístico de análise e validação de produção gráfica do Prexyon Agent.
 * Analisa puramente o PrexyonDocument (PDM) sem efeitos colaterais nem dependências de UI/DOM.
 */

import { PrexyonDocument } from '../pdm/types';
import {
  ValidationReport,
  ValidationIssue,
  ValidationPolicy,
  DEFAULT_VALIDATION_POLICY,
  ValidationStatus,
  ValidationSeverity,
} from './types';
import { validateArtboardDimensions } from './rules/artboardRules';
import { validateNodeDimensions } from './rules/nodeDimensionRules';
import { validateLayoutBoundaries } from './rules/layoutRules';
import { validateBleed } from './rules/bleedRules';
import { validateSafetyMargin } from './rules/safetyRules';
import { validateRasterResolution } from './rules/rasterRules';
import { validateCutContours } from './rules/cutContourRules';
import { validateTechnicalGuides } from './rules/guideRules';
import { validateDtfUvTransparency } from './rules/dtfUvRules';

const SEVERITY_ORDER: Record<ValidationSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/**
 * Executa todas as regras de validação contra o documento PDM fornecido.
 *
 * @param doc Documento imutável do PDM a ser inspecionado.
 * @param policy Políticas opcionais de validação (ex: limites de DPI, perfil de produção).
 * @returns Relatório estruturado e determinístico com status consolidado e lista de issues.
 */
export function validateProductionDocument(
  doc: PrexyonDocument,
  policy: ValidationPolicy = DEFAULT_VALIDATION_POLICY
): ValidationReport {
  const allIssues: ValidationIssue[] = [
    ...validateArtboardDimensions(doc),
    ...validateNodeDimensions(doc),
    ...validateLayoutBoundaries(doc),
    ...validateBleed(doc),
    ...validateSafetyMargin(doc),
    ...validateRasterResolution(doc, policy),
    ...validateCutContours(doc, policy),
    ...validateTechnicalGuides(doc),
    ...validateDtfUvTransparency(doc, policy),
  ];

  // Ordenação determinística: Severidade (error -> warning -> info), depois ruleId, depois id
  allIssues.sort((a, b) => {
    const diffSeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (diffSeverity !== 0) return diffSeverity;
    const diffRule = a.ruleId.localeCompare(b.ruleId);
    if (diffRule !== 0) return diffRule;
    return a.id.localeCompare(b.id);
  });

  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;

  for (const issue of allIssues) {
    if (issue.severity === 'error') errorCount++;
    else if (issue.severity === 'warning') warningCount++;
    else if (issue.severity === 'info') infoCount++;
  }

  let status: ValidationStatus = 'ready';
  if (errorCount > 0) {
    status = 'blocked';
  } else if (warningCount > 0) {
    status = 'attention';
  } else {
    const graphicNodes = Object.values(doc?.nodes || {}).filter(
      (n) => n && n.type !== 'technical_guide'
    );
    if (!doc || graphicNodes.length === 0) {
      status = 'waiting_for_file';
    }
  }

    return {
    status,
    issues: allIssues,
    errorCount,
    warningCount,
    infoCount,
    checkedAt: new Date().toISOString(),
    documentId: doc.id,
  };
}

/**
 * Valida a elegibilidade e prontidão do documento especificamente para o entregável solicitado.
 *
 * Distingue o status geral do documento do formato de saída desejado:
 * - PRINT_PNG: Não exige faca de corte (V016 ignorado); exige arte gráfica e dimensões válidas.
 * - ARTWORK_SVG: Não exige faca de corte; exige arte gráfica e geometria válida.
 * - CUT_SVG: Exige faca de corte existente, fechada e sem auto-interseções.
 * - STICKER_PACKAGE: Exige arte + faca de corte válida + requisitos completos do perfil.
 * - DTF_UV_PACKAGE: Exige separações técnicas de White/Clear válidas conforme perfil.
 */
export function validateProductionDeliverable(
  doc: PrexyonDocument,
  deliverable: import('./types').ProductionDeliverableType,
  policy: ValidationPolicy = DEFAULT_VALIDATION_POLICY
): import('./types').DeliverableValidationReport {
  const baseReport = validateProductionDocument(doc, policy);
  const graphicNodes = Object.values(doc?.nodes || {}).filter(
    (n) => n && n.type !== 'technical_guide' && n.type !== 'cut_contour'
  );
  const hasGraphicNodes = graphicNodes.length > 0;
  const cutNode = Object.values(doc?.nodes || {}).find((n) => n && n.type === 'cut_contour');

  let relevantIssues: ValidationIssue[] = [];
  const blockingReasons: string[] = [];

  switch (deliverable) {
    case 'PRINT_PNG':
    case 'ARTWORK_SVG': {
      // Ignora regras que dizem respeito exclusivamente a faca de corte
      relevantIssues = baseReport.issues.filter(
        (i) =>
          !i.ruleId.startsWith('V016') &&
          !i.ruleId.startsWith('V009') &&
          !i.ruleId.startsWith('V010') &&
          !i.ruleId.startsWith('V014') &&
          !i.ruleId.startsWith('V015')
      );

      if (!hasGraphicNodes) {
        blockingReasons.push('O documento não possui elementos gráficos ou arte para exportação.');
      }
      break;
    }

    case 'CUT_SVG': {
      // Foca em regras de faca de corte e geometria
      relevantIssues = baseReport.issues.filter(
        (i) => i.category === 'cut' || i.category === 'geometry' || i.ruleId.startsWith('V001')
      );

      if (!cutNode) {
        blockingReasons.push('Nenhuma faca de corte (CutContour) encontrada no documento para exportação de corte.');
      }
      break;
    }

    case 'STICKER_PACKAGE': {
      relevantIssues = [...baseReport.issues];
      if (!cutNode) {
        blockingReasons.push('O pacote de adesivo exige uma faca de corte técnica.');
      }
      if (!hasGraphicNodes) {
        blockingReasons.push('O documento não possui arte gráfica para o pacote.');
      }
      break;
    }

    case 'DTF_UV_PACKAGE': {
      // Regras DTF UV e documento geral
      relevantIssues = baseReport.issues.filter((i) => !i.ruleId.startsWith('V016'));
      if (!hasGraphicNodes) {
        blockingReasons.push('O documento não possui arte gráfica para o pacote DTF UV.');
      }
      break;
    }

    default:
      relevantIssues = [...baseReport.issues];
  }

  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;

  for (const issue of relevantIssues) {
    if (issue.severity === 'error') {
      errorCount++;
      blockingReasons.push(issue.message);
    } else if (issue.severity === 'warning') {
      warningCount++;
    } else if (issue.severity === 'info') {
      infoCount++;
    }
  }

  const isEligible = errorCount === 0 && blockingReasons.length === 0;

  let status: ValidationStatus = 'ready';
  if (!isEligible) {
    status = 'blocked';
  } else if (warningCount > 0) {
    status = 'attention';
  }

  return {
    deliverable,
    isEligible,
    blockingReasons,
    status,
    issues: relevantIssues,
    errorCount,
    warningCount,
    infoCount,
    checkedAt: new Date().toISOString(),
    documentId: doc.id,
  };
}

