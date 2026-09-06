import { PrexyonDocument } from '../../pdm/types';
import { ValidationIssue } from '../types';

/**
 * REGRA V001 — DIMENSÕES DA PRANCHETA (ARTBOARD)
 * Valida se width_mm e height_mm são finitos, maiores que zero e não-NaN.
 */
export function validateArtboardDimensions(doc: PrexyonDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { width_mm, height_mm } = doc.dimensions;

  const isWidthValid = typeof width_mm === 'number' && Number.isFinite(width_mm) && width_mm > 0;
  const isHeightValid = typeof height_mm === 'number' && Number.isFinite(height_mm) && height_mm > 0;

  if (!isWidthValid || !isHeightValid) {
    issues.push({
      id: 'V001:doc:artboard_dimensions',
      ruleId: 'V001_ARTBOARD_INVALID_DIMENSIONS',
      severity: 'error',
      category: 'document',
      title: 'Dimensões da Prancheta Inválidas',
      message: `A prancheta possui dimensões inválidas (${width_mm} × ${height_mm} mm). Devem ser números positivos finitos.`,
      data: { width_mm, height_mm },
      fixable: false,
      suggestedAction: 'Ajuste a largura e altura da prancheta no painel de propriedades.',
    });
  }

  return issues;
}
