/**
 * Tool: set_minimum_stroke_width
 *
 * Ajusta a espessura técnica mínima de linhas e traçados vetoriais
 * para garantir que atendam ao limite mínimo de produção (ex: 0.20 mm).
 * Leva em conta a escala do grupo de origem (sourceViewBox -> physicalWidth_mm).
 */

import { ToolDefinition, ToolResult } from '../types';
import { VectorPathNode, VectorGroupNode } from '../../pdm/types';
import { roundPrecision } from '../../pdm/units';
import {
  SetMinimumStrokeWidthCommand,
  StrokeWidthAdjustment,
} from '../../commands/types';

export interface SetMinimumStrokeWidthArgs {
  nodeId?: string;
  minStrokeWidth_mm?: number;
}

export interface SetMinimumStrokeWidthResultData {
  adjustedCount: number;
  minStrokeWidth_mm: number;
  adjustments: {
    nodeId: string;
    nodeName: string;
    prevStrokeWidth_mm: number;
    nextStrokeWidth_mm: number;
    effectiveStrokeWidth_mm: number;
  }[];
}

/**
 * Calcula a escala geométrica de um grupo de vetores.
 */
export function getGroupScale(group?: VectorGroupNode): number {
  if (!group) return 1.0;
  if (group.sourceViewBox && group.sourceViewBox.width > 0 && group.physicalWidth_mm > 0) {
    return group.physicalWidth_mm / group.sourceViewBox.width;
  }
  return 1.0;
}

/**
 * Calcula a espessura de traço efetiva em milímetros de um nó vetorial.
 */
export function calculateEffectiveStrokeWidth(
  pathNode: VectorPathNode,
  parentGroup?: VectorGroupNode
): number {
  const baseStroke = pathNode.strokeWidth_mm ?? 0;
  const scale = getGroupScale(parentGroup);
  return baseStroke * scale;
}

export const setMinimumStrokeWidthTool: ToolDefinition<
  SetMinimumStrokeWidthArgs,
  SetMinimumStrokeWidthResultData
> = {
  name: 'set_minimum_stroke_width',
  description:
    'Ajusta a espessura de contornos vetoriais que estejam abaixo do limite técnico mínimo de impressão/corte (padrão: 0.20 mm).',
  parameters: {
    type: 'object',
    properties: {
      nodeId: {
        type: 'string',
        description:
          'ID opcional do nó (vector_path) ou grupo (group) a ser ajustado. Se omitido, ajusta todos os vetores do documento.',
      },
      minStrokeWidth_mm: {
        type: 'number',
        description: 'Espessura mínima de traço em milímetros (padrão: 0.20 mm).',
      },
    },
  },
  async execute(args, context): Promise<ToolResult<SetMinimumStrokeWidthResultData>> {
    const { doc, historyManager, setDoc } = context;
    const targetNodeId = args?.nodeId;
    const minStroke = typeof args?.minStrokeWidth_mm === 'number' && args.minStrokeWidth_mm > 0
      ? args.minStrokeWidth_mm
      : 0.20;

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
            message: `O nó "${targetNode.name}" é do tipo "${targetNode.type}". Apenas nós vetoriais ou grupos podem ter espessura de traço ajustada.`,
          },
        };
      }
    } else {
      candidatePaths = allNodes.filter((n): n is VectorPathNode => n.type === 'vector_path');
    }

    const commandAdjustments: StrokeWidthAdjustment[] = [];
    const resultAdjustments: SetMinimumStrokeWidthResultData['adjustments'] = [];

    for (const path of candidatePaths) {
      const stroke = path.stroke?.trim().toLowerCase();
      // Se não tem traço definido, não adiciona traço artificial
      if (!stroke || stroke === 'none' || stroke === 'transparent') {
        continue;
      }

      const parentGroup = path.parentId && doc.nodes[path.parentId]?.type === 'group'
        ? (doc.nodes[path.parentId] as VectorGroupNode)
        : undefined;

      const groupScale = getGroupScale(parentGroup);
      const currentEffectiveStroke = (path.strokeWidth_mm ?? 0) * groupScale;

      // Se a espessura efetiva estiver abaixo da mínima (com tolerância de 0.001 mm)
      if (currentEffectiveStroke < minStroke - 0.001) {
        // Calcula a nova espessura no sistema de coordenadas do path
        const requiredNodeStroke = roundPrecision(minStroke / groupScale, 3);

        commandAdjustments.push({
          nodeId: path.id,
          prevStrokeWidth_mm: path.strokeWidth_mm ?? 0,
          nextStrokeWidth_mm: requiredNodeStroke,
        });

        resultAdjustments.push({
          nodeId: path.id,
          nodeName: path.name,
          prevStrokeWidth_mm: path.strokeWidth_mm ?? 0,
          nextStrokeWidth_mm: requiredNodeStroke,
          effectiveStrokeWidth_mm: minStroke,
        });
      }
    }

    if (commandAdjustments.length === 0) {
      return {
        success: true,
        doc,
        message: `Todos os traçados vetoriais já atendem à espessura técnica mínima (${minStroke} mm).`,
        data: {
          adjustedCount: 0,
          minStrokeWidth_mm: minStroke,
          adjustments: [],
        },
      };
    }

    try {
      const cmd = new SetMinimumStrokeWidthCommand(commandAdjustments, minStroke);

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
        message: `${commandAdjustments.length} ${
          commandAdjustments.length === 1 ? 'traço vetorial ajustado' : 'traços vetoriais ajustados'
        } para espessura mínima de ${minStroke} mm.`,
        data: {
          adjustedCount: commandAdjustments.length,
          minStrokeWidth_mm: minStroke,
          adjustments: resultAdjustments,
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao ajustar espessura de traço.';
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
