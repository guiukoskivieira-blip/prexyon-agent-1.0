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
 * Em anéis poligonais (ContourPolygon), se houver 3 ou mais vértices, o anel é fechado por definição.
 */
export function checkContourOpenGap(polygon: ContourPolygon): { isOpen: boolean; gap_mm: number } {
  const pts = polygon.points_mm || [];
  if (pts.length < 3) {
    return { isOpen: true, gap_mm: 0 };
  }

  const first = pts[0];
  const last = pts[pts.length - 1];
  const gap_mm = Math.hypot(first.x - last.x, first.y - last.y);
  const isOpen = gap_mm > 0.001;

  return { isOpen, gap_mm: Number(gap_mm.toFixed(3)) };
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
    const prevContours = cutNode.contours || [];
    const nextContours: ContourPolygon[] = [];
    let cleanedCount = 0;

    const maxGap = args.maxGap_mm ?? 0.5;
    for (const poly of prevContours) {
      const pts = [...(poly.points_mm || [])];
      if (pts.length >= 3) {
        const first = pts[0];
        const last = pts[pts.length - 1];
        const gap = Math.hypot(first.x - last.x, first.y - last.y);
        if (gap > 0.0001 && gap <= maxGap) {
          if (gap < 0.002) {
            pts.pop();
          } else {
            pts.push({ x: first.x, y: first.y });
          }
          cleanedCount++;
        }
      }
      nextContours.push({
        ...poly,
        points_mm: pts,
      });
    }

    if (cleanedCount === 0) {
      return {
        success: true,
        doc,
        message: `A faca de corte "${cutNode.name}" já possui todos os contornos fechados e válidos.`,
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
        message: `Faca de corte "${cutNode.name}" normalizada e fechada com sucesso.`,
        data: {
          nodeId: cutNode.id,
          name: cutNode.name,
          closedContoursCount: cleanedCount,
          totalContours: nextContours.length,
          maxGapEncountered_mm: 0,
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
