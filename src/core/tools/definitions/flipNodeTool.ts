/**
 * Tool: flip_node_horizontal
 *
 * Espelha horizontalmente o nó selecionado ou a arte de impressão.
 */

import { ToolDefinition, ToolResult } from '../types';

export interface FlipNodeArgs {
  sourceNodeId?: string;
}

export interface FlipNodeResultData {
  nodeId: string;
  flippedHorizontal: boolean;
}

export const flipNodeTool: ToolDefinition<FlipNodeArgs, FlipNodeResultData> = {
  name: 'flip_node_horizontal',
  description: 'Espelha um objeto ou arte horizontalmente.',
  parameters: {
    type: 'object',
    properties: {
      sourceNodeId: {
        type: 'string',
        description: 'ID do nó a ser espelhado (opcional; se omitido, usa o nó selecionado).',
      },
    },
  },
  async execute(args, context): Promise<ToolResult<FlipNodeResultData>> {
    const { doc, setDoc } = context;
    const nodeId = args?.sourceNodeId || context.selectedNodeId || doc.rootNodeIds[0];
    const targetNode = doc.nodes[nodeId];

    if (!targetNode) {
      return {
        success: false,
        error: { code: 'NODE_NOT_FOUND', message: 'Nenhum nó foi encontrado para espelhamento.' },
      };
    }

    const currentFlipped = Boolean((targetNode as any).metadata?.flippedHorizontal);
    const newFlipped = !currentFlipped;

    const updatedNode = {
      ...targetNode,
      metadata: {
        ...((targetNode as any).metadata || {}),
        flippedHorizontal: newFlipped,
      },
    };

    const nextDoc = {
      ...doc,
      nodes: { ...doc.nodes, [nodeId]: updatedNode },
    };

    if (setDoc) setDoc(nextDoc);

    return {
      success: true,
      doc: nextDoc,
      message: `Objeto "${targetNode.name}" espelhado horizontalmente com sucesso.`,
      reply: `Objeto "${targetNode.name}" espelhado horizontalmente com sucesso.`,
      data: { nodeId, flippedHorizontal: newFlipped },
    };
  },
};
