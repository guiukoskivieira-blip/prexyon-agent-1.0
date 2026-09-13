import { PrexyonDocument, CutContourNode } from '../../pdm/types';
import { ValidationIssue, ValidationPolicy } from '../types';
import { validateCutContourIntegrity } from '../../geometry/vectorPathIntegrity';

/**
 * REGRAS V009, V010, V011, V014 e V015 — VALIDAÇÃO E AUDITORIA DE FACAS DE CORTE (CUT CONTOUR)
 */
export function validateCutContours(doc: PrexyonDocument, policy?: ValidationPolicy): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const profileId = policy?.profileId || doc.profileId;
  const allNodes = Object.values(doc.nodes || {});
  const hasGraphicNodes = allNodes.some((n) => n && n.type !== 'technical_guide' && n.type !== 'cut_contour');
  const hasCutContour = allNodes.some((n) => n && n.type === 'cut_contour');

  // REGRA V016 — Faca de corte obrigatória ausente em adesivo convencional
  if (profileId === 'generic-sticker' && hasGraphicNodes && !hasCutContour) {
    issues.push({
      id: 'V016:doc:cut_contour_required_missing',
      ruleId: 'V016_CUT_CONTOUR_REQUIRED_MISSING',
      severity: 'error',
      category: 'cut',
      title: 'Faca de Corte Obrigatória Ausente',
      message: 'O perfil de Adesivo Convencional exige um contorno de corte vetorial (CutContour) para corte em plotter.',
      fixable: true,
      suggestedAction: 'Gere a faca de corte selecionando o elemento e solicitando "crie uma faca de 2 mm".',
    });
  }

  for (const nodeId of doc.rootNodeIds || Object.keys(doc.nodes || {})) {
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
      cutNode.contours.every((c: any) => {
        const pts = c?.points_mm || c?.points;
        return (
          Array.isArray(pts) &&
          pts.length >= 3 &&
          pts.every(
            (pt: any) =>
              typeof pt.x === 'number' &&
              Number.isFinite(pt.x) &&
              typeof pt.y === 'number' &&
              Number.isFinite(pt.y)
          )
        );
      });

    const hasValidDimensions =
      (cutNode.physicalWidth_mm === undefined ||
        (typeof cutNode.physicalWidth_mm === 'number' &&
          Number.isFinite(cutNode.physicalWidth_mm) &&
          cutNode.physicalWidth_mm > 0)) &&
      (cutNode.physicalHeight_mm === undefined ||
        (typeof cutNode.physicalHeight_mm === 'number' &&
          Number.isFinite(cutNode.physicalHeight_mm) &&
          cutNode.physicalHeight_mm > 0)) &&
      (cutNode.offset_mm === undefined ||
        (typeof cutNode.offset_mm === 'number' && Number.isFinite(cutNode.offset_mm)));

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

    // REGRA V014 / V015 / V010 Integridade Geométrica (Etapa 6.14)
    const integrity = validateCutContourIntegrity(cutNode.contours, policy?.customConfig?.vectorPreflight);

    if (integrity.isSelfIntersecting) {
      issues.push({
        id: `V014:${cutNode.id}:self_intersection`,
        ruleId: 'V014_CUT_CONTOUR_SELF_INTERSECTION',
        severity: 'error',
        category: 'cut',
        title: 'Faca com Auto-Interseção',
        message: `A faca de corte "${cutNode.name}" possui ${integrity.intersectionsCount} ponto(s) de auto-interseção (linhas que se cruzam).`,
        nodeId: cutNode.id,
        data: {
          intersectionsCount: integrity.intersectionsCount,
          intersections: integrity.intersections,
          failureReasons: integrity.failureReasons,
        },
        fixable: false,
        suggestedAction: 'Corrija a geometria do vetor para eliminar auto-interseções antes do recorte.',
      });
    }

    if (integrity.hasOverlappingSegments) {
      issues.push({
        id: `V015:${cutNode.id}:overlapping_segments`,
        ruleId: 'V015_CUT_CONTOUR_OVERLAPPING_SEGMENT',
        severity: 'error',
        category: 'cut',
        title: 'Segmentos Sobrepostos na Faca',
        message: `A faca de corte "${cutNode.name}" contém ${integrity.overlappingSegments.length} segmento(s) de corte sobreposto(s).`,
        nodeId: cutNode.id,
        data: {
          overlappingCount: integrity.overlappingSegments.length,
          overlappingSegments: integrity.overlappingSegments,
        },
        fixable: false,
        suggestedAction: 'Remova segmentos duplicados da faca de corte.',
      });
    }

    if (integrity.isDegenerate) {
      issues.push({
        id: `V010:${cutNode.id}:degenerate_geometry`,
        ruleId: 'V010_CUT_CONTOUR_INVALID_GEOMETRY',
        severity: 'error',
        category: 'cut',
        title: 'Geometria de Faca Degenerada',
        message: `A faca de corte "${cutNode.name}" possui área nula ou contorno degenerado.`,
        nodeId: cutNode.id,
        data: {
          area_mm2: integrity.area_mm2,
          totalVertices: integrity.totalVertices,
          failureReasons: integrity.failureReasons,
        },
        fixable: false,
        suggestedAction: 'Regere a faca de corte com dimensões físicas válidas.',
      });
    }

    // REGRA V011 — Faca de corte válida encontrada (telemetria de produção)
    if (cutNode.visible && integrity.isValid) {
      issues.push({
        id: `V011:${cutNode.id}:valid_cut_contour`,
        ruleId: 'V011_CUT_CONTOUR_VALID',
        severity: 'info',
        category: 'cut',
        title: 'Faca de Corte Ativa',
        message: `Faca de corte encontrada: "${cutNode.name}" — offset ${cutNode.offset_mm} mm (${cutNode.contours.length} contornos, área ${integrity.area_mm2} mm²).`,
        nodeId: cutNode.id,
        data: {
          offset_mm: cutNode.offset_mm,
          joinStyle: cutNode.joinStyle,
          contoursCount: cutNode.contours.length,
          area_mm2: integrity.area_mm2,
          sourceNodeId: cutNode.sourceNodeId,
        },
        fixable: false,
      });
    }
  }

  return issues;
}
