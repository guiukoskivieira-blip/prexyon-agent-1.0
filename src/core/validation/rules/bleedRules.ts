import { PrexyonDocument } from '../../pdm/types';
import { ValidationIssue } from '../types';
import { getNodeBoundingBox, getTrimBox } from '../geometry';

/**
 * REGRAS V005 e V006 — CONFIGURAÇÃO E COBERTURA DE SANGRIA (BLEED)
 */
export function validateBleed(doc: PrexyonDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const bleed = doc.productionSettings?.bleed;

  if (!bleed || !bleed.enabled) {
    return issues;
  }

  const isUniform =
    bleed.top_mm === bleed.right_mm &&
    bleed.top_mm === bleed.bottom_mm &&
    bleed.top_mm === bleed.left_mm;

  // REGRA V005 — Informação sobre sangria configurada
  const bleedDesc = isUniform
    ? `${bleed.top_mm} mm`
    : `Sup: ${bleed.top_mm}mm, Dir: ${bleed.right_mm}mm, Inf: ${bleed.bottom_mm}mm, Esq: ${bleed.left_mm}mm`;

  issues.push({
    id: 'V005:doc:bleed_configured',
    ruleId: 'V005_BLEED_CONFIGURED',
    severity: 'info',
    category: 'bleed',
    title: 'Sangria Configurada',
    message: `Sangria configurada no documento: ${bleedDesc}.`,
    data: {
      bleed,
      isUniform,
    },
    fixable: false,
  });

  // REGRA V006 — Cobertura geométrica de sangria
  // Analisa apenas nós de arte visíveis (RasterNode e VectorGroupNode)
  const visibleArtBoxes = doc.rootNodeIds
    .map((id) => doc.nodes[id])
    .filter((n) => !!n && n.visible && (n.type === 'raster_image' || n.type === 'group'))
    .map((n) => getNodeBoundingBox(n!))
    .filter((b): b is NonNullable<typeof b> => !!b);

  const trimBox = getTrimBox(doc.dimensions);

  // Lado Superior (Top)
  if (bleed.top_mm > 0) {
    const coveredTop = visibleArtBoxes.some((b) => b.minY <= -bleed.top_mm);
    if (!coveredTop) {
      issues.push({
        id: 'V006:doc:bleed_coverage_top',
        ruleId: 'V006_BLEED_INSUFFICIENT_COVERAGE',
        severity: 'warning',
        category: 'bleed',
        title: 'Sangria Superior Descoberta',
        message: 'A arte pode não cobrir completamente a sangria superior.',
        data: {
          side: 'top',
          required_mm: bleed.top_mm,
          covered: false,
        },
        fixable: false,
        suggestedAction: 'Estenda a arte de fundo até a linha externa de sangria no topo.',
      });
    }
  }

  // Lado Direito (Right)
  if (bleed.right_mm > 0) {
    const targetX = trimBox.maxX + bleed.right_mm;
    const coveredRight = visibleArtBoxes.some((b) => b.maxX >= targetX);
    if (!coveredRight) {
      issues.push({
        id: 'V006:doc:bleed_coverage_right',
        ruleId: 'V006_BLEED_INSUFFICIENT_COVERAGE',
        severity: 'warning',
        category: 'bleed',
        title: 'Sangria Direita Descoberta',
        message: 'A arte pode não cobrir completamente a sangria direita.',
        data: {
          side: 'right',
          required_mm: bleed.right_mm,
          covered: false,
        },
        fixable: false,
        suggestedAction: 'Estenda a arte de fundo até a linha externa de sangria à direita.',
      });
    }
  }

  // Lado Inferior (Bottom)
  if (bleed.bottom_mm > 0) {
    const targetY = trimBox.maxY + bleed.bottom_mm;
    const coveredBottom = visibleArtBoxes.some((b) => b.maxY >= targetY);
    if (!coveredBottom) {
      issues.push({
        id: 'V006:doc:bleed_coverage_bottom',
        ruleId: 'V006_BLEED_INSUFFICIENT_COVERAGE',
        severity: 'warning',
        category: 'bleed',
        title: 'Sangria Inferior Descoberta',
        message: 'A arte pode não cobrir completamente a sangria inferior.',
        data: {
          side: 'bottom',
          required_mm: bleed.bottom_mm,
          covered: false,
        },
        fixable: false,
        suggestedAction: 'Estenda a arte de fundo até a linha externa de sangria na base.',
      });
    }
  }

  // Lado Esquerdo (Left)
  if (bleed.left_mm > 0) {
    const coveredLeft = visibleArtBoxes.some((b) => b.minX <= -bleed.left_mm);
    if (!coveredLeft) {
      issues.push({
        id: 'V006:doc:bleed_coverage_left',
        ruleId: 'V006_BLEED_INSUFFICIENT_COVERAGE',
        severity: 'warning',
        category: 'bleed',
        title: 'Sangria Esquerda Descoberta',
        message: 'A arte pode não cobrir completamente a sangria esquerda.',
        data: {
          side: 'left',
          required_mm: bleed.left_mm,
          covered: false,
        },
        fixable: false,
        suggestedAction: 'Estenda a arte de fundo até a linha externa de sangria à esquerda.',
      });
    }
  }

  return issues;
}
