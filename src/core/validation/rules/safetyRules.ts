import { PrexyonDocument } from '../../pdm/types';
import { ValidationIssue } from '../types';
import { getNodeBoundingBox, getSafetyBox, getTrimBox, doBoxesIntersect, doesBoxContain } from '../geometry';

/**
 * REGRA V007 — MARGEM DE SEGURANÇA (SAFETY MARGIN)
 * Identifica se elementos gráficos de arte invadem a margem de segurança (fora da SafetyBox).
 */
export function validateSafetyMargin(doc: PrexyonDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const safety = doc.productionSettings?.safetyMargin;

  if (!safety || !safety.enabled) {
    return issues;
  }

  const safetyBox = getSafetyBox(doc.dimensions, safety);
  const trimBox = getTrimBox(doc.dimensions);

  for (const nodeId of doc.rootNodeIds) {
    const node = doc.nodes[nodeId];
    if (!node || !node.visible) continue;

    // Apenas arte gráfica real (Raster e Vector)
    if (node.type !== 'raster_image' && node.type !== 'group') continue;

    const box = getNodeBoundingBox(node);
    if (!box || box.width_mm <= 0 || box.height_mm <= 0) continue;

    // Se o elemento intersecta a prancheta, mas ultrapassa os limites da SafetyBox
    if (doBoxesIntersect(box, trimBox) && !doesBoxContain(safetyBox, box)) {
      issues.push({
        id: `V007:${node.id}:safety_margin_overflow`,
        ruleId: 'V007_SAFETY_MARGIN_INTERSECTION',
        severity: 'warning',
        category: 'safety',
        title: 'Elemento Cruza a Margem de Segurança',
        message: `O objeto "${node.name}" ultrapassa a margem de segurança.`,
        nodeId: node.id,
        data: {
          nodeBox: box,
          safetyBox,
        },
        fixable: false,
        suggestedAction: 'Verifique se textos e informações importantes estão dentro da área segura.',
      });
    }
  }

  return issues;
}
