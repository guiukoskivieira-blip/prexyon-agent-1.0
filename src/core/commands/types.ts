/**
 * Prexyon Command Pattern Definitions (v0.2)
 *
 * Implementa comandos granulares, reversíveis e auditáveis sobre o Prexyon Document Model (PDM).
 * Cada mutação discreta de estado (importar, mover, redimensionar, vetorizar, deletar)
 * possui seu comando individual com suporte a Undo/Redo preciso.
 */

import { PrexyonDocument, RasterNode, VectorGroupNode, VectorPathNode, DocumentNode, Position_mm } from '../pdm/types';
import { addNode, addVectorGroup, removeNode, updateNodeDimensions, updateNodePosition } from '../pdm/document';

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
    newDoc = updateNodeDimensions(newDoc, this.nodeId, {
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
    let newDoc = updateNodePosition(doc, this.nodeId, this.prev.position_mm);
    newDoc = updateNodeDimensions(newDoc, this.nodeId, {
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
    public readonly childNodes: DocumentNode[] = []
  ) {
    this.id = `cmd_del_${deletedNode.id}`;
    this.name = `Remover ${deletedNode.name}`;
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    const newDoc = removeNode(doc, this.deletedNode.id);
    return {
      doc: newDoc,
      selectedNodeId: newDoc.rootNodeIds[0] ?? null,
    };
  }

  undo(doc: PrexyonDocument): CommandResult {
    let newDoc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [this.deletedNode.id]: this.deletedNode,
      },
      rootNodeIds: [...doc.rootNodeIds, this.deletedNode.id],
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

    return {
      doc: newDoc,
      selectedNodeId: this.deletedNode.id,
    };
  }
}
