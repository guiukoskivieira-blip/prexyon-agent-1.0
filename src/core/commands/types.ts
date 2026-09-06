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

