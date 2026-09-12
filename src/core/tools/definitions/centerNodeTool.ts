/**
 * Tool: center_node
 *
 * Centraliza um nó no plano físico da prancheta.
 */

import { ToolDefinition, ToolResult } from '../types';

export interface CenterNodeArgs {
  sourceNodeId?: string;
}

export interface CenterNodeResultData {
  nodeId: string;
  position_mm: { x: number; y: number };
}

export const centerNodeTool: ToolDefinition<CenterNodeArgs, CenterNodeResultData> = {
  name: 'center_node',
  description: 'Centraliza um objeto no centro físico da prancheta.',
  parameters: {
    type: 'object',
    properties: {
      sourceNodeId: {
        type: 'string',
        description: 'ID do nó a ser centralizado (opcional; se omitido, usa o nó selecionado).',
      },
    },
  },
  async execute(args, context): Promise<ToolResult<CenterNodeResultData>> {
    const { doc, setDoc } = context;
    const nodeId = args?.sourceNodeId || context.selectedNodeId || doc.rootNodeIds[0];
    const targetNode = doc.nodes[nodeId];

    if (!targetNode) {
      return {
        success: false,
        error: { code: 'NODE_NOT_FOUND', message: 'Nenhum nó foi encontrado para centralização.' },
      };
    }

    const w_mm = (targetNode as any).physicalWidth_mm || 50;
    const h_mm = (targetNode as any).physicalHeight_mm || 50;

    const newX = Number(((doc.dimensions.width_mm - w_mm) / 2).toFixed(2));
    const newY = Number(((doc.dimensions.height_mm - h_mm) / 2).toFixed(2));

    const updatedNode = {
      ...targetNode,
      position_mm: { x: newX, y: newY },
    };

    const updatedNodes: Record<string, any> = {
      ...doc.nodes,
      [nodeId]: updatedNode,
    };

    if (targetNode.type === 'raster_image' || targetNode.type === 'group') {
      for (const n of Object.values(doc.nodes)) {
        if (!n) continue;
        if (n.type === 'group' && (n as any).sourceRasterNodeId === nodeId) {
          updatedNodes[n.id] = {
            ...n,
            position_mm: { x: newX, y: newY },
          };
        } else if (n.type === 'cut_contour' && (n as any).sourceNodeId === nodeId) {
          const offset = (n as any).offset_mm ?? 2;
          updatedNodes[n.id] = {
            ...n,
            position_mm: { x: Number((newX - offset).toFixed(2)), y: Number((newY - offset).toFixed(2)) },
          };
        }
      }
    }

    const nextDoc = {
      ...doc,
      nodes: updatedNodes,
    };

    if (setDoc) setDoc(nextDoc);

    return {
      success: true,
      doc: nextDoc,
      message: `Objeto "${targetNode.name}" centralizado na prancheta (${newX} mm, ${newY} mm).`,
      reply: `Objeto "${targetNode.name}" centralizado na prancheta (${newX} mm, ${newY} mm).`,
      data: { nodeId, position_mm: { x: newX, y: newY } },
    };
  },
};
