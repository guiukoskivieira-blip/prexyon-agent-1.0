import { PrexyonDocument, TechnicalGuideNode } from '../../pdm/types';
import { ValidationIssue } from '../types';

/**
 * REGRAS V012 e V013 — VALIDAÇÃO E RESUMO DE GUIAS TÉCNICAS
 */
export function validateTechnicalGuides(doc: PrexyonDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { width_mm, height_mm } = doc.dimensions;

  const roleCounts: Record<string, number> = {
    fold: 0,
    crease: 0,
    cut_reference: 0,
    alignment: 0,
    generic: 0,
  };

  let totalGuides = 0;

  for (const nodeId of doc.rootNodeIds) {
    const node = doc.nodes[nodeId];
    if (!node || node.type !== 'technical_guide') continue;

    const guide = node as TechnicalGuideNode;
    totalGuides++;
    roleCounts[guide.guideRole] = (roleCounts[guide.guideRole] || 0) + 1;

    // REGRA V012 — Guia fora dos limites da prancheta
    const maxBound = guide.orientation === 'vertical' ? width_mm : height_mm;
    const isOutOfBounds =
      typeof guide.guidePosition_mm !== 'number' ||
      !Number.isFinite(guide.guidePosition_mm) ||
      guide.guidePosition_mm < 0 ||
      guide.guidePosition_mm > maxBound;

    if (isOutOfBounds) {
      issues.push({
        id: `V012:${guide.id}:out_of_bounds`,
        ruleId: 'V012_GUIDE_OUT_OF_BOUNDS',
        severity: 'warning',
        category: 'guides',
        title: 'Guia Técnica Fora dos Limites',
        message: `A ${guide.name} (${guide.guidePosition_mm} mm) está posicionada fora da dimensão máxima da prancheta (${maxBound} mm).`,
        nodeId: guide.id,
        data: {
          guidePosition_mm: guide.guidePosition_mm,
          orientation: guide.orientation,
          maxBound_mm: maxBound,
        },
        fixable: false,
        suggestedAction: 'Reposicione a guia técnica dentro dos limites da prancheta.',
      });
    }
  }

  // REGRA V013 — Resumo agrupado de guias técnicas de produção
  const productionParts: string[] = [];
  if (roleCounts.fold > 0) {
    productionParts.push(`${roleCounts.fold} ${roleCounts.fold === 1 ? 'linha de dobra' : 'linhas de dobra'}`);
  }
  if (roleCounts.crease > 0) {
    productionParts.push(`${roleCounts.crease} ${roleCounts.crease === 1 ? 'linha de vinco' : 'linhas de vinco'}`);
  }
  if (roleCounts.cut_reference > 0) {
    productionParts.push(`${roleCounts.cut_reference} ${roleCounts.cut_reference === 1 ? 'referência de corte' : 'referências de corte'}`);
  }

  if (productionParts.length > 0) {
    issues.push({
      id: 'V013:doc:guides_production_summary',
      ruleId: 'V013_GUIDES_SUMMARY',
      severity: 'info',
      category: 'guides',
      title: 'Linhas Técnicas de Produção',
      message: `Documento possui ${productionParts.join(', ')}.`,
      data: {
        totalGuides,
        roleCounts,
      },
      fixable: false,
    });
  }

  return issues;
}
