/**
 * Prexyon Agent — Proposal Generator (Etapa 6.10)
 *
 * Gera propostas determinísticas de correção assistida (REQUIRES_CONFIRMATION)
 * com cálculo rigoroso de impacto, preview sem mutação e rastreamento de versão.
 */

import { PrexyonDocument, RasterNode } from '../pdm/types';
import { calculateEffectiveDpi, roundPrecision } from '../pdm/units';
import { detectPrepressIssues } from './issueDetector';
import { simplifyVectorPath } from '../geometry/vectorPathCleaner';
import { PrepressIssue } from './types';
import { ProposedFix } from './proposalTypes';

/**
 * Gera fingerprint estrutural do documento para detecção de propostas obsoletas (STALE).
 */
export function calculateDocFingerprint(doc: PrexyonDocument): string {
  const nodeCount = Object.keys(doc.nodes || {}).length;
  const version = doc.version ?? 0;
  return `${doc.id}_v${version}_nodes${nodeCount}`;
}

/**
 * Gera propostas assistidas determinísticas para os problemas que exigem confirmação humana.
 *
 * @param doc Documento PDM imutável.
 * @param customIssues Lista opcional de issues já detectadas.
 * @returns Lista de propostas geradas (sem qualquer mutação no PDM).
 */
export function generateProposedFixes(
  doc: PrexyonDocument,
  customIssues?: PrepressIssue[]
): ProposedFix[] {
  const issues = customIssues || detectPrepressIssues(doc);
  const proposals: ProposedFix[] = [];
  const fingerprint = calculateDocFingerprint(doc);
  const artboard = doc.dimensions || { width_mm: 100, height_mm: 100 };

  for (const issue of issues) {
    if (!issue.affectedNodeId) continue;
    const node = doc.nodes[issue.affectedNodeId];
    if (!node) continue;

    // CASO 1: BAIXA RESOLUÇÃO (LOW_DPI / CRITICAL_LOW_DPI) -> PROPOSTA DE RESIZE PROPORCIONAL
    if (
      (issue.code === 'LOW_DPI' || issue.code === 'CRITICAL_LOW_DPI') &&
      node.type === 'raster_image'
    ) {
      const raster = node as RasterNode;
      if (raster.naturalWidth > 0 && raster.physicalWidth_mm > 0) {
        const currentDpi = calculateEffectiveDpi(raster.naturalWidth, raster.physicalWidth_mm);

        // Fator de redução proporcional: busca atingir pelo menos 150 DPI (ou 300 DPI se viável)
        // Reduzindo pela metade dobra a resolução efetiva:
        const targetDpi = currentDpi < 100 ? currentDpi * 2 : 150;
        const scaleFactor = Math.min(Math.max(currentDpi / targetDpi, 0.25), 0.75);

        const newWidth_mm = roundPrecision(raster.physicalWidth_mm * scaleFactor, 2);
        const newHeight_mm = roundPrecision(raster.physicalHeight_mm * scaleFactor, 2);
        const projectedDpi = calculateEffectiveDpi(raster.naturalWidth, newWidth_mm);

        // Somente cria proposta se houver ganho real de DPI efetivo
        if (projectedDpi > currentDpi && newWidth_mm > 5 && newHeight_mm > 5) {
          proposals.push({
            id: `prop_resize_${raster.id}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            issueId: issue.id,
            issueCode: issue.code,
            targetNodeId: raster.id,
            targetNodeName: raster.name,
            title: `Reduzir Tamanho Físico para ${newWidth_mm} × ${newHeight_mm} mm`,
            description: `Reduz a escala física da imagem para elevar a resolução efetiva de ${currentDpi} DPI para ${projectedDpi} DPI.`,
            reason: `A imagem original possui poucos pixels nativos (${raster.naturalWidth}x${raster.naturalHeight} px). Reduzir seu tamanho físico na prancheta melhora a nitidez de impressão sem inventar pixels artificiais.`,
            toolName: 'resize_node',
            proposedParams: {
              nodeId: raster.id,
              width_mm: newWidth_mm,
              height_mm: newHeight_mm,
              keepAspectRatio: true,
            },
            expectedImpact: {
              dimensionsBefore: {
                width_mm: raster.physicalWidth_mm,
                height_mm: raster.physicalHeight_mm,
              },
              dimensionsAfter: {
                width_mm: newWidth_mm,
                height_mm: newHeight_mm,
              },
              dpiBefore: currentDpi,
              dpiAfter: projectedDpi,
              affectedObjectsCount: 1,
              visualArtChanges: true,
              technicalGeometryChanges: false,
              summary: `Redução proporcional de ${raster.physicalWidth_mm} × ${raster.physicalHeight_mm} mm para ${newWidth_mm} × ${newHeight_mm} mm (+${projectedDpi - currentDpi} DPI efetivos).`,
            },
            previewData: {
              type: 'bounds_overlay',
              currentBounds_mm: {
                x: raster.position_mm.x,
                y: raster.position_mm.y,
                width_mm: raster.physicalWidth_mm,
                height_mm: raster.physicalHeight_mm,
              },
              proposedBounds_mm: {
                x: raster.position_mm.x,
                y: raster.position_mm.y,
                width_mm: newWidth_mm,
                height_mm: newHeight_mm,
              },
            },
            risks: [
              'O tamanho físico final do elemento impresso será reduzido.',
              'Pode ser necessário reajustar outros elementos do layout.',
            ],
            reversible: true,
            requiresConfirmation: true,
            status: 'PENDING',
            docVersionFingerprint: fingerprint,
            createdAt: Date.now(),
          });
        }
      }
    }

    // CASO 2: ELEMENTO FORA DA PRANCHETA (OUT_OF_BOUNDS / CUT_CONTOUR_OUTSIDE_ARTBOARD) -> PROPOSTA DE REPOSICIONAMENTO
    if (issue.code === 'OUT_OF_BOUNDS' || issue.code === 'CUT_CONTOUR_OUTSIDE_ARTBOARD') {
      const nodeWidth = (node as any).physicalWidth_mm ?? 50;
      const nodeHeight = (node as any).physicalHeight_mm ?? 50;
      const currentX = node.position_mm?.x ?? 0;
      const currentY = node.position_mm?.y ?? 0;

      let safeX = currentX;
      let safeY = currentY;

      const margin = 5; // margem técnica segura em mm

      if (safeX < margin) safeX = margin;
      if (safeX + nodeWidth > artboard.width_mm - margin) {
        safeX = Math.max(artboard.width_mm - nodeWidth - margin, margin);
      }

      if (safeY < margin) safeY = margin;
      if (safeY + nodeHeight > artboard.height_mm - margin) {
        safeY = Math.max(artboard.height_mm - nodeHeight - margin, margin);
      }

      const hasMoved = Math.abs(safeX - currentX) > 0.1 || Math.abs(safeY - currentY) > 0.1;

      if (hasMoved) {
        proposals.push({
          id: `prop_move_${node.id}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          issueId: issue.id,
          issueCode: issue.code,
          targetNodeId: node.id,
          targetNodeName: node.name,
          title: `Reposicionar para Dentro da Área Segura (${safeX.toFixed(1)}, ${safeY.toFixed(1)} mm)`,
          description: `Move o elemento "${node.name}" para dentro dos limites da prancheta respeitando a margem de segurança.`,
          reason: `O elemento ultrapassa os limites da prancheta (${artboard.width_mm} × ${artboard.height_mm} mm) e sofreria corte mecânico indesejado.`,
          toolName: 'move_node',
          proposedParams: {
            nodeId: node.id,
            x_mm: safeX,
            y_mm: safeY,
            relative: false,
          },
          expectedImpact: {
            positionBefore: { x: currentX, y: currentY },
            positionAfter: { x: safeX, y: safeY },
            affectedObjectsCount: 1,
            visualArtChanges: false,
            technicalGeometryChanges: false,
            summary: `Deslocamento seguro de (${currentX.toFixed(1)}, ${currentY.toFixed(1)}) para (${safeX.toFixed(1)}, ${safeY.toFixed(1)}) mm.`,
          },
          previewData: {
            type: 'geometry_shift',
            currentBounds_mm: {
              x: currentX,
              y: currentY,
              width_mm: nodeWidth,
              height_mm: nodeHeight,
            },
            proposedBounds_mm: {
              x: safeX,
              y: safeY,
              width_mm: nodeWidth,
              height_mm: nodeHeight,
            },
          },
          risks: ['O elemento mudará de posição em relação aos outros objetos da prancheta.'],
          reversible: true,
          requiresConfirmation: true,
          status: 'PENDING',
          docVersionFingerprint: fingerprint,
          createdAt: Date.now(),
        });
      }
    }

    // CASO 3: ESPESSURA DE TRAÇO ABAIXO DO MÍNIMO TÉCNICO (STROKE_TOO_THIN) -> PROPOSTA DE AJUSTE DE ESPESSURA
    if (issue.code === 'STROKE_TOO_THIN' && node.type === 'vector_path') {
      const pathNode = node as import('../pdm/types').VectorPathNode;
      const parentGroup = pathNode.parentId && doc.nodes[pathNode.parentId]?.type === 'group'
        ? (doc.nodes[pathNode.parentId] as import('../pdm/types').VectorGroupNode)
        : undefined;

      const groupScale = parentGroup && parentGroup.sourceViewBox?.width && parentGroup.physicalWidth_mm
        ? (parentGroup.physicalWidth_mm / parentGroup.sourceViewBox.width)
        : 1.0;

      const currentEffectiveStroke = (pathNode.strokeWidth_mm ?? 0) * groupScale;
      const targetMinStroke = (issue.suggestedParams?.minStrokeWidth_mm as number) || 0.20;

      if (currentEffectiveStroke < targetMinStroke) {
        proposals.push({
          id: `prop_stroke_${pathNode.id}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          issueId: issue.id,
          issueCode: issue.code,
          targetNodeId: pathNode.id,
          targetNodeName: pathNode.name,
          title: `Ajustar Espessura do Traço para ${targetMinStroke.toFixed(2)} mm`,
          description: `Aumenta a espessura do traço do vetor "${pathNode.name}" de ${currentEffectiveStroke.toFixed(2)} mm para ${targetMinStroke.toFixed(2)} mm.`,
          reason: `Linhas com espessura abaixo de ${targetMinStroke.toFixed(2)} mm podem falhar na impressão ou quebrar no recorte em vinil.`,
          toolName: 'set_minimum_stroke_width',
          proposedParams: {
            nodeId: pathNode.id,
            minStrokeWidth_mm: targetMinStroke,
          },
          expectedImpact: {
            affectedObjectsCount: 1,
            visualArtChanges: true,
            technicalGeometryChanges: false,
            summary: `Aumento da espessura do traço de ${currentEffectiveStroke.toFixed(2)} mm para ${targetMinStroke.toFixed(2)} mm.`,
          },
          previewData: {
            type: 'property_change',
            property: 'strokeWidth_mm',
            valueBefore: currentEffectiveStroke,
            valueAfter: targetMinStroke,
          },
          risks: ['O traço ficará visualmente mais espesso na arte final.'],
          reversible: true,
          requiresConfirmation: true,
          status: 'PENDING',
          docVersionFingerprint: fingerprint,
          createdAt: Date.now(),
        });
      }
    }

    // CASO 4: FACA DE CORTE COM GAP ELEVADO (CUT_CONTOUR_OPEN) -> PROPOSTA DE FECHAMENTO ASSISTIDO
    if (
      issue.code === 'CUT_CONTOUR_OPEN' &&
      node.type === 'cut_contour' &&
      issue.fixClassification === 'REQUIRES_CONFIRMATION'
    ) {
      const cutNode = node as import('../pdm/types').CutContourNode;
      const gap_mm = (issue.evidence?.gap_mm as number) || 0.5;

      proposals.push({
        id: `prop_close_cut_${cutNode.id}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        issueId: issue.id,
        issueCode: issue.code,
        targetNodeId: cutNode.id,
        targetNodeName: cutNode.name,
        title: `Fechar Contorno de Corte (${gap_mm.toFixed(2)} mm)`,
        description: `Fecha o anel poligonal aberto da faca de corte unindo as extremidades em linha reta.`,
        reason: `A faca de corte possui abertura de ${gap_mm.toFixed(2)} mm (> 0.50 mm). O fechamento em linha reta garante um circuito fechado para a plotter.`,
        toolName: 'close_cut_contour',
        proposedParams: {
          nodeId: cutNode.id,
          maxGap_mm: gap_mm + 0.1,
        },
        expectedImpact: {
          affectedObjectsCount: 1,
          visualArtChanges: false,
          technicalGeometryChanges: true,
          summary: `Fechamento do contorno de corte conectando abertura de ${gap_mm.toFixed(2)} mm.`,
        },
        previewData: {
          type: 'geometry_shift',
        },
        risks: ['Uma linha reta de corte será traçada entre as extremidades abertas.'],
        reversible: true,
        requiresConfirmation: true,
        status: 'PENDING',
        docVersionFingerprint: fingerprint,
        createdAt: Date.now(),
      });
    }

    // CASO 5: CAMINHO VETORIAL EXCESSIVAMENTE COMPLEXO (EXCESSIVE_PATH_COMPLEXITY) -> PROPOSTA DE SIMPLIFICAÇÃO
    if (issue.code === 'EXCESSIVE_PATH_COMPLEXITY' && node.type === 'vector_path') {
      const pathNode = node as import('../pdm/types').VectorPathNode;
      const toleranceMm = (issue.suggestedParams?.toleranceMm as number) || 0.05;
      const simp = simplifyVectorPath(pathNode.d, toleranceMm);

      proposals.push({
        id: `prop_simplify_${pathNode.id}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        issueId: issue.id,
        issueCode: issue.code,
        targetNodeId: pathNode.id,
        targetNodeName: pathNode.name,
        title: `Simplificar Traçado Vetorial (${simp.reductionPercentage}% de redução)`,
        description: `Reduz o número de nós do vetor "${pathNode.name}" de ${simp.nodesBefore} para ${simp.nodesAfter} nós utilizando Douglas-Peucker (tolerância: ${toleranceMm} mm).`,
        reason: `Caminhos vetoriais com excesso de vértices (${simp.nodesBefore} nós) causam lentidão no RIP e travamentos em plotters de corte. A simplificação reduz ${simp.nodesReduced} nós com desvio máximo de ~${simp.maxEstimatedError_mm} mm.`,
        toolName: 'simplify_vector_path',
        proposedParams: {
          nodeId: pathNode.id,
          toleranceMm: toleranceMm,
        },
        expectedImpact: {
          affectedObjectsCount: 1,
          visualArtChanges: false,
          technicalGeometryChanges: true,
          summary: `Redução de ${simp.nodesBefore} para ${simp.nodesAfter} nós (${simp.reductionPercentage}% mais leve, erro geométrico máx: ${simp.maxEstimatedError_mm} mm).`,
        },
        previewData: {
          type: 'geometry_shift',
        },
        risks: [
          `A geometria do traçado sofrerá simplificação com tolerância máxima de ${toleranceMm} mm.`,
        ],
        reversible: true,
        requiresConfirmation: true,
        status: 'PENDING',
        docVersionFingerprint: fingerprint,
        createdAt: Date.now(),
      });
    }
  }

  return proposals;
}
