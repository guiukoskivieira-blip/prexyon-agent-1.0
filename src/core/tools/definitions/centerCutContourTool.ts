/**
 * Tool: center_cut_contour
 *
 * Centraliza geometricamente a faca de corte sobre seu vetor de origem no PDM.
 */

import { ToolDefinition, ToolResult } from '../types';
import { CutContourNode } from '../../pdm/types';
import { centerCutContourOnSource } from '../../pdm/document';
import { CenterCutContourCommand } from '../../commands/types';

export interface CenterCutContourArgs {
  nodeId: string;
}

export interface CenterCutContourResultData {
  nodeId: string;
  name: string;
  sourceNodeId: string;
  prevPosition: { x: number; y: number };
  newPosition: { x: number; y: number };
  centered: boolean;
}

export const centerCutContourTool: ToolDefinition<CenterCutContourArgs, CenterCutContourResultData> = {
  name: 'center_cut_contour',
  description: 'Centraliza geometricamente a faca de corte sobre o seu vetor de origem no PDM.',
  parameters: {
    type: 'object',
    properties: {
      nodeId: {
        type: 'string',
        description: 'ID da faca de corte (cut_contour) a ser centralizada.',
      },
    },
    required: ['nodeId'],
  },
  async execute(args, context): Promise<ToolResult<CenterCutContourResultData>> {
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
          message: `O nó "${targetNode.name}" é do tipo "${targetNode.type}". Apenas nós do tipo "cut_contour" podem ser centralizados por esta ferramenta.`,
        },
      };
    }

    const cutNode = targetNode as CutContourNode;
    const sourceNode = doc.nodes[cutNode.sourceNodeId];
    if (!sourceNode || sourceNode.type !== 'group') {
      return {
        success: false,
        error: {
          code: 'SOURCE_NODE_NOT_FOUND',
          message: `O vetor de origem (${cutNode.sourceNodeId}) vinculado a esta faca não existe no documento ou não é um grupo vetorial.`,
        },
      };
    }

    try {
      const prevCutNode = cutNode;
      const { nextCutNode } = centerCutContourOnSource(doc, cutNode.id);

      const cmd = new CenterCutContourCommand(cutNode.id, prevCutNode, nextCutNode);

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
        message: `Faca de corte "${cutNode.name}" centralizada com sucesso sobre o vetor de origem (${nextCutNode.position_mm.x}, ${nextCutNode.position_mm.y}) mm.`,
        data: {
          nodeId: cutNode.id,
          name: cutNode.name,
          sourceNodeId: cutNode.sourceNodeId,
          prevPosition: { x: prevCutNode.position_mm.x, y: prevCutNode.position_mm.y },
          newPosition: { x: nextCutNode.position_mm.x, y: nextCutNode.position_mm.y },
          centered: true,
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao centralizar faca de corte.';
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
