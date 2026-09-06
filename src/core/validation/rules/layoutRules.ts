import { PrexyonDocument } from '../../pdm/types';
import { ValidationIssue } from '../types';
import { getNodeBoundingBox, getTrimBox, doBoxesIntersect, doesBoxContain } from '../geometry';

/**
 * REGRAS V003 e V004 — POSICIONAMENTO E COBERTURA EM RELAÇÃO AO TRIMBOX (PRANCHETA)
 */
export function validateLayoutBoundaries(doc: PrexyonDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const trimBox = getTrimBox(doc.dimensions);
  const bleed = doc.productionSettings?.bleed;
  const isBleedActive = !!(
    bleed?.enabled &&
    (bleed.top_mm > 0 || bleed.right_mm > 0 || bleed.bottom_mm > 0 || bleed.left_mm > 0)
  );

  for (const nodeId of doc.rootNodeIds) {
    const node = doc.nodes[nodeId];
    if (!node || !node.visible) continue;

    // Apenas arte gráfica real (Raster e Vector)
    if (node.type !== 'raster_image' && node.type !== 'group') continue;

    const box = getNodeBoundingBox(node);
    if (!box || box.width_mm <= 0 || box.height_mm <= 0) continue;

    const intersectsTrim = doBoxesIntersect(box, trimBox);

    // REGRA V003: Totalmente fora da prancheta
    if (!intersectsTrim) {
      issues.push({
        id: `V003:${node.id}:completely_outside`,
        ruleId: 'V003_OBJECT_COMPLETELY_OUTSIDE',
        severity: 'warning',
        category: 'document',
        title: 'Objeto Fora da Prancheta',
        message: `O objeto "${node.name}" está totalmente fora do formato final da prancheta.`,
        nodeId: node.id,
        data: {
          nodeBox: box,
          trimBox,
        },
        fixable: false,
        suggestedAction: 'Reposicione o objeto dentro da prancheta ou exclua-o se não for utilizado.',
      });
      continue;
    }

    // REGRA V004: Parcialmente fora da prancheta
    const isContained = doesBoxContain(trimBox, box);
    if (!isContained) {
      if (isBleedActive) {
        issues.push({
          id: `V004:${node.id}:partially_outside_bleed`,
          ruleId: 'V004_OBJECT_PARTIALLY_OUTSIDE',
          severity: 'info',
          category: 'bleed',
          title: 'Objeto em Área de Sangria',
          message: `O objeto "${node.name}" estende-se além do formato final (área de sangria ativa).`,
          nodeId: node.id,
          data: {
            nodeBox: box,
            trimBox,
            bleedActive: true,
          },
          fixable: false,
        });
      } else {
        issues.push({
          id: `V004:${node.id}:partially_outside_nobleed`,
          ruleId: 'V004_OBJECT_PARTIALLY_OUTSIDE',
          severity: 'warning',
          category: 'document',
          title: 'Objeto Ultrapassa Limite da Prancheta',
          message: `Parte do objeto "${node.name}" está fora do formato final.`,
          nodeId: node.id,
          data: {
            nodeBox: box,
            trimBox,
            bleedActive: false,
          },
          fixable: false,
          suggestedAction: 'Verifique se o recorte é intencional ou ajuste a posição/dimensão do objeto.',
        });
      }
    }
  }

  return issues;
}
