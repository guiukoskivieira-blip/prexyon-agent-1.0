/**
 * Prexyon Document Model (PDM) v0.1 — Types
 *
 * Princípio Arquitetural:
 * Este arquivo é 100% puro. Não possui dependências do React, Fabric.js ou qualquer biblioteca de UI.
 * É a única fonte da verdade para o estado do documento.
 */

export type PhysicalUnit = 'mm';

export interface DocumentDimensions {
  /** Largura da prancheta em milímetros */
  width_mm: number;
  /** Altura da prancheta em milímetros */
  height_mm: number;
  /** Unidade física da prancheta */
  unit: PhysicalUnit;
}

export interface Position_mm {
  /** Posição X em milímetros em relação ao canto superior esquerdo da prancheta (0,0) */
  x: number;
  /** Posição Y em milímetros em relação ao canto superior esquerdo da prancheta (0,0) */
  y: number;
}

export type NodeType = 'raster_image' | 'vector_path' | 'group' | 'cut_contour';

export interface BaseNode {
  /** Identificador único e imutável (UUID v4) */
  id: string;
  /** Tipo discriminador do nó */
  type: NodeType;
  /** Nome legível para o usuário na Árvore de Objetos */
  name: string;
  /** Visibilidade no renderizador */
  visible: boolean;
  /** Trava de edição */
  locked: boolean;
  /** Posição em coordenadas físicas da prancheta */
  position_mm: Position_mm;
  /** Rotação em graus (0 a 360) */
  rotation_deg: number;
  /** Opacidade (0.0 a 1.0) */
  opacity: number;
}

export interface RasterNode extends BaseNode {
  type: 'raster_image';
  /** Conteúdo da imagem codificado de forma segura (Data URL / base64) */
  src: string;
  /** Resolução natural em pixels (largura) */
  naturalWidth: number;
  /** Resolução natural em pixels (altura) */
  naturalHeight: number;
  /** Largura física no documento em milímetros */
  physicalWidth_mm: number;
  /** Altura física no documento em milímetros */
  physicalHeight_mm: number;
  /** Proporção original (naturalWidth / naturalHeight) */
  aspectRatio: number;
  /** Tipo MIME validado do arquivo */
  mimeType: 'image/png' | 'image/jpeg';
  /** Tamanho do arquivo original em bytes */
  fileSize_bytes: number;
  /** Nome original do arquivo importado */
  fileName: string;
}

/** Stubs de extensibilidade para etapas futuras */
export interface VectorPathNodeStub extends BaseNode {
  type: 'vector_path';
  d: string;
}

export interface GroupNodeStub extends BaseNode {
  type: 'group';
  childrenIds: string[];
}

export interface CutContourNodeStub extends BaseNode {
  type: 'cut_contour';
  sourceNodeId: string;
  offset_mm: number;
}

export type DocumentNode =
  | RasterNode
  | VectorPathNodeStub
  | GroupNodeStub
  | CutContourNodeStub;

export interface PrexyonDocument {
  /** Versão do schema do documento */
  version: '0.1.0';
  /** ID único do documento */
  id: string;
  /** Dimensões físicas nominais da prancheta */
  dimensions: DocumentDimensions;
  /** Dicionário de nós indexados por ID persistente */
  nodes: Record<string, DocumentNode>;
  /** Ordem de empilhamento dos nós na raiz (z-index da prancheta) */
  rootNodeIds: string[];
  /** Timestamp de criação ISO */
  createdAt: string;
  /** Timestamp da última modificação ISO */
  updatedAt: string;
}
