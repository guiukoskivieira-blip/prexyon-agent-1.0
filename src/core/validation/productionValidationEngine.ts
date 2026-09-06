/**
 * Production Validation Engine (v1.0)
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

const SEVERITY_ORDER: Record<ValidationSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/**
 * Executa todas as regras de validação contra o documento PDM fornecido.
 *
 * @param doc Documento imutável do PDM a ser inspecionado.
 * @param policy Políticas opcionais de validação (ex: limites de DPI).
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
    ...validateCutContours(doc),
    ...validateTechnicalGuides(doc),
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
