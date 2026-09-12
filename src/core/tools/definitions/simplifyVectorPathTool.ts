/**
 * Tool: simplify_vector_path
 *
 * Simplifica um caminho vetorial SVG de alta densidade/complexidade usando Douglas-Peucker
 * com tolerância controlada em milímetros.
 */

import { ToolDefinition, ToolResult } from '../types';
import { VectorPathNode } from '../../pdm/types';
import { SimplifyVectorPathCommand } from '../../commands/types';
import { simplifyVectorPath } from '../../geometry/vectorPathCleaner';

export interface SimplifyVectorPathArgs {
  nodeId: string;
  toleranceMm?: number;
}

export interface SimplifyVectorPathResultData {
  nodeId: string;
  nodeName: string;
  nodesBefore: number;
  nodesAfter: number;
  nodesReduced: number;
  reductionPercentage: number;
  maxEstimatedError_mm: number;
  tolerance_mm: number;
}

export const simplifyVectorPathTool: ToolDefinition<
  SimplifyVectorPathArgs,
  SimplifyVectorPathResultData
> = {
  name: 'simplify_vector_path',
  description:
    'Simplifica a geometria de um caminho vetorial complexo utilizando o algoritmo Douglas-Peucker com tolerância controlada em milímetros.',
  parameters: {
    type: 'object',
    properties: {
      nodeId: {
        type: 'string',
        description: 'ID do nó vetorial (vector_path) a ser simplificado.',
      },
      toleranceMm: {
        type: 'number',
        description:
          'Tolerância máxima de simplificação em milímetros (padrão: 0.05 mm).',
      },
    },
    required: ['nodeId'],
  },
  async execute(args, context): Promise<ToolResult<SimplifyVectorPathResultData>> {
    const { doc, historyManager, setDoc } = context;
    const targetNodeId = args?.nodeId;

    if (!targetNodeId) {
      return {
        success: false,
        error: {
          code: 'INVALID_ARGS',
          message: 'O parâmetro "nodeId" é obrigatório.',
        },
      };
    }

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

    if (targetNode.locked) {
      return {
        success: false,
        error: {
          code: 'NODE_LOCKED',
          message: `O nó "${targetNode.name || targetNodeId}" está bloqueado e não pode ser modificado.`,
        },
      };
    }

    if (targetNode.type !== 'vector_path') {
      return {
        success: false,
        error: {
          code: 'INVALID_NODE_TYPE',
          message: `O nó "${targetNode.name}" é do tipo "${targetNode.type}". Apenas nós do tipo "vector_path" podem ser simplificados.`,
        },
      };
    }

    const pathNode = targetNode as VectorPathNode;
    const toleranceMm =
      typeof args?.toleranceMm === 'number' && args.toleranceMm > 0
        ? args.toleranceMm
        : 0.05;

    const simpResult = simplifyVectorPath(pathNode.d, toleranceMm);

    try {
      const cmd = new SimplifyVectorPathCommand(
        pathNode.id,
        pathNode.d,
        simpResult.simplifiedD,
        toleranceMm
      );

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
        message: `Vetor "${pathNode.name}" simplificado de ${simpResult.nodesBefore} para ${simpResult.nodesAfter} nós (${simpResult.reductionPercentage}% de redução, erro máx ~${simpResult.maxEstimatedError_mm} mm).`,
        data: {
          nodeId: pathNode.id,
          nodeName: pathNode.name,
          nodesBefore: simpResult.nodesBefore,
          nodesAfter: simpResult.nodesAfter,
          nodesReduced: simpResult.nodesReduced,
          reductionPercentage: simpResult.reductionPercentage,
          maxEstimatedError_mm: simpResult.maxEstimatedError_mm,
          tolerance_mm: toleranceMm,
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao simplificar vetor.';
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
