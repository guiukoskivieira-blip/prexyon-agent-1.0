/**
 * Prexyon Command Pattern Definitions (v0.2)
 *
 * Implementa comandos granulares, reversíveis e auditáveis sobre o Prexyon Document Model (PDM).
 * Cada mutação discreta de estado (importar, mover, redimensionar, vetorizar, deletar)
 * possui seu comando individual com suporte a Undo/Redo preciso.
 */

import {
  PrexyonDocument,
  RasterNode,
  VectorGroupNode,
  VectorPathNode,
  CutContourNode,
  ContourPolygon,
  DocumentNode,
  DocumentDimensions,
  Position_mm,
  BleedSettings,
  SafetyMarginSettings,
  TechnicalGuideNode,
} from '../pdm/types';
import {
  addNode,
  addVectorGroup,
  removeNode,
  updateNodeDimensions,
  updateNodePosition,
  updateArtboardDimensions,
  updateBleedSettings,
  updateSafetyMarginSettings,
  updateTechnicalGuideNode,
  ungroupNode,
  groupNodes,
  updateNodeStyle,
} from '../pdm/document';

export interface CommandResult {
  doc: PrexyonDocument;
  selectedNodeId?: string | null;
}

export interface DocumentCommand {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;

  /**
   * Aplica a mutação ao documento PDM.
   */
  execute(doc: PrexyonDocument): CommandResult;

  /**
   * Reverte a mutação, restaurando o documento ao estado anterior.
   */
  undo(doc: PrexyonDocument): CommandResult;
}

/**
 * Comando de Vetorização (VTracer -> PDM)
 * Reversível: ao desfazer, remove o VectorGroupNode e restaura a seleção no RasterNode original.
 */
export class VectorizeCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string = 'Vetorizar Imagem';
  readonly timestamp: number;

  constructor(
    public readonly groupNode: VectorGroupNode,
    public readonly pathNodes: VectorPathNode[],
    public readonly sourceRasterNodeId?: string
  ) {
    this.id = `cmd_vec_${groupNode.id}`;
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    const newDoc = addVectorGroup(doc, this.groupNode, this.pathNodes);
    return {
      doc: newDoc,
      selectedNodeId: this.groupNode.id,
    };
  }

  undo(doc: PrexyonDocument): CommandResult {
    const newDoc = removeNode(doc, this.groupNode.id);
    return {
      doc: newDoc,
      selectedNodeId: this.sourceRasterNodeId || (newDoc.rootNodeIds[0] ?? null),
    };
  }
}

/**
 * Comando de Importação de Imagem Raster
 * Reversível: ao desfazer, remove o RasterNode.
 */
export class ImportRasterCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;

  constructor(public readonly rasterNode: RasterNode) {
    this.id = `cmd_import_${rasterNode.id}`;
    this.name = `Importar ${rasterNode.name}`;
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    const newDoc = addNode(doc, this.rasterNode);
    return {
      doc: newDoc,
      selectedNodeId: this.rasterNode.id,
    };
  }

  undo(doc: PrexyonDocument): CommandResult {
    const newDoc = removeNode(doc, this.rasterNode.id);
    return {
      doc: newDoc,
      selectedNodeId: newDoc.rootNodeIds[0] ?? null,
    };
  }
}

/**
 * Comando de Transformação Completa de Nó (Posição + Dimensões)
 * Gerado ao finalizar um drag ou resize completo no Canvas.
 */
export class TransformNodeCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;

  constructor(
    public readonly nodeId: string,
    public readonly prev: {
      position_mm: Position_mm;
      physicalWidth_mm: number;
      physicalHeight_mm: number;
    },
    public readonly next: {
      position_mm: Position_mm;
      physicalWidth_mm: number;
      physicalHeight_mm: number;
    }
  ) {
    this.id = `cmd_trans_${nodeId}_${Date.now()}`;
    this.name = 'Transformar Objeto';
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    let newDoc = updateNodePosition(doc, this.nodeId, this.next.position_mm);
    if (
      this.next.physicalWidth_mm !== this.prev.physicalWidth_mm ||
      this.next.physicalHeight_mm !== this.prev.physicalHeight_mm
    ) {
      newDoc = updateNodeDimensions(newDoc, this.nodeId, {
        physicalWidth_mm: this.next.physicalWidth_mm,
        physicalHeight_mm: this.next.physicalHeight_mm,
        keepAspectRatio: false,
      });
    }
    return {
      doc: newDoc,
      selectedNodeId: this.nodeId,
    };
  }

  undo(doc: PrexyonDocument): CommandResult {
    let newDoc = updateNodePosition(doc, this.nodeId, this.prev.position_mm);
    if (
      this.next.physicalWidth_mm !== this.prev.physicalWidth_mm ||
      this.next.physicalHeight_mm !== this.prev.physicalHeight_mm
    ) {
      newDoc = updateNodeDimensions(newDoc, this.nodeId, {
        physicalWidth_mm: this.prev.physicalWidth_mm,
        physicalHeight_mm: this.prev.physicalHeight_mm,
        keepAspectRatio: false,
      });
    }
    return {
      doc: newDoc,
      selectedNodeId: this.nodeId,
    };
  }
}

/**
 * Comando de Alteração de Dimensões Físicas de Nó
 */
export class UpdateDimensionsCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;

  constructor(
    public readonly nodeId: string,
    public readonly prev: {
      physicalWidth_mm: number;
      physicalHeight_mm: number;
      aspectRatio?: number;
    },
    public readonly next: {
      physicalWidth_mm: number;
      physicalHeight_mm: number;
      aspectRatio?: number;
    }
  ) {
    this.id = `cmd_dims_${nodeId}_${Date.now()}`;
    this.name = 'Alterar Dimensões';
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    const newDoc = updateNodeDimensions(doc, this.nodeId, {
      physicalWidth_mm: this.next.physicalWidth_mm,
      physicalHeight_mm: this.next.physicalHeight_mm,
      keepAspectRatio: false,
    });
    return {
      doc: newDoc,
      selectedNodeId: this.nodeId,
    };
  }

  undo(doc: PrexyonDocument): CommandResult {
    const newDoc = updateNodeDimensions(doc, this.nodeId, {
      physicalWidth_mm: this.prev.physicalWidth_mm,
      physicalHeight_mm: this.prev.physicalHeight_mm,
      keepAspectRatio: false,
    });
    return {
      doc: newDoc,
      selectedNodeId: this.nodeId,
    };
  }
}

/**
 * Comando de Alteração de Posição Física de Nó
 */
export class UpdatePositionCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;

  constructor(
    public readonly nodeId: string,
    public readonly prevPosition: Position_mm,
    public readonly nextPosition: Position_mm
  ) {
    this.id = `cmd_pos_${nodeId}_${Date.now()}`;
    this.name = 'Mover Objeto';
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    const newDoc = updateNodePosition(doc, this.nodeId, this.nextPosition);
    return {
      doc: newDoc,
      selectedNodeId: this.nodeId,
    };
  }

  undo(doc: PrexyonDocument): CommandResult {
    const newDoc = updateNodePosition(doc, this.nodeId, this.prevPosition);
    return {
      doc: newDoc,
      selectedNodeId: this.nodeId,
    };
  }
}

/**
 * Comando de Remoção de Nó
 * Reversível: ao desfazer, restaura o nó e quaisquer nós filhos.
 */
export class DeleteNodeCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;

  constructor(
    public readonly deletedNode: DocumentNode,
    public readonly childNodes: DocumentNode[] = [],
    public readonly dependentCutNode?: CutContourNode,
    public readonly originalRootIndex?: number,
    public readonly dependentCutRootIndex?: number
  ) {
    this.id = `cmd_del_${deletedNode.id}_${Date.now()}`;
    this.name = `Remover ${deletedNode.name}`;
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    const newDoc = removeNode(doc, this.deletedNode.id);
    return {
      doc: newDoc,
      selectedNodeId: null,
    };
  }

  undo(doc: PrexyonDocument): CommandResult {
    let newDoc: PrexyonDocument = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [this.deletedNode.id]: this.deletedNode,
      },
      rootNodeIds: [...doc.rootNodeIds.filter((id) => id !== this.deletedNode.id), this.deletedNode.id],
      updatedAt: new Date().toISOString(),
    };

    if (this.childNodes.length > 0) {
      const childrenMap = { ...newDoc.nodes };
      for (const child of this.childNodes) {
        childrenMap[child.id] = child;
      }
      newDoc = {
        ...newDoc,
        nodes: childrenMap,
      };
    }

    if (this.dependentCutNode) {
      newDoc = {
        ...newDoc,
        nodes: {
          ...newDoc.nodes,
          [this.dependentCutNode.id]: this.dependentCutNode,
        },
        rootNodeIds: [...newDoc.rootNodeIds.filter((id) => id !== this.dependentCutNode!.id), this.dependentCutNode.id],
      };
    }

    return {
      doc: newDoc,
      selectedNodeId: this.deletedNode.id,
    };
  }
}

/**
 * Comando de Criação de Faca de Corte
 * Reversível: ao desfazer, remove o CutContourNode e seleciona o vetor de origem.
 */
export class CreateCutContourCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;

  constructor(public readonly cutContourNode: CutContourNode) {
    this.id = `cmd_cut_create_${cutContourNode.id}`;
    this.name = `Criar Faca (${cutContourNode.offset_mm} mm)`;
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    const newDoc = addNode(doc, this.cutContourNode);
    return {
      doc: newDoc,
      selectedNodeId: this.cutContourNode.id,
    };
  }

  undo(doc: PrexyonDocument): CommandResult {
    const newDoc = removeNode(doc, this.cutContourNode.id);
    return {
      doc: newDoc,
      selectedNodeId: this.cutContourNode.sourceNodeId,
    };
  }
}

/**
 * Comando de Remoção de Faca de Corte
 * Reversível: ao desfazer, restaura a faca de corte no documento.
 */
export class DeleteCutContourCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;

  constructor(public readonly cutContourNode: CutContourNode) {
    this.id = `cmd_cut_del_${cutContourNode.id}_${Date.now()}`;
    this.name = `Remover Faca (${cutContourNode.offset_mm} mm)`;
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    const newDoc = removeNode(doc, this.cutContourNode.id);
    return {
      doc: newDoc,
      selectedNodeId: this.cutContourNode.sourceNodeId,
    };
  }

  undo(doc: PrexyonDocument): CommandResult {
    const newDoc = addNode(doc, this.cutContourNode);
    return {
      doc: newDoc,
      selectedNodeId: this.cutContourNode.id,
    };
  }
}

/**
 * Comando de Atualização de Faca de Corte (Offset / Estilo)
 * Reversível: ao desfazer, restaura os parâmetros e contornos anteriores.
 */
export class UpdateCutContourCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;

  constructor(
    public readonly nodeId: string,
    public readonly prevNode: CutContourNode,
    public readonly nextNode: CutContourNode
  ) {
    this.id = `cmd_cut_update_${nodeId}_${Date.now()}`;
    this.name = `Alterar Faca (${nextNode.offset_mm} mm)`;
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    const newDoc: PrexyonDocument = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [this.nodeId]: this.nextNode,
      },
      updatedAt: new Date().toISOString(),
    };
    return {
      doc: newDoc,
      selectedNodeId: this.nodeId,
    };
  }

  undo(doc: PrexyonDocument): CommandResult {
    const newDoc: PrexyonDocument = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [this.nodeId]: this.prevNode,
      },
      updatedAt: new Date().toISOString(),
    };
    return {
      doc: newDoc,
      selectedNodeId: this.nodeId,
    };
  }
}

/**
 * Comando de Alteração de Espessura do Traço da Faca de Corte
 */
export class UpdateCutContourStrokeWidthCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;

  constructor(
    public readonly nodeId: string,
    public readonly prevStrokeWidth_mm: number,
    public readonly nextStrokeWidth_mm: number
  ) {
    this.id = `cmd_cut_stroke_${nodeId}_${Date.now()}`;
    this.name = `Alterar Espessura do Traço (${nextStrokeWidth_mm} mm)`;
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    const node = doc.nodes[this.nodeId] as CutContourNode | undefined;
    if (!node || node.type !== 'cut_contour') return { doc };
    const newDoc: PrexyonDocument = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [this.nodeId]: {
          ...node,
          strokeWidth_mm: this.nextStrokeWidth_mm,
        },
      },
      updatedAt: new Date().toISOString(),
    };
    return {
      doc: newDoc,
      selectedNodeId: this.nodeId,
    };
  }

  undo(doc: PrexyonDocument): CommandResult {
    const node = doc.nodes[this.nodeId] as CutContourNode | undefined;
    if (!node || node.type !== 'cut_contour') return { doc };
    const newDoc: PrexyonDocument = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [this.nodeId]: {
          ...node,
          strokeWidth_mm: this.prevStrokeWidth_mm,
        },
      },
      updatedAt: new Date().toISOString(),
    };
    return {
      doc: newDoc,
      selectedNodeId: this.nodeId,
    };
  }
}

/**
 * Comando de Visibilidade de Nó
 */
export class ToggleVisibilityCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;

  constructor(
    public readonly nodeId: string,
    public readonly prevVisible: boolean,
    public readonly nextVisible: boolean
  ) {
    this.id = `cmd_vis_${nodeId}_${Date.now()}`;
    this.name = nextVisible ? 'Exibir Objeto' : 'Ocultar Objeto';
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    const node = doc.nodes[this.nodeId];
    if (!node) return { doc };
    const newDoc: PrexyonDocument = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [this.nodeId]: {
          ...node,
          visible: this.nextVisible,
        },
      },
      updatedAt: new Date().toISOString(),
    };
    return {
      doc: newDoc,
      selectedNodeId: this.nodeId,
    };
  }

  undo(doc: PrexyonDocument): CommandResult {
    const node = doc.nodes[this.nodeId];
    if (!node) return { doc };
    const newDoc: PrexyonDocument = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [this.nodeId]: {
          ...node,
          visible: this.prevVisible,
        },
      },
      updatedAt: new Date().toISOString(),
    };
    return {
      doc: newDoc,
      selectedNodeId: this.nodeId,
    };
  }
}

/**
 * Comando de Redimensionamento da Prancheta (Artboard)
 */
export class SetArtboardDimensionsCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;

  constructor(
    public readonly prevDimensions: DocumentDimensions,
    public readonly nextDimensions: DocumentDimensions
  ) {
    this.id = `cmd_artboard_${Date.now()}`;
    this.name = `Redimensionar Prancheta (${nextDimensions.width_mm} × ${nextDimensions.height_mm} mm)`;
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    const newDoc = updateArtboardDimensions(doc, this.nextDimensions);
    return {
      doc: newDoc,
      selectedNodeId: doc.rootNodeIds[0] ?? null,
    };
  }

  undo(doc: PrexyonDocument): CommandResult {
    const newDoc = updateArtboardDimensions(doc, this.prevDimensions);
    return {
      doc: newDoc,
      selectedNodeId: doc.rootNodeIds[0] ?? null,
    };
  }
}

/**
 * Comando de Centralização de Faca de Corte na Imagem/Vetor de Origem
 */
export class CenterCutContourCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string = 'Centralizar Faca na Origem';
  readonly timestamp: number;

  constructor(
    public readonly nodeId: string,
    public readonly prevNode: CutContourNode,
    public readonly nextNode: CutContourNode
  ) {
    this.id = `cmd_cut_center_${nodeId}_${Date.now()}`;
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    const newDoc: PrexyonDocument = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [this.nodeId]: this.nextNode,
      },
      updatedAt: new Date().toISOString(),
    };
    return {
      doc: newDoc,
      selectedNodeId: this.nodeId,
    };
  }

  undo(doc: PrexyonDocument): CommandResult {
    const newDoc: PrexyonDocument = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [this.nodeId]: this.prevNode,
      },
      updatedAt: new Date().toISOString(),
    };
    return {
      doc: newDoc,
      selectedNodeId: this.nodeId,
    };
  }
}

/**
 * Comando de Atualização das Configurações de Sangria (Bleed)
 */
export class UpdateBleedSettingsCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;

  constructor(
    public readonly prevBleed: BleedSettings,
    public readonly nextBleed: BleedSettings
  ) {
    this.id = `cmd_bleed_${Date.now()}`;
    this.name = nextBleed.enabled
      ? `Sangria (${nextBleed.top_mm} mm)`
      : 'Desativar Sangria';
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    const newDoc = updateBleedSettings(doc, this.nextBleed);
    return {
      doc: newDoc,
      selectedNodeId: doc.rootNodeIds[0] ?? null,
    };
  }

  undo(doc: PrexyonDocument): CommandResult {
    const newDoc = updateBleedSettings(doc, this.prevBleed);
    return {
      doc: newDoc,
      selectedNodeId: doc.rootNodeIds[0] ?? null,
    };
  }
}

/**
 * Comando de Atualização das Configurações de Margem de Segurança (Safety Margin)
 */
export class UpdateSafetyMarginCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;

  constructor(
    public readonly prevSafety: SafetyMarginSettings,
    public readonly nextSafety: SafetyMarginSettings
  ) {
    this.id = `cmd_safety_${Date.now()}`;
    this.name = nextSafety.enabled
      ? `Margem de Segurança (${nextSafety.top_mm} mm)`
      : 'Desativar Margem de Segurança';
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    const newDoc = updateSafetyMarginSettings(doc, this.nextSafety);
    return {
      doc: newDoc,
      selectedNodeId: doc.rootNodeIds[0] ?? null,
    };
  }

  undo(doc: PrexyonDocument): CommandResult {
    const newDoc = updateSafetyMarginSettings(doc, this.prevSafety);
    return {
      doc: newDoc,
      selectedNodeId: doc.rootNodeIds[0] ?? null,
    };
  }
}

/**
 * Comando de Criação de Guia Técnica
 */
export class CreateTechnicalGuideCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;

  constructor(public readonly guideNode: TechnicalGuideNode) {
    this.id = `cmd_create_guide_${Date.now()}`;
    this.name = `Criar ${guideNode.name}`;
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    const newDoc = addNode(doc, this.guideNode);
    return {
      doc: newDoc,
      selectedNodeId: this.guideNode.id,
    };
  }

  undo(doc: PrexyonDocument): CommandResult {
    const newDoc = removeNode(doc, this.guideNode.id);
    return {
      doc: newDoc,
      selectedNodeId: null,
    };
  }
}

/**
 * Comando de Atualização de Guia Técnica
 */
export class UpdateTechnicalGuideCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;

  constructor(
    public readonly nodeId: string,
    public readonly prevGuide: TechnicalGuideNode,
    public readonly nextGuide: TechnicalGuideNode
  ) {
    this.id = `cmd_update_guide_${Date.now()}`;
    this.name = `Atualizar ${nextGuide.name}`;
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    const newDoc = updateTechnicalGuideNode(doc, this.nodeId, this.nextGuide);
    return {
      doc: newDoc,
      selectedNodeId: this.nodeId,
    };
  }

  undo(doc: PrexyonDocument): CommandResult {
    const newDoc = updateTechnicalGuideNode(doc, this.nodeId, this.prevGuide);
    return {
      doc: newDoc,
      selectedNodeId: this.nodeId,
    };
  }
}

/**
 * Comando de Exclusão de Guia Técnica
 */
export class DeleteTechnicalGuideCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;

  constructor(public readonly guideNode: TechnicalGuideNode) {
    this.id = `cmd_delete_guide_${Date.now()}`;
    this.name = `Excluir ${guideNode.name}`;
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    const newDoc = removeNode(doc, this.guideNode.id);
    return {
      doc: newDoc,
      selectedNodeId: null,
    };
  }

  undo(doc: PrexyonDocument): CommandResult {
    const newDoc = addNode(doc, this.guideNode);
    return {
      doc: newDoc,
      selectedNodeId: this.guideNode.id,
    };
  }
}

/**
 * Comando de Aplicação de Mudança de Documento pelo Agente de IA
 * Permite que mutações determinísticas do agente sejam revertidas com precisão via Undo/Redo (Ctrl+Z / Ctrl+Y).
 */
export class ApplyAgentDocumentChangeCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;

  constructor(
    private readonly prevDoc: PrexyonDocument,
    private readonly nextDoc: PrexyonDocument,
    description: string = 'Ação do Agente'
  ) {
    this.id = `cmd_agent_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.name = description;
    this.timestamp = Date.now();
  }

  execute(_currentDoc: PrexyonDocument): CommandResult {
    return {
      doc: this.nextDoc,
    };
  }

  undo(_currentDoc: PrexyonDocument): CommandResult {
    return {
      doc: this.prevDoc,
    };
  }
}

export interface RemovedInvisibleNodesState {
  removedNodes: DocumentNode[];
  parentGroupUpdates?: { groupId: string; prevChildrenIds: string[]; nextChildrenIds: string[] }[];
}

/**
 * Comando de Remoção de Objetos Vetoriais Invisíveis (Etapa 6.12)
 * Reversível: restaura os nós vetoriais e a estrutura de filhos do grupo original.
 */
export class RemoveInvisibleVectorObjectsCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;

  constructor(
    public readonly state: RemovedInvisibleNodesState,
    description: string = 'Remover Objetos Vetoriais Invisíveis'
  ) {
    this.id = `cmd_remove_invisible_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    this.name = description;
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    const nextNodes = { ...doc.nodes };
    const removedIds = new Set(this.state.removedNodes.map((n) => n.id));

    for (const node of this.state.removedNodes) {
      delete nextNodes[node.id];
    }

    if (this.state.parentGroupUpdates) {
      for (const update of this.state.parentGroupUpdates) {
        if (nextNodes[update.groupId] && nextNodes[update.groupId].type === 'group') {
          nextNodes[update.groupId] = {
            ...nextNodes[update.groupId],
            childrenIds: update.nextChildrenIds,
          } as VectorGroupNode;
        }
      }
    }

    const nextDoc: PrexyonDocument = {
      ...doc,
      nodes: nextNodes,
      rootNodeIds: doc.rootNodeIds.filter((id) => !removedIds.has(id)),
      updatedAt: new Date().toISOString(),
    };

    return {
      doc: nextDoc,
      selectedNodeId: nextDoc.rootNodeIds[0] ?? null,
    };
  }

  undo(doc: PrexyonDocument): CommandResult {
    const restoredNodes = { ...doc.nodes };
    for (const node of this.state.removedNodes) {
      restoredNodes[node.id] = node;
    }

    if (this.state.parentGroupUpdates) {
      for (const update of this.state.parentGroupUpdates) {
        if (restoredNodes[update.groupId] && restoredNodes[update.groupId].type === 'group') {
          restoredNodes[update.groupId] = {
            ...restoredNodes[update.groupId],
            childrenIds: update.prevChildrenIds,
          } as VectorGroupNode;
        }
      }
    }

    const rootAdditions = this.state.removedNodes
      .filter((n) => n.parentId === null || n.parentId === undefined)
      .map((n) => n.id);

    const nextDoc: PrexyonDocument = {
      ...doc,
      nodes: restoredNodes,
      rootNodeIds: [...doc.rootNodeIds, ...rootAdditions.filter((id) => !doc.rootNodeIds.includes(id))],
      updatedAt: new Date().toISOString(),
    };

    return {
      doc: nextDoc,
      selectedNodeId: this.state.removedNodes[0]?.id ?? null,
    };
  }
}

export interface StrokeWidthAdjustment {
  nodeId: string;
  prevStrokeWidth_mm: number;
  nextStrokeWidth_mm: number;
}

/**
 * Comando de Ajuste de Espessura Mínima de Traço (Etapa 6.12)
 * Reversível: restaura as espessuras de traço originais.
 */
export class SetMinimumStrokeWidthCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;

  constructor(
    public readonly adjustments: StrokeWidthAdjustment[],
    minStroke_mm: number = 0.2
  ) {
    this.id = `cmd_set_min_stroke_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    this.name = `Ajustar Espessura Mínima de Traço (${minStroke_mm} mm)`;
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    const newNodes = { ...doc.nodes };
    for (const adj of this.adjustments) {
      const node = newNodes[adj.nodeId] as VectorPathNode | undefined;
      if (node && node.type === 'vector_path') {
        newNodes[adj.nodeId] = {
          ...node,
          strokeWidth_mm: adj.nextStrokeWidth_mm,
        };
      }
    }
    const newDoc: PrexyonDocument = {
      ...doc,
      nodes: newNodes,
      updatedAt: new Date().toISOString(),
    };
    return {
      doc: newDoc,
      selectedNodeId: this.adjustments[0]?.nodeId ?? null,
    };
  }

  undo(doc: PrexyonDocument): CommandResult {
    const newNodes = { ...doc.nodes };
    for (const adj of this.adjustments) {
      const node = newNodes[adj.nodeId] as VectorPathNode | undefined;
      if (node && node.type === 'vector_path') {
        newNodes[adj.nodeId] = {
          ...node,
          strokeWidth_mm: adj.prevStrokeWidth_mm,
        };
      }
    }
    const newDoc: PrexyonDocument = {
      ...doc,
      nodes: newNodes,
      updatedAt: new Date().toISOString(),
    };
    return {
      doc: newDoc,
      selectedNodeId: this.adjustments[0]?.nodeId ?? null,
    };
  }
}

/**
 * Comando de Fechamento de Contorno de Corte Aberto (Etapa 6.12)
 * Reversível: restaura os contornos anteriores.
 */
export class CloseCutContourCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;

  constructor(
    public readonly nodeId: string,
    public readonly prevContours: ContourPolygon[],
    public readonly nextContours: ContourPolygon[]
  ) {
    this.id = `cmd_close_cut_${nodeId}_${Date.now()}`;
    this.name = 'Fechar Contorno de Corte';
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    const node = doc.nodes[this.nodeId] as CutContourNode | undefined;
    if (!node || node.type !== 'cut_contour') return { doc };
    const newDoc: PrexyonDocument = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [this.nodeId]: {
          ...node,
          contours: this.nextContours,
        },
      },
      updatedAt: new Date().toISOString(),
    };
    return {
      doc: newDoc,
      selectedNodeId: this.nodeId,
    };
  }

  undo(doc: PrexyonDocument): CommandResult {
    const node = doc.nodes[this.nodeId] as CutContourNode | undefined;
    if (!node || node.type !== 'cut_contour') return { doc };
    const newDoc: PrexyonDocument = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [this.nodeId]: {
          ...node,
          contours: this.prevContours,
        },
      },
      updatedAt: new Date().toISOString(),
    };
    return {
      doc: newDoc,
      selectedNodeId: this.nodeId,
    };
  }
}

export interface CleanVectorAdjustment {
  nodeId: string;
  prevD: string;
  nextD: string;
}

/**
 * Comando de Limpeza de Vetores / Remoção de Pontos Redundantes (Etapa 6.13)
 * Reversível: restaura o path 'd' anterior de cada VectorPathNode.
 */
export class CleanVectorPathCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;

  constructor(
    public readonly adjustments: CleanVectorAdjustment[]
  ) {
    this.id = `cmd_clean_vec_${Date.now()}`;
    this.name = adjustments.length === 1 ? 'Limpar Geometria do Vetor' : `Limpar Geometria de ${adjustments.length} Vetores`;
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    const newNodes = { ...doc.nodes };
    for (const adj of this.adjustments) {
      const node = newNodes[adj.nodeId] as VectorPathNode | undefined;
      if (node && node.type === 'vector_path') {
        newNodes[adj.nodeId] = {
          ...node,
          d: adj.nextD,
        };
      }
    }
    const newDoc: PrexyonDocument = {
      ...doc,
      nodes: newNodes,
      updatedAt: new Date().toISOString(),
    };
    return {
      doc: newDoc,
      selectedNodeId: this.adjustments[0]?.nodeId ?? null,
    };
  }

  undo(doc: PrexyonDocument): CommandResult {
    const newNodes = { ...doc.nodes };
    for (const adj of this.adjustments) {
      const node = newNodes[adj.nodeId] as VectorPathNode | undefined;
      if (node && node.type === 'vector_path') {
        newNodes[adj.nodeId] = {
          ...node,
          d: adj.prevD,
        };
      }
    }
    const newDoc: PrexyonDocument = {
      ...doc,
      nodes: newNodes,
      updatedAt: new Date().toISOString(),
    };
    return {
      doc: newDoc,
      selectedNodeId: this.adjustments[0]?.nodeId ?? null,
    };
  }
}

/**
 * Comando de Simplificação de Caminho Vetorial (Etapa 6.13)
 * Reversível: restaura o path 'd' original do VectorPathNode.
 */
export class SimplifyVectorPathCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;

  constructor(
    public readonly nodeId: string,
    public readonly prevD: string,
    public readonly nextD: string,
    public readonly toleranceMm: number = 0.05
  ) {
    this.id = `cmd_simplify_vec_${nodeId}_${Date.now()}`;
    this.name = 'Simplificar Traçado Vetorial';
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    const node = doc.nodes[this.nodeId] as VectorPathNode | undefined;
    if (!node || node.type !== 'vector_path') return { doc };
    const newDoc: PrexyonDocument = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [this.nodeId]: {
          ...node,
          d: this.nextD,
        },
      },
      updatedAt: new Date().toISOString(),
    };
    return {
      doc: newDoc,
      selectedNodeId: this.nodeId,
    };
  }

  undo(doc: PrexyonDocument): CommandResult {
    const node = doc.nodes[this.nodeId] as VectorPathNode | undefined;
    if (!node || node.type !== 'vector_path') return { doc };
    const newDoc: PrexyonDocument = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [this.nodeId]: {
          ...node,
          d: this.prevD,
        },
      },
      updatedAt: new Date().toISOString(),
    };
    return {
      doc: newDoc,
      selectedNodeId: this.nodeId,
    };
  }
}

/**
 * Comando de Importação de PDF Vetorial
 * Reversível: ao desfazer, remove o grupo e todos os nós importados.
 */
export class ImportVectorPdfCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string = 'Importar PDF Vetorial';
  readonly timestamp: number;

  constructor(
    public readonly groupNode?: VectorGroupNode,
    public readonly pathNodes: VectorPathNode[] = [],
    public readonly prevDimensions?: DocumentDimensions
  ) {
    this.id = `cmd_pdf_import_${Date.now()}`;
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    let newDoc = { ...doc };
    if (this.groupNode) {
      newDoc = addVectorGroup(newDoc, this.groupNode, this.pathNodes);
      return { doc: newDoc, selectedNodeId: this.groupNode.id };
    } else {
      for (const p of this.pathNodes) {
        newDoc = addNode(newDoc, p);
      }
      return { doc: newDoc, selectedNodeId: this.pathNodes[0]?.id ?? null };
    }
  }

  undo(doc: PrexyonDocument): CommandResult {
    let newDoc = { ...doc };
    if (this.groupNode) {
      newDoc = removeNode(newDoc, this.groupNode.id);
    } else {
      for (const p of this.pathNodes) {
        newDoc = removeNode(newDoc, p.id);
      }
    }
    if (this.prevDimensions) {
      newDoc.dimensions = this.prevDimensions;
    }
    return { doc: newDoc, selectedNodeId: newDoc.rootNodeIds[0] ?? null };
  }
}

/**
 * Comando de Alteração de Cor de Preenchimento (Fill)
 * Reversível: ao desfazer, restaura as cores anteriores de cada nó afetado.
 */
export class ChangeFillColorCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string = 'Alterar Cor de Preenchimento';
  readonly timestamp: number;

  constructor(
    public readonly affectedNodes: Array<{ nodeId: string; prevFill: string | null; nextFill: string | null }>
  ) {
    this.id = `cmd_fill_${Date.now()}`;
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    let newDoc = { ...doc };
    for (const item of this.affectedNodes) {
      newDoc = updateNodeStyle(newDoc, item.nodeId, { fill: item.nextFill });
    }
    return { doc: newDoc, selectedNodeId: this.affectedNodes[0]?.nodeId ?? null };
  }

  undo(doc: PrexyonDocument): CommandResult {
    let newDoc = { ...doc };
    for (const item of this.affectedNodes) {
      newDoc = updateNodeStyle(newDoc, item.nodeId, { fill: item.prevFill });
    }
    return { doc: newDoc, selectedNodeId: this.affectedNodes[0]?.nodeId ?? null };
  }
}

/**
 * Comando de Alteração de Cor de Traço (Stroke)
 * Reversível: ao desfazer, restaura os traços anteriores de cada nó afetado.
 */
export class ChangeStrokeColorCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string = 'Alterar Cor de Traço';
  readonly timestamp: number;

  constructor(
    public readonly affectedNodes: Array<{ nodeId: string; prevStroke: string | null; nextStroke: string | null }>
  ) {
    this.id = `cmd_stroke_${Date.now()}`;
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    let newDoc = { ...doc };
    for (const item of this.affectedNodes) {
      newDoc = updateNodeStyle(newDoc, item.nodeId, { stroke: item.nextStroke });
    }
    return { doc: newDoc, selectedNodeId: this.affectedNodes[0]?.nodeId ?? null };
  }

  undo(doc: PrexyonDocument): CommandResult {
    let newDoc = { ...doc };
    for (const item of this.affectedNodes) {
      newDoc = updateNodeStyle(newDoc, item.nodeId, { stroke: item.prevStroke });
    }
    return { doc: newDoc, selectedNodeId: this.affectedNodes[0]?.nodeId ?? null };
  }
}

/**
 * Comando de Desagrupamento (Ungroup)
 * Reversível: ao desfazer, recria o grupo exatamente na mesma posição e hierarquia.
 */
export class UngroupNodeCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string = 'Desagrupar';
  readonly timestamp: number;

  constructor(
    public readonly groupNode: VectorGroupNode,
    public readonly childNodes: VectorPathNode[]
  ) {
    this.id = `cmd_ungroup_${groupNode.id}_${Date.now()}`;
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    const { doc: newDoc, ungroupedNodeIds } = ungroupNode(doc, this.groupNode.id);
    return {
      doc: newDoc,
      selectedNodeId: ungroupedNodeIds[0] ?? null,
    };
  }

  undo(doc: PrexyonDocument): CommandResult {
    // Remove os nós filhos da raiz e restaura o grupo
    const newNodes = { ...doc.nodes, [this.groupNode.id]: this.groupNode };
    for (const child of this.childNodes) {
      newNodes[child.id] = { ...child, parentId: this.groupNode.id };
    }

    const firstChildIndex = Math.min(
      ...this.groupNode.childrenIds.map((id) => doc.rootNodeIds.indexOf(id)).filter((idx) => idx !== -1)
    );
    const filteredRootIds = doc.rootNodeIds.filter((id) => !this.groupNode.childrenIds.includes(id));

    if (firstChildIndex !== -1 && firstChildIndex < filteredRootIds.length) {
      filteredRootIds.splice(firstChildIndex, 0, this.groupNode.id);
    } else {
      filteredRootIds.push(this.groupNode.id);
    }

    return {
      doc: {
        ...doc,
        nodes: newNodes,
        rootNodeIds: filteredRootIds,
        updatedAt: new Date().toISOString(),
      },
      selectedNodeId: this.groupNode.id,
    };
  }
}

/**
 * Comando de Agrupamento (Group)
 * Reversível: ao desfazer, desagrupa os nós.
 */
export class GroupNodesCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string = 'Agrupar Objetos';
  readonly timestamp: number;
  public groupNodeId?: string;

  constructor(
    public readonly nodeIds: string[],
    public readonly groupName: string = 'Grupo Vetorial'
  ) {
    this.id = `cmd_group_${Date.now()}`;
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    const { doc: newDoc, groupNode } = groupNodes(doc, this.nodeIds, this.groupName);
    this.groupNodeId = groupNode.id;
    return {
      doc: newDoc,
      selectedNodeId: groupNode.id,
    };
  }

  undo(doc: PrexyonDocument): CommandResult {
    if (!this.groupNodeId) return { doc };
    const { doc: newDoc } = ungroupNode(doc, this.groupNodeId);
    return {
      doc: newDoc,
      selectedNodeId: this.nodeIds[0] ?? null,
    };
  }
}

/**
 * Comando de Exclusão de Múltiplos Nós
 * Reversível: ao desfazer, restaura todos os nós excluídos.
 */
export class DeleteMultipleNodesCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;

  constructor(
    public readonly deletedNodes: DocumentNode[]
  ) {
    this.id = `cmd_del_multi_${Date.now()}`;
    this.name = `Excluir ${deletedNodes.length} Objeto(s)`;
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    let newDoc = { ...doc };
    for (const node of this.deletedNodes) {
      newDoc = removeNode(newDoc, node.id);
    }
    return { doc: newDoc, selectedNodeId: null };
  }

  undo(doc: PrexyonDocument): CommandResult {
    let newDoc = { ...doc };
    for (const node of this.deletedNodes) {
      newDoc = addNode(newDoc, node);
    }
    return { doc: newDoc, selectedNodeId: this.deletedNodes[0]?.id ?? null };
  }
}



