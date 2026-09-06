import { PrexyonDocument, RasterNode, VectorGroupNode, CutContourNode } from '../../pdm/types';
import { ValidationIssue } from '../types';

/**
 * REGRA V002 — DIMENSÕES FÍSICAS DE NÓS
 * Para RasterNode, VectorGroupNode e CutContourNode, valida se physicalWidth_mm e physicalHeight_mm > 0 e finitos.
 */
export function validateNodeDimensions(doc: PrexyonDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const nodeId of doc.rootNodeIds) {
    const node = doc.nodes[nodeId];
    if (!node) continue;

    if (node.type === 'raster_image' || node.type === 'group' || node.type === 'cut_contour') {
      const physicalNode = node as RasterNode | VectorGroupNode | CutContourNode;
      const w = physicalNode.physicalWidth_mm;
      const h = physicalNode.physicalHeight_mm;
      const isWValid = typeof w === 'number' && Number.isFinite(w) && w > 0;
      const isHValid = typeof h === 'number' && Number.isFinite(h) && h > 0;

      if (!isWValid || !isHValid) {
        issues.push({
          id: `V002:${node.id}:invalid_dimensions`,
          ruleId: 'V002_NODE_INVALID_DIMENSIONS',
          severity: 'error',
          category: 'dimensions',
          title: 'Dimensão de Objeto Inválida',
          message: `O objeto "${node.name}" possui dimensões físicas inválidas (${w} × ${h} mm).`,
          nodeId: node.id,
          data: { physicalWidth_mm: w, physicalHeight_mm: h },
          fixable: false,
          suggestedAction: 'Redefina as dimensões físicas do objeto no painel de propriedades.',
        });
      }
    }
  }

  return issues;
}
