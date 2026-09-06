/**
 * Tool: resize_node
 *
 * Redimensiona as dimensões físicas em milímetros de um nó gráfico do PDM.
 */

import { ToolDefinition, ToolResult } from '../types';
import { RasterNode, VectorGroupNode, CutContourNode } from '../../pdm/types';
import { UpdateDimensionsCommand } from '../../commands/types';
import { roundPrecision } from '../../pdm/units';
import { updateNodeDimensions } from '../../pdm/document';

export interface ResizeNodeArgs {
  nodeId: string;
  width_mm?: number;
  height_mm?: number;
  keepAspectRatio?: boolean;
}

export interface ResizeNodeResultData {
  nodeId: string;
  nodeName: string;
  prevDimensions: {
    physicalWidth_mm: number;
    physicalHeight_mm: number;
    aspectRatio?: number;
  };
  newDimensions: {
    physicalWidth_mm: number;
    physicalHeight_mm: number;
    aspectRatio?: number;
  };
}

export const resizeNodeTool: ToolDefinition<ResizeNodeArgs, ResizeNodeResultData> = {
  name: 'resize_node',
  description: 'Redimensiona as dimensões físicas (largura e altura em mm) de um nó gráfico (raster, vetor ou faca de corte).',
  parameters: {
    type: 'object',
    properties: {
      nodeId: {
        type: 'string',
        description: 'ID do nó gráfico a ser redimensionado.',
      },
      width_mm: {
        type: 'number',
        description: 'Nova largura física em milímetros (deve ser > 0).',
      },
      height_mm: {
        type: 'number',
        description: 'Nova altura física em milímetros (deve ser > 0).',
      },
      keepAspectRatio: {
        type: 'boolean',
        description: 'Se verdadeiro, preserva a proporção original caso apenas uma dimensão seja fornecida.',
        default: false,
      },
    },
    required: ['nodeId'],
  },
  async execute(args, context): Promise<ToolResult<ResizeNodeResultData>> {
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

    if (
      targetNode.type !== 'raster_image' &&
      targetNode.type !== 'group' &&
      targetNode.type !== 'cut_contour'
    ) {
      return {
        success: false,
        error: {
          code: 'INVALID_NODE_TYPE',
          message: `O nó "${targetNode.name}" é do tipo "${targetNode.type}". Apenas nós do tipo raster_image, group ou cut_contour podem ser redimensionados.`,
        },
      };
    }

    const node = targetNode as RasterNode | VectorGroupNode | CutContourNode;

    if (args.width_mm === undefined && args.height_mm === undefined) {
      return {
        success: false,
        error: {
          code: 'INVALID_ARGUMENTS',
          message: 'Pelo menos uma dimensão ("width_mm" ou "height_mm") deve ser informada.',
        },
      };
    }

    if (
      (args.width_mm !== undefined && (typeof args.width_mm !== 'number' || !Number.isFinite(args.width_mm) || args.width_mm <= 0)) ||
      (args.height_mm !== undefined && (typeof args.height_mm !== 'number' || !Number.isFinite(args.height_mm) || args.height_mm <= 0))
    ) {
      return {
        success: false,
        error: {
          code: 'INVALID_DIMENSIONS',
          message: 'As dimensões físicas devem ser números finitos estritamente maiores que zero.',
          details: { width_mm: args.width_mm, height_mm: args.height_mm },
        },
      };
    }

    const prevW = node.physicalWidth_mm;
    const prevH = node.physicalHeight_mm;
    const currentRatio =
      node.aspectRatio ||
      (prevH > 0 ? prevW / prevH : 1) ||
      1;

    let targetW = prevW;
    let targetH = prevH;

    if (args.width_mm !== undefined && args.height_mm !== undefined) {
      targetW = roundPrecision(args.width_mm, 2);
      targetH = roundPrecision(args.height_mm, 2);
    } else if (args.width_mm !== undefined) {
      targetW = roundPrecision(args.width_mm, 2);
      targetH = args.keepAspectRatio
        ? roundPrecision(targetW / currentRatio, 2)
        : prevH;
    } else if (args.height_mm !== undefined) {
      targetH = roundPrecision(args.height_mm, 2);
      targetW = args.keepAspectRatio
        ? roundPrecision(targetH * currentRatio, 2)
        : prevW;
    }

    const prevDims = {
      physicalWidth_mm: prevW,
      physicalHeight_mm: prevH,
      aspectRatio: node.aspectRatio ?? currentRatio,
    };

    const nextDims = {
      physicalWidth_mm: targetW,
      physicalHeight_mm: targetH,
      aspectRatio: roundPrecision(targetW / targetH, 4),
    };

    const cmd = new UpdateDimensionsCommand(node.id, prevDims, nextDims);

    let nextDoc = doc;
    if (historyManager) {
      const res = historyManager.executeCommand(cmd, doc);
      nextDoc = res.doc;
    } else {
      nextDoc = updateNodeDimensions(doc, node.id, {
        physicalWidth_mm: targetW,
        physicalHeight_mm: targetH,
        keepAspectRatio: false,
      });
    }

    if (setDoc) {
      setDoc(nextDoc);
    }

    return {
      success: true,
      doc: nextDoc,
      message: `Nó "${node.name}" redimensionado para ${targetW} × ${targetH} mm.`,
      data: {
        nodeId: node.id,
        nodeName: node.name,
        prevDimensions: prevDims,
        newDimensions: nextDims,
      },
    };
  },
};
