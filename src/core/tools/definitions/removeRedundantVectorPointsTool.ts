/**
 * Tool: remove_redundant_vector_points
 *
 * Remove com segurança matemática pontos duplicados consecutivos, segmentos de
 * comprimento zero e vértices intermediários colineares redundantes de caminhos vetoriais.
 */

import { ToolDefinition, ToolResult } from '../types';
import { VectorPathNode, VectorGroupNode } from '../../pdm/types';
import { CleanVectorPathCommand, CleanVectorAdjustment } from '../../commands/types';
import { removeRedundantVectorPoints } from '../../geometry/vectorPathCleaner';

export interface RemoveRedundantVectorPointsArgs {
  nodeId?: string;
  collinearToleranceMm?: number;
}

export interface RemoveRedundantVectorPointsResultData {
  cleanedCount: number;
  totalRemoved: number;
  removedDuplicates: number;
  removedZeroLength: number;
  removedCollinear: number;
  adjustments: {
    nodeId: string;
    nodeName: string;
    nodesBefore: number;
    nodesAfter: number;
    removedCount: number;
  }[];
}

export const removeRedundantVectorPointsTool: ToolDefinition<
  RemoveRedundantVectorPointsArgs,
  RemoveRedundantVectorPointsResultData
> = {
  name: 'remove_redundant_vector_points',
  description:
    'Remove pontos consecutivos duplicados, segmentos de comprimento zero e nós colineares redundantes de elementos vetoriais, preservando a fidelidade visual e topologia da arte.',
  parameters: {
    type: 'object',
    properties: {
      nodeId: {
        type: 'string',
        description:
          'ID opcional do nó vetorial ou grupo a ser limpo. Se omitido, analisa e limpa todos os vetores do documento.',
      },
      collinearToleranceMm: {
        type: 'number',
        description:
          'Tolerância máxima de desvio em milímetros para considerar pontos colineares (padrão: 0.005 mm).',
      },
    },
  },
  async execute(args, context): Promise<ToolResult<RemoveRedundantVectorPointsResultData>> {
    const { doc, historyManager, setDoc } = context;
    const targetNodeId = args?.nodeId;
    const collinearToleranceMm =
      typeof args?.collinearToleranceMm === 'number' && args.collinearToleranceMm > 0
        ? args.collinearToleranceMm
        : 0.005;

    const allNodes = Object.values(doc.nodes || {});
    let candidatePaths: VectorPathNode[] = [];

    if (targetNodeId) {
      const targetNode = doc.nodes[targetNodeId];
      if (!targetNode) {
        return {
          success: false,
          error: {
            code: 'NODE_NOT_FOUND',
            message: `Nó com id "${targetNodeId}" não foi encontrado no documento.`,
          },
        };
      }

      if (targetNode.type === 'vector_path') {
        candidatePaths.push(targetNode as VectorPathNode);
      } else if (targetNode.type === 'group') {
        const group = targetNode as VectorGroupNode;
        candidatePaths = (group.childrenIds || [])
          .map((id) => doc.nodes[id])
          .filter((n): n is VectorPathNode => !!n && n.type === 'vector_path');
      } else {
        return {
          success: false,
          error: {
            code: 'INVALID_NODE_TYPE',
            message: `O nó "${targetNode.name}" é do tipo "${targetNode.type}". Apenas nós vetoriais ou grupos podem ser limpos geometricamente.`,
          },
        };
      }
    } else {
      candidatePaths = allNodes.filter((n): n is VectorPathNode => n.type === 'vector_path');
    }

    const commandAdjustments: CleanVectorAdjustment[] = [];
    const resultAdjustments: RemoveRedundantVectorPointsResultData['adjustments'] = [];
    let totalDuplicates = 0;
    let totalZeroLength = 0;
    let totalCollinear = 0;

    for (const path of candidatePaths) {
      if (!path.d || path.d.trim().length === 0) continue;

      const cleanRes = removeRedundantVectorPoints(path.d, { collinearToleranceMm });
      if (cleanRes.totalRemoved > 0 && cleanRes.cleanedD !== path.d) {
        commandAdjustments.push({
          nodeId: path.id,
          prevD: path.d,
          nextD: cleanRes.cleanedD,
        });

        resultAdjustments.push({
          nodeId: path.id,
          nodeName: path.name,
          nodesBefore: cleanRes.nodesBefore,
          nodesAfter: cleanRes.nodesAfter,
          removedCount: cleanRes.totalRemoved,
        });

        totalDuplicates += cleanRes.removedDuplicates;
        totalZeroLength += cleanRes.removedZeroLength;
        totalCollinear += cleanRes.removedCollinear;
      }
    }

    if (commandAdjustments.length === 0) {
      return {
        success: true,
        doc,
        message: 'Nenhum ponto duplicado ou colinear redundante encontrado nos vetores analisados.',
        data: {
          cleanedCount: 0,
          totalRemoved: 0,
          removedDuplicates: 0,
          removedZeroLength: 0,
          removedCollinear: 0,
          adjustments: [],
        },
      };
    }

    try {
      const cmd = new CleanVectorPathCommand(commandAdjustments);

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

      const totalRemoved = totalDuplicates + totalCollinear;
      return {
        success: true,
        doc: nextDoc,
        message: `${totalRemoved} ${
          totalRemoved === 1 ? 'ponto redundante removido' : 'pontos redundantes removidos'
        } em ${commandAdjustments.length} ${
          commandAdjustments.length === 1 ? 'vetor' : 'vetores'
        }.`,
        data: {
          cleanedCount: commandAdjustments.length,
          totalRemoved,
          removedDuplicates: totalDuplicates,
          removedZeroLength: totalZeroLength,
          removedCollinear: totalCollinear,
          adjustments: resultAdjustments,
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao limpar pontos redundantes.';
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
