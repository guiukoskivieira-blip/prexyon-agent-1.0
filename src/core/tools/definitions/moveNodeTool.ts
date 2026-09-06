/**
 * Tool: move_node
 *
 * Move a posição física em milímetros de um nó ou guia técnica no PDM.
 */

import { ToolDefinition, ToolResult } from '../types';
import { TechnicalGuideNode } from '../../pdm/types';
import { UpdatePositionCommand, UpdateTechnicalGuideCommand } from '../../commands/types';
import { roundPrecision } from '../../pdm/units';
import { updateNodePosition, updateTechnicalGuideNode } from '../../pdm/document';

export interface MoveNodeArgs {
  nodeId: string;
  x_mm?: number;
  y_mm?: number;
  relative?: boolean;
}

export interface MoveNodeResultData {
  nodeId: string;
  nodeName: string;
  prevPosition: { x: number; y: number };
  newPosition: { x: number; y: number };
}

export const moveNodeTool: ToolDefinition<MoveNodeArgs, MoveNodeResultData> = {
  name: 'move_node',
  description: 'Move a posição física (coordenadas X e Y em mm) de um nó gráfico ou guia técnica na prancheta.',
  parameters: {
    type: 'object',
    properties: {
      nodeId: {
        type: 'string',
        description: 'ID do nó a ser movido.',
      },
      x_mm: {
        type: 'number',
        description: 'Coordenada X em milímetros (ou deslocamento delta X se relative for verdadeiro).',
      },
      y_mm: {
        type: 'number',
        description: 'Coordenada Y em milímetros (ou deslocamento delta Y se relative for verdadeiro).',
      },
      relative: {
        type: 'boolean',
        description: 'Se verdadeiro, trata x_mm e y_mm como deslocamentos relativos à posição atual.',
        default: false,
      },
    },
    required: ['nodeId'],
  },
  async execute(args, context): Promise<ToolResult<MoveNodeResultData>> {
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

    if (args.x_mm === undefined && args.y_mm === undefined) {
      return {
        success: false,
        error: {
          code: 'INVALID_ARGUMENTS',
          message: 'Pelo menos uma coordenada ("x_mm" ou "y_mm") deve ser informada.',
        },
      };
    }

    if (
      (args.x_mm !== undefined && (typeof args.x_mm !== 'number' || !Number.isFinite(args.x_mm))) ||
      (args.y_mm !== undefined && (typeof args.y_mm !== 'number' || !Number.isFinite(args.y_mm)))
    ) {
      return {
        success: false,
        error: {
          code: 'INVALID_POSITION',
          message: 'As coordenadas de posição devem ser números finitos válidos.',
          details: { x_mm: args.x_mm, y_mm: args.y_mm },
        },
      };
    }

    const prevPos = {
      x: targetNode.position_mm.x,
      y: targetNode.position_mm.y,
    };

    let targetX = prevPos.x;
    let targetY = prevPos.y;

    if (args.relative) {
      if (args.x_mm !== undefined) targetX += args.x_mm;
      if (args.y_mm !== undefined) targetY += args.y_mm;
    } else {
      if (args.x_mm !== undefined) targetX = args.x_mm;
      if (args.y_mm !== undefined) targetY = args.y_mm;
    }

    targetX = roundPrecision(targetX, 2);
    targetY = roundPrecision(targetY, 2);

    const nextPos = { x: targetX, y: targetY };

    let nextDoc = doc;

    if (targetNode.type === 'technical_guide') {
      const guide = targetNode as TechnicalGuideNode;
      const prevGuide = {
        ...guide,
        guidePosition_mm: guide.orientation === 'vertical' ? prevPos.x : prevPos.y,
        position_mm: prevPos,
      };

      let guideClampedX = targetX;
      let guideClampedY = targetY;
      if (guide.orientation === 'vertical') {
        guideClampedX = roundPrecision(Math.max(0, Math.min(doc.dimensions.width_mm, targetX)), 2);
        guideClampedY = 0;
      } else {
        guideClampedX = 0;
        guideClampedY = roundPrecision(Math.max(0, Math.min(doc.dimensions.height_mm, targetY)), 2);
      }

      const nextGuide = {
        ...guide,
        guidePosition_mm: guide.orientation === 'vertical' ? guideClampedX : guideClampedY,
        position_mm: { x: guideClampedX, y: guideClampedY },
      };

      const cmd = new UpdateTechnicalGuideCommand(guide.id, prevGuide, nextGuide);
      if (historyManager) {
        const res = historyManager.executeCommand(cmd, doc);
        nextDoc = res.doc;
      } else {
        nextDoc = updateTechnicalGuideNode(doc, guide.id, nextGuide);
      }
    } else if (
      targetNode.type === 'raster_image' ||
      targetNode.type === 'group' ||
      targetNode.type === 'cut_contour'
    ) {
      const cmd = new UpdatePositionCommand(targetNode.id, prevPos, nextPos);
      if (historyManager) {
        const res = historyManager.executeCommand(cmd, doc);
        nextDoc = res.doc;
      } else {
        nextDoc = updateNodePosition(doc, targetNode.id, nextPos);
      }
    } else {
      return {
        success: false,
        error: {
          code: 'INVALID_NODE_TYPE',
          message: `Nós do tipo "${targetNode.type}" não podem ser movidos individualmente.`,
        },
      };
    }

    if (setDoc) {
      setDoc(nextDoc);
    }

    return {
      success: true,
      doc: nextDoc,
      message: `Nó "${targetNode.name}" movido para (${nextPos.x}, ${nextPos.y}) mm.`,
      data: {
        nodeId: targetNode.id,
        nodeName: targetNode.name,
        prevPosition: prevPos,
        newPosition: nextPos,
      },
    };
  },
};
