/**
 * Tool: close_cut_contour
 *
 * Fecha geometricamente anéis poligonais abertos em nós de faca de corte (CutContourNode).
 * Se a distância entre o ponto inicial e final for menor ou igual a maxGap_mm (padrão 0.5 mm),
 * fecha o polígono unindo o último ponto ao primeiro.
 */

import { ToolDefinition, ToolResult } from '../types';
import { CutContourNode, ContourPolygon } from '../../pdm/types';
import { CloseCutContourCommand } from '../../commands/types';
import { roundPrecision } from '../../pdm/units';

export interface CloseCutContourArgs {
  nodeId: string;
  maxGap_mm?: number;
}

export interface CloseCutContourResultData {
  nodeId: string;
  name: string;
  closedContoursCount: number;
  totalContours: number;
  maxGapEncountered_mm: number;
}

/**
 * Calcula a distância euclidiana entre dois pontos em milímetros.
 */
export function calculatePointDistance(
  p1: { x: number; y: number },
  p2: { x: number; y: number }
): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

/**
 * Checa se um polígono de faca de corte está aberto e calcula o gap.
 */
export function checkContourOpenGap(polygon: ContourPolygon): { isOpen: boolean; gap_mm: number } {
  const pts = polygon.points_mm || [];
  if (pts.length < 2) {
    return { isOpen: true, gap_mm: 0 };
  }

  const p0 = pts[0];
  const pN = pts[pts.length - 1];
  const gap_mm = roundPrecision(calculatePointDistance(p0, pN), 4);

  // Considerado aberto se o gap for maior que 0.001 mm
  const isOpen = gap_mm > 0.001;
  return { isOpen, gap_mm };
}

export const closeCutContourTool: ToolDefinition<
  CloseCutContourArgs,
  CloseCutContourResultData
> = {
  name: 'close_cut_contour',
  description:
    'Fecha anéis de corte abertos em nós de faca de corte conectando as extremidades quando o gap for aceitável (<= 0.5 mm).',
  parameters: {
    type: 'object',
    properties: {
      nodeId: {
        type: 'string',
        description: 'ID da faca de corte (cut_contour) a ser fechada.',
      },
      maxGap_mm: {
        type: 'number',
        description: 'Distância máxima de abertura permitida para fechamento automático (padrão: 0.5 mm).',
      },
    },
    required: ['nodeId'],
  },
  async execute(args, context): Promise<ToolResult<CloseCutContourResultData>> {
    const { doc, historyManager, setDoc } = context;

    if (!args || typeof args.nodeId !== 'string' || !args.nodeId.trim()) {
      return {
        success: false,
        error: {
          code: 'INVALID_ARGUMENTS',
          message: 'O parâmetro "nodeId" é obrigatório e deve ser uma string não-vazia.',
        },
      };
    }

    const targetNode = doc.nodes[args.nodeId];
    if (!targetNode) {
      return {
        success: false,
        error: {
          code: 'NODE_NOT_FOUND',
          message: `Nó com id "${args.nodeId}" não foi encontrado no documento.`,
        },
      };
    }

    if (targetNode.type !== 'cut_contour') {
      return {
        success: false,
        error: {
          code: 'INVALID_NODE_TYPE',
          message: `O nó "${targetNode.name}" é do tipo "${targetNode.type}". Apenas nós do tipo "cut_contour" podem ser fechados por esta ferramenta.`,
        },
      };
    }

    const cutNode = targetNode as CutContourNode;
    const maxGap = typeof args.maxGap_mm === 'number' && args.maxGap_mm > 0 ? args.maxGap_mm : 0.5;

    let closedCount = 0;
    let maxGapEncountered = 0;
    const prevContours = cutNode.contours || [];
    const nextContours: ContourPolygon[] = [];

    for (const poly of prevContours) {
      const { isOpen, gap_mm } = checkContourOpenGap(poly);
      if (isOpen) {
        if (gap_mm > maxGap) {
          return {
            success: false,
            error: {
              code: 'GAP_TOO_LARGE',
              message: `A abertura no contorno (${gap_mm.toFixed(2)} mm) excede o limite seguro de fechamento automático (${maxGap.toFixed(2)} mm). Exige revisão manual de vetor.`,
            },
          };
        }

        maxGapEncountered = Math.max(maxGapEncountered, gap_mm);
        closedCount++;

        // Fecha o polígono duplicando o ponto inicial no final
        const pts = [...poly.points_mm];
        pts.push({ x: pts[0].x, y: pts[0].y });

        nextContours.push({
          ...poly,
          points_mm: pts,
        });
      } else {
        nextContours.push(poly);
      }
    }

    if (closedCount === 0) {
      return {
        success: true,
        doc,
        message: `A faca de corte "${cutNode.name}" já possui todos os contornos fechados.`,
        data: {
          nodeId: cutNode.id,
          name: cutNode.name,
          closedContoursCount: 0,
          totalContours: prevContours.length,
          maxGapEncountered_mm: 0,
        },
      };
    }

    try {
      const cmd = new CloseCutContourCommand(cutNode.id, prevContours, nextContours);

      let nextDoc = doc;
      if (historyManager) {
        const res = historyManager.executeCommand(cmd, doc);
        nextDoc = res.doc;
      } else {
        const res = cmd.execute(doc);
        nextDoc = res.doc;
      }

      if (setDoc) {
        setDoc(nextDoc);
      }

      return {
        success: true,
        doc: nextDoc,
        message: `Faca de corte "${cutNode.name}" fechada com sucesso (${closedCount} ${
          closedCount === 1 ? 'contorno fechado' : 'contornos fechados'
        }, maior gap: ${maxGapEncountered.toFixed(2)} mm).`,
        data: {
          nodeId: cutNode.id,
          name: cutNode.name,
          closedContoursCount: closedCount,
          totalContours: nextContours.length,
          maxGapEncountered_mm: maxGapEncountered,
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao fechar contorno de corte.';
      return {
        success: false,
        error: {
          code: 'EXECUTION_FAILED',
          message: msg,
          details: err,
        },
      };
    }
  },
};
