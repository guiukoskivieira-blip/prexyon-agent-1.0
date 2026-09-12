/**
 * Prexyon Agent — Target Resolver
 *
 * Resolve referências de alvo (SELECTED_OBJECT, DOCUMENT, ARTBOARD, NODE)
 * deterministicamente contra o estado atual do PrexyonDocument (PDM).
 */

import { PrexyonDocument, DocumentNode } from '../../pdm/types';
import { TargetReference, PlannedAction } from './types';

export interface ResolvedTarget {
  nodeId: string | null;
  node?: DocumentNode;
  isDocumentLevel: boolean;
  error?: string;
}

/**
 * Resolve a referência de alvo fornecida para um nó real ou documento.
 */
export function resolveTargetReference(
  target: TargetReference | undefined,
  doc: PrexyonDocument,
  selectedNodeId?: string
): ResolvedTarget {
  if (!doc) {
    return { nodeId: null, isDocumentLevel: false, error: 'Documento PDM não fornecido.' };
  }

  const nodes = Object.values(doc.nodes || {});
  const refType = target?.type || (selectedNodeId ? 'SELECTED_OBJECT' : 'DOCUMENT');

  if (refType === 'DOCUMENT' || refType === 'ARTBOARD') {
    return { nodeId: null, isDocumentLevel: true };
  }

  if (target && refType === 'NODE' && 'nodeId' in target) {
    const node = doc.nodes[target.nodeId];
    if (!node) {
      return {
        nodeId: target.nodeId,
        isDocumentLevel: false,
        error: `Nó com ID "${target.nodeId}" não foi encontrado no documento.`,
      };
    }
    return { nodeId: node.id, node, isDocumentLevel: false };
  }

  if (refType === 'SELECTED_OBJECT') {
    // 1. Tenta o nó explicitamente selecionado
    if (selectedNodeId) {
      if (doc.nodes[selectedNodeId]) {
        const node = doc.nodes[selectedNodeId];
        return { nodeId: node.id, node, isDocumentLevel: false };
      }
      return {
        nodeId: selectedNodeId,
        isDocumentLevel: false,
        error: `Nó com ID "${selectedNodeId}" não foi encontrado no documento.`,
      };
    }

    // 2. Se há exatamente 1 nó no documento, resolve deterministicamente para ele
    if (nodes.length === 1) {
      const node = nodes[0];
      return { nodeId: node.id, node, isDocumentLevel: false };
    }

    // 3. Procura grupo vetorial prioritário ou raster
    const vectorGroup = nodes.find((n) => n.type === 'group' || (n as any).type === 'vector_group');
    if (vectorGroup) {
      return { nodeId: vectorGroup.id, node: vectorGroup, isDocumentLevel: false };
    }

    const rasterNode = nodes.find((n) => n.type === 'raster_image' || (n as any).type === 'raster');
    if (rasterNode) {
      return { nodeId: rasterNode.id, node: rasterNode, isDocumentLevel: false };
    }

    if (nodes.length > 0) {
      const first = nodes[0];
      return { nodeId: first.id, node: first, isDocumentLevel: false };
    }

    return {
      nodeId: null,
      isDocumentLevel: false,
      error: 'Nenhum objeto selecionado ou elemento gráfico encontrado na prancheta.',
    };
  }

  return { nodeId: null, isDocumentLevel: false };
}

/**
 * Injeta o ID do nó resolvido nos argumentos de uma ação planejada caso a ferramenta exija nodeId.
 */
export function injectResolvedNodeIdIntoAction(action: PlannedAction, resolvedNodeId: string | null): PlannedAction {
  if (!resolvedNodeId) return action;

  const updatedArgs = { ...action.arguments };
  const toolsRequiringNodeId = [
    'resize_node',
    'vectorize_raster',
    'create_cut_contour',
    'update_cut_contour',
    'center_cut_contour',
    'close_cut_contour',
    'remove_redundant_vector_points',
    'simplify_vector_path',
    'remove_background',
    'center_node',
    'fit_artboard_to_artwork',
    'flip_node_horizontal',
  ];

  if (toolsRequiringNodeId.includes(action.tool)) {
    if (!updatedArgs.nodeId && !updatedArgs.node_id && !updatedArgs.sourceNodeId) {
      if (action.tool === 'create_cut_contour') {
        updatedArgs.sourceNodeId = resolvedNodeId;
      } else {
        updatedArgs.nodeId = resolvedNodeId;
      }
    }
  }

  return {
    ...action,
    arguments: updatedArgs,
  };
}
