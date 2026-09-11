/**
 * Tool: remove_invisible_vector_objects
 *
 * Detecta e remove deterministicamente objetos vetoriais tecnicamente invisíveis
 * (sem preenchimento e sem traço, opacidade zero, visibilidade desativada ou paths vazios).
 * NUNCA remove objetos brancos (#ffffff) ou arte visível.
 */

import { ToolDefinition, ToolResult } from '../types';
import { DocumentNode, VectorPathNode, VectorGroupNode } from '../../pdm/types';
import {
  RemoveInvisibleVectorObjectsCommand,
  RemovedInvisibleNodesState,
} from '../../commands/types';

export interface RemoveInvisibleVectorObjectsArgs {
  targetNodeId?: string;
  removeEmptyGroups?: boolean;
}

export interface RemoveInvisibleVectorObjectsResultData {
  removedCount: number;
  removedNodeIds: string[];
  removedNodeNames: string[];
  affectedGroupIds: string[];
}

/**
 * Checa deterministicamente se um nó vetorial é invisível.
 */
export function isVectorPathInvisible(pathNode: VectorPathNode): boolean {
  if (pathNode.visible === false) return true;
  if (typeof pathNode.opacity === 'number' && pathNode.opacity <= 0) return true;

  const fill = pathNode.fill?.trim().toLowerCase();
  const stroke = pathNode.stroke?.trim().toLowerCase();
  const strokeWidth = pathNode.strokeWidth_mm ?? 0;

  const noFill = !fill || fill === 'none' || fill === 'transparent';
  const noStroke = !stroke || stroke === 'none' || stroke === 'transparent' || strokeWidth <= 0;

  if (noFill && noStroke) {
    return true;
  }

  const d = pathNode.d?.trim();
  if (!d) {
    return true;
  }

  return false;
}

export const removeInvisibleVectorObjectsTool: ToolDefinition<
  RemoveInvisibleVectorObjectsArgs,
  RemoveInvisibleVectorObjectsResultData
> = {
  name: 'remove_invisible_vector_objects',
  description:
    'Detecta e remove com segurança objetos e traçados vetoriais tecnicamente invisíveis (sem cor, sem traço, opacidade zero ou vazios).',
  parameters: {
    type: 'object',
    properties: {
      targetNodeId: {
        type: 'string',
        description:
          'ID opcional de um nó ou grupo específico para limpeza. Se omitido, inspeciona todo o documento.',
      },
      removeEmptyGroups: {
        type: 'boolean',
        description: 'Se grupos que ficarem sem filhos devem ser removidos (padrão: true).',
      },
    },
  },
  async execute(args, context): Promise<ToolResult<RemoveInvisibleVectorObjectsResultData>> {
    const { doc, historyManager, setDoc } = context;
    const targetNodeId = args?.targetNodeId;
    const removeEmptyGroups = args?.removeEmptyGroups !== false;

    const removedNodes: DocumentNode[] = [];
    const removedIds = new Set<string>();
    const parentGroupUpdates: { groupId: string; prevChildrenIds: string[]; nextChildrenIds: string[] }[] = [];

    const allNodes = Object.values(doc.nodes || {});

    // Se alvo específico foi fornecido
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
        const path = targetNode as VectorPathNode;
        if (isVectorPathInvisible(path)) {
          removedNodes.push(path);
          removedIds.add(path.id);

          if (path.parentId && doc.nodes[path.parentId]?.type === 'group') {
            const parent = doc.nodes[path.parentId] as VectorGroupNode;
            parentGroupUpdates.push({
              groupId: parent.id,
              prevChildrenIds: [...parent.childrenIds],
              nextChildrenIds: parent.childrenIds.filter((id) => id !== path.id),
            });
          }
        }
      } else if (targetNode.type === 'group') {
        const group = targetNode as VectorGroupNode;
        const groupChildren = (group.childrenIds || [])
          .map((id) => doc.nodes[id])
          .filter((n): n is VectorPathNode => !!n && n.type === 'vector_path');

        const invisibleChildren = groupChildren.filter(isVectorPathInvisible);
        for (const child of invisibleChildren) {
          removedNodes.push(child);
          removedIds.add(child.id);
        }

        const remainingChildrenIds = group.childrenIds.filter((id) => !removedIds.has(id));
        if (invisibleChildren.length > 0) {
          parentGroupUpdates.push({
            groupId: group.id,
            prevChildrenIds: [...group.childrenIds],
            nextChildrenIds: remainingChildrenIds,
          });
        }

        if (removeEmptyGroups && remainingChildrenIds.length === 0) {
          removedNodes.push(group);
          removedIds.add(group.id);
        }
      }
    } else {
      // Inspecionar todos os nós vetoriais do documento
      const pathNodes = allNodes.filter((n): n is VectorPathNode => n.type === 'vector_path');
      const invisiblePaths = pathNodes.filter(isVectorPathInvisible);

      for (const path of invisiblePaths) {
        removedNodes.push(path);
        removedIds.add(path.id);
      }

      // Atualizar grupos afetados
      const groupNodes = allNodes.filter((n): n is VectorGroupNode => n.type === 'group');
      for (const group of groupNodes) {
        const hasRemovedChild = group.childrenIds.some((id) => removedIds.has(id));
        if (hasRemovedChild) {
          const remaining = group.childrenIds.filter((id) => !removedIds.has(id));
          parentGroupUpdates.push({
            groupId: group.id,
            prevChildrenIds: [...group.childrenIds],
            nextChildrenIds: remaining,
          });

          if (removeEmptyGroups && remaining.length === 0) {
            removedNodes.push(group);
            removedIds.add(group.id);
          }
        }
      }
    }

    if (removedNodes.length === 0) {
      return {
        success: true,
        doc,
        message: 'Nenhum objeto vetorial invisível encontrado no documento.',
        data: {
          removedCount: 0,
          removedNodeIds: [],
          removedNodeNames: [],
          affectedGroupIds: [],
        },
      };
    }

    try {
      const state: RemovedInvisibleNodesState = {
        removedNodes,
        parentGroupUpdates,
      };

      const cmd = new RemoveInvisibleVectorObjectsCommand(
        state,
        `Remover ${removedNodes.length} ${removedNodes.length === 1 ? 'objeto invisível' : 'objetos invisíveis'}`
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

      const affectedGroupIds = parentGroupUpdates.map((u) => u.groupId);

      return {
        success: true,
        doc: nextDoc,
        message: `${removedNodes.length} ${removedNodes.length === 1 ? 'objeto vetorial invisível removido' : 'objetos vetoriais invisíveis removidos'} com sucesso.`,
        data: {
          removedCount: removedNodes.length,
          removedNodeIds: removedNodes.map((n) => n.id),
          removedNodeNames: removedNodes.map((n) => n.name),
          affectedGroupIds,
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao remover objetos invisíveis.';
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
