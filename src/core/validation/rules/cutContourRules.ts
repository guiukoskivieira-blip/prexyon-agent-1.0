import { PrexyonDocument, CutContourNode } from '../../pdm/types';
import { ValidationIssue } from '../types';

/**
 * REGRAS V009, V010 e V011 — VALIDAÇÃO E AUDITORIA DE FACAS DE CORTE (CUT CONTOUR)
 */
export function validateCutContours(doc: PrexyonDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const nodeId of doc.rootNodeIds) {
    const node = doc.nodes[nodeId];
    if (!node || node.type !== 'cut_contour') continue;

    const cutNode = node as CutContourNode;

    // REGRA V009 — Faca órfã (sem nó de origem no documento)
    const sourceNode = doc.nodes[cutNode.sourceNodeId];
    if (!sourceNode || sourceNode.type !== 'group') {
      issues.push({
        id: `V009:${cutNode.id}:orphan_source`,
        ruleId: 'V009_CUT_CONTOUR_ORPHAN',
        severity: 'error',
        category: 'cut',
        title: 'Faca de Corte Sem Origem',
        message: `A faca de corte "${cutNode.name}" está vinculada a um vetor de origem inexistente (${cutNode.sourceNodeId}).`,
        nodeId: cutNode.id,
        data: { sourceNodeId: cutNode.sourceNodeId },
        fixable: false,
        suggestedAction: 'Recrie a faca de corte selecionando o vetor de origem desejado.',
      });
      continue;
    }

    // REGRA V010 — Geometria inválida da faca de corte
    const hasValidContours =
      Array.isArray(cutNode.contours) &&
      cutNode.contours.length > 0 &&
      cutNode.contours.every(
        (c) =>
          Array.isArray(c.points_mm) &&
          c.points_mm.length >= 3 &&
          c.points_mm.every(
            (pt) =>
              typeof pt.x === 'number' &&
              Number.isFinite(pt.x) &&
              typeof pt.y === 'number' &&
              Number.isFinite(pt.y)
          )
      );

    const hasValidDimensions =
      typeof cutNode.physicalWidth_mm === 'number' &&
      Number.isFinite(cutNode.physicalWidth_mm) &&
      cutNode.physicalWidth_mm > 0 &&
      typeof cutNode.physicalHeight_mm === 'number' &&
      Number.isFinite(cutNode.physicalHeight_mm) &&
      cutNode.physicalHeight_mm > 0 &&
      typeof cutNode.offset_mm === 'number' &&
      Number.isFinite(cutNode.offset_mm);

    if (!hasValidContours || !hasValidDimensions) {
      issues.push({
        id: `V010:${cutNode.id}:invalid_geometry`,
        ruleId: 'V010_CUT_CONTOUR_INVALID_GEOMETRY',
        severity: 'error',
        category: 'cut',
        title: 'Geometria de Faca Inválida',
        message: `A faca de corte "${cutNode.name}" possui geometria corrompida ou contornos insuficientes.`,
        nodeId: cutNode.id,
        data: {
          contoursCount: cutNode.contours?.length ?? 0,
          physicalWidth_mm: cutNode.physicalWidth_mm,
          physicalHeight_mm: cutNode.physicalHeight_mm,
          offset_mm: cutNode.offset_mm,
        },
        fixable: false,
        suggestedAction: 'Regere a faca de corte a partir do vetor de origem.',
      });
      continue;
    }

    // REGRA V011 — Faca de corte válida encontrada (telemetria de produção)
    if (cutNode.visible) {
      issues.push({
        id: `V011:${cutNode.id}:valid_cut_contour`,
        ruleId: 'V011_CUT_CONTOUR_VALID',
        severity: 'info',
        category: 'cut',
        title: 'Faca de Corte Ativa',
        message: `Faca de corte encontrada: "${cutNode.name}" — offset ${cutNode.offset_mm} mm (${cutNode.contours.length} contornos).`,
        nodeId: cutNode.id,
        data: {
          offset_mm: cutNode.offset_mm,
          joinStyle: cutNode.joinStyle,
          contoursCount: cutNode.contours.length,
          sourceNodeId: cutNode.sourceNodeId,
        },
        fixable: false,
      });
    }
  }

  return issues;
}
