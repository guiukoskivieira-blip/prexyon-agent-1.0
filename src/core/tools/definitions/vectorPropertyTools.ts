/**
 * Prexyon Vector Object Property & Manipulation Tools (ETAPA 8.30)
 *
 * Fornece ferramentas determinísticas para seleção por cor/propriedade,
 * substituição de preenchimento/traço, agrupamento/desagrupamento e exclusão em lote.
 */

import { ToolDefinition, ToolResult } from '../types';
import { VectorPathNode, VectorGroupNode, DocumentNode } from '../../pdm/types';
import {
  ChangeFillColorCommand,
  GroupNodesCommand,
  UngroupNodeCommand,
  DeleteMultipleNodesCommand,
} from '../../commands/types';
import {
  resolveDocumentFillsForColorFamily,
  getCanonicalHexForColorName,
  normalizeColorWord,
} from '../../agent/vectorColorResolver';

// ==========================================
// 1. SELECT BY FILL COLOR
// ==========================================
export interface SelectByFillColorArgs {
  colorHex: string;
  targetGroupId?: string;
  exactMatch?: boolean;
}

export interface SelectByFillColorResultData {
  colorHex: string;
  matchedCount: number;
  matchedNodeIds: string[];
}

export const selectByFillColorTool: ToolDefinition<SelectByFillColorArgs, SelectByFillColorResultData> = {
  name: 'select_by_fill_color',
  description: 'Localiza e seleciona todos os objetos vetoriais com a cor de preenchimento especificada.',
  parameters: {
    type: 'object',
    properties: {
      colorHex: { type: 'string', description: 'Cor em formato hexadecimal (ex: #ffffff, #ff313d, #000000) ou nome da cor.' },
      targetGroupId: { type: 'string', description: 'ID opcional do grupo para restringir a busca.' },
      exactMatch: { type: 'boolean', description: 'Se true (padrão), compara valor exato ignorando maiúsculas.' },
    },
    required: ['colorHex'],
  },
  async execute(args, context) {
    const doc = context.doc;

    // Normalização defensiva de argumentos (HOTFIX 8.30.8)
    const rawColor =
      args?.colorHex ??
      (args as any)?.color ??
      (args as any)?.fillColor ??
      (args as any)?.fill ??
      (args as any)?.hex;

    if (!rawColor || typeof rawColor !== 'string' || !rawColor.trim()) {
      return {
        success: false,
        error: {
          code: 'INVALID_TOOL_ARGUMENT',
          message: 'A ferramenta "select_by_fill_color" requer o argumento obrigatório "colorHex" não vazio.',
        },
      };
    }

    let targetHex = rawColor.trim().toLowerCase();
    // Se o argumento for um nome de cor natural (ex: "vermelho", "red", "azul") ou hex sem '#'
    if (!targetHex.startsWith('#')) {
      const family = normalizeColorWord(targetHex);
      if (family) {
        const resolved = resolveDocumentFillsForColorFamily(doc, family);
        if (resolved.length > 0) {
          targetHex = resolved[0];
        } else {
          targetHex = getCanonicalHexForColorName(family);
        }
      } else if (/^[0-9a-f]{6}$/i.test(targetHex)) {
        targetHex = `#${targetHex}`;
      }
    }

    const matchedNodeIds: string[] = [];
    const nodesToCheck: string[] = args.targetGroupId
      ? (doc.nodes[args.targetGroupId] as VectorGroupNode)?.childrenIds || []
      : Object.keys(doc.nodes);

    for (const id of nodesToCheck) {
      const node = doc.nodes[id];
      if (node && node.type === 'vector_path') {
        const path = node as VectorPathNode;
        if (path.fill && path.fill.trim().toLowerCase() === targetHex) {
          matchedNodeIds.push(id);
        }
      }
    }

    return {
      success: true,
      doc,
      selectedNodeId: matchedNodeIds[0] ?? null,
      selectedNodeIds: matchedNodeIds,
      data: {
        colorHex: targetHex,
        matchedCount: matchedNodeIds.length,
        matchedNodeIds,
      },
      message: matchedNodeIds.length > 0
        ? `Encontrados ${matchedNodeIds.length} objeto(s) com preenchimento ${targetHex}.`
        : `Nenhum objeto encontrado com preenchimento ${targetHex}.`,
    };
  },
};

// ==========================================
// 2. REPLACE FILL COLOR
// ==========================================
export interface ReplaceFillColorArgs {
  nodeIds?: string[];
  fromColorHex?: string;
  toColorHex: string;
}

export interface ReplaceFillColorResultData {
  modifiedCount: number;
  affectedNodeIds: string[];
  toColorHex: string;
}

export const replaceFillColorTool: ToolDefinition<ReplaceFillColorArgs, ReplaceFillColorResultData> = {
  name: 'replace_fill_color',
  description: 'Altera a cor de preenchimento dos nós especificados (ou de todos os nós com determinada cor de origem).',
  parameters: {
    type: 'object',
    properties: {
      nodeIds: { type: 'array', items: { type: 'string', description: 'ID do nó' }, description: 'Lista de IDs dos nós a modificar.' },
      fromColorHex: { type: 'string', description: 'Cor de origem a ser substituída (se nodeIds não for fornecido).' },
      toColorHex: { type: 'string', description: 'Nova cor de preenchimento em hexadecimal.' },
    },
    required: ['toColorHex'],
  },
  async execute(args, context): Promise<ToolResult<ReplaceFillColorResultData>> {
    const doc = context.doc;

    // Normalização defensiva de toColorHex (HOTFIX 8.30.8)
    const rawToColor =
      args?.toColorHex ??
      (args as any)?.toColor ??
      (args as any)?.to ??
      (args as any)?.nextFill ??
      (args as any)?.color;

    if (!rawToColor || typeof rawToColor !== 'string' || !rawToColor.trim()) {
      return {
        success: false,
        error: {
          code: 'INVALID_TOOL_ARGUMENT',
          message: 'A ferramenta "replace_fill_color" requer o argumento obrigatório "toColorHex" não vazio.',
        },
      };
    }

    let toColorHex = rawToColor.trim().toLowerCase();
    if (!toColorHex.startsWith('#')) {
      const family = normalizeColorWord(toColorHex);
      toColorHex = family ? getCanonicalHexForColorName(family) : (toColorHex.startsWith('#') ? toColorHex : `#${toColorHex}`);
    }

    // Normalização defensiva de fromColorHex
    const rawFromColor =
      args?.fromColorHex ??
      (args as any)?.fromColor ??
      (args as any)?.from ??
      (args as any)?.prevFill;

    let fromColorHex = rawFromColor && typeof rawFromColor === 'string' && rawFromColor.trim()
      ? rawFromColor.trim().toLowerCase()
      : undefined;

    if (fromColorHex && !fromColorHex.startsWith('#')) {
      const srcFamily = normalizeColorWord(fromColorHex);
      if (srcFamily) {
        const resolved = resolveDocumentFillsForColorFamily(doc, srcFamily);
        if (resolved.length > 0) {
          fromColorHex = resolved[0];
        } else {
          fromColorHex = getCanonicalHexForColorName(srcFamily);
        }
      } else if (/^[0-9a-f]{6}$/i.test(fromColorHex)) {
        fromColorHex = `#${fromColorHex}`;
      }
    }

    const targetIds: string[] = [];

    if (args.nodeIds && Array.isArray(args.nodeIds) && args.nodeIds.length > 0) {
      targetIds.push(...args.nodeIds);
    } else if (fromColorHex) {
      for (const [id, node] of Object.entries(doc.nodes)) {
        if (node.type === 'vector_path' && (node as VectorPathNode).fill?.trim().toLowerCase() === fromColorHex) {
          targetIds.push(id);
        }
      }
    } else {
      return {
        success: false,
        error: {
          code: 'INVALID_TOOL_ARGUMENT',
          message: 'A ferramenta "replace_fill_color" requer "nodeIds" ou "fromColorHex".',
        },
      };
    }

    if (targetIds.length === 0) {
      return {
        success: false,
        error: {
          code: 'NODE_NOT_FOUND',
          message: 'Nenhum nó encontrado para alteração de cor.',
        },
      };
    }

    const affectedNodes: Array<{ nodeId: string; prevFill: string | null; nextFill: string | null }> = [];

    for (const id of targetIds) {
      const node = doc.nodes[id] as VectorPathNode | undefined;
      if (node && node.type === 'vector_path') {
        affectedNodes.push({
          nodeId: id,
          prevFill: node.fill,
          nextFill: toColorHex,
        });
      }
    }

    const command = new ChangeFillColorCommand(affectedNodes);
    let finalDoc = doc;
    if (context.historyManager) {
      const res = context.historyManager.executeCommand(command, doc);
      finalDoc = res.doc;
    } else {
      finalDoc = command.execute(doc).doc;
    }
    if (context.setDoc) {
      context.setDoc(finalDoc);
    }

    return {
      success: true,
      doc: finalDoc,
      data: {
        modifiedCount: affectedNodes.length,
        affectedNodeIds: affectedNodes.map((a) => a.nodeId),
        toColorHex,
      },
      message: `Cor de preenchimento alterada para ${toColorHex} em ${affectedNodes.length} objeto(s).`,
    };
  },
};

// ==========================================
// 3. UNGROUP SELECTED NODE
// ==========================================
export interface UngroupSelectedNodeArgs {
  groupId: string;
}

export interface UngroupSelectedNodeResultData {
  groupId: string;
  ungroupedCount: number;
  ungroupedNodeIds: string[];
}

export const ungroupSelectedNodeTool: ToolDefinition<UngroupSelectedNodeArgs, UngroupSelectedNodeResultData> = {
  name: 'ungroup_selected_node',
  description: 'Desagrupa um nó de grupo no PDM, promovendo todos os seus filhos a nós raiz independentes.',
  parameters: {
    type: 'object',
    properties: {
      groupId: { type: 'string', description: 'ID do grupo a desagrupar.' },
    },
    required: ['groupId'],
  },
  async execute(args, context): Promise<ToolResult<UngroupSelectedNodeResultData>> {
    const doc = context.doc;
    const rawGroupId = args?.groupId ?? (args as any)?.nodeId ?? (args as any)?.id;
    if (!rawGroupId || typeof rawGroupId !== 'string' || !rawGroupId.trim()) {
      return {
        success: false,
        error: {
          code: 'INVALID_TOOL_ARGUMENT',
          message: 'A ferramenta "ungroup_selected_node" requer o argumento obrigatório "groupId" não vazio.',
        },
      };
    }
    const groupId = rawGroupId.trim();
    const groupNode = doc.nodes[groupId] as VectorGroupNode | undefined;

    if (!groupNode || groupNode.type !== 'group') {
      return {
        success: false,
        error: {
          code: 'NODE_NOT_FOUND',
          message: `Grupo "${groupId}" não encontrado no documento.`,
        },
      };
    }

    const childNodes = (groupNode.childrenIds || [])
      .map((id) => doc.nodes[id] as VectorPathNode)
      .filter((n) => !!n);

    const command = new UngroupNodeCommand(groupNode, childNodes);
    let finalDoc = doc;
    if (context.historyManager) {
      const res = context.historyManager.executeCommand(command, doc);
      finalDoc = res.doc;
    } else {
      finalDoc = command.execute(doc).doc;
    }
    if (context.setDoc) {
      context.setDoc(finalDoc);
    }

    return {
      success: true,
      doc: finalDoc,
      data: {
        groupId,
        ungroupedCount: childNodes.length,
        ungroupedNodeIds: childNodes.map((c) => c.id),
      },
      message: `Grupo desagrupado com sucesso: ${childNodes.length} elementos agora são individualmente editáveis.`,
    };
  },
};

// ==========================================
// 4. GROUP SELECTED NODES
// ==========================================
export interface GroupSelectedNodesArgs {
  nodeIds: string[];
  groupName?: string;
}

export interface GroupSelectedNodesResultData {
  groupId: string;
  groupedCount: number;
  groupedNodeIds: string[];
}

export const groupSelectedNodesTool: ToolDefinition<GroupSelectedNodesArgs, GroupSelectedNodesResultData> = {
  name: 'group_selected_nodes',
  description: 'Agrupa uma lista de nós do PDM sob um novo VectorGroupNode.',
  parameters: {
    type: 'object',
    properties: {
      nodeIds: { type: 'array', items: { type: 'string', description: 'ID do nó' }, description: 'IDs dos nós a agrupar.' },
      groupName: { type: 'string', description: 'Nome legível para o novo grupo.' },
    },
    required: ['nodeIds'],
  },
  async execute(args, context): Promise<ToolResult<GroupSelectedNodesResultData>> {
    const doc = context.doc;
    const nodeIds = args?.nodeIds ?? (args as any)?.nodes;
    if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) {
      return {
        success: false,
        error: {
          code: 'INVALID_TOOL_ARGUMENT',
          message: 'A ferramenta "group_selected_nodes" requer o argumento "nodeIds" com ao menos um ID.',
        },
      };
    }

    const command = new GroupNodesCommand(nodeIds, args.groupName || 'Novo Grupo');
    let finalDoc = doc;
    if (context.historyManager) {
      const res = context.historyManager.executeCommand(command, doc);
      finalDoc = res.doc;
    } else {
      finalDoc = command.execute(doc).doc;
    }
    if (context.setDoc) {
      context.setDoc(finalDoc);
    }

    return {
      success: true,
      doc: finalDoc,
      data: {
        groupId: command.groupNodeId || '',
        groupedCount: nodeIds.length,
        groupedNodeIds: nodeIds,
      },
      message: `${nodeIds.length} objeto(s) agrupados com sucesso sob o grupo "${args.groupName || 'Novo Grupo'}".`,
    };
  },
};

// ==========================================
// 5. DELETE SELECTED NODES
// ==========================================
export interface DeleteSelectedNodesArgs {
  nodeIds: string[];
}

export interface DeleteSelectedNodesResultData {
  deletedCount: number;
  deletedNodeIds: string[];
}

export const deleteSelectedNodesTool: ToolDefinition<DeleteSelectedNodesArgs, DeleteSelectedNodesResultData> = {
  name: 'delete_selected_nodes',
  description: 'Remove múltiplos nós do PDM com suporte completo a Undo/Redo.',
  parameters: {
    type: 'object',
    properties: {
      nodeIds: { type: 'array', items: { type: 'string', description: 'ID do nó' }, description: 'Lista de IDs dos nós a excluir.' },
    },
    required: ['nodeIds'],
  },
  async execute(args, context): Promise<ToolResult<DeleteSelectedNodesResultData>> {
    const doc = context.doc;
    const nodeIds = args?.nodeIds ?? (args as any)?.nodes;
    if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) {
      return {
        success: false,
        error: {
          code: 'INVALID_TOOL_ARGUMENT',
          message: 'A ferramenta "delete_selected_nodes" requer o argumento "nodeIds" com ao menos um ID.',
        },
      };
    }

    const deletedNodes: DocumentNode[] = [];
    for (const id of nodeIds) {
      const node = doc.nodes[id];
      if (node) deletedNodes.push(node);
    }

    if (deletedNodes.length === 0) {
      return {
        success: false,
        error: {
          code: 'NODE_NOT_FOUND',
          message: 'Nenhum nó válido encontrado para exclusão.',
        },
      };
    }

    const command = new DeleteMultipleNodesCommand(deletedNodes);
    let finalDoc = doc;
    if (context.historyManager) {
      const res = context.historyManager.executeCommand(command, doc);
      finalDoc = res.doc;
    } else {
      finalDoc = command.execute(doc).doc;
    }
    if (context.setDoc) {
      context.setDoc(finalDoc);
    }

    return {
      success: true,
      doc: finalDoc,
      data: {
        deletedCount: deletedNodes.length,
        deletedNodeIds: deletedNodes.map((n) => n.id),
      },
      message: `${deletedNodes.length} objeto(s) excluído(s) com sucesso.`,
    };
  },
};
