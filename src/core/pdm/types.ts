/**
 * Prexyon Document Model (PDM) v0.2 — Types
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

export interface VectorPathNode extends BaseNode {
  type: 'vector_path';
  /** Instruções geométricas SVG Path (comandos M, C, L, Z) no espaço de coordenadas local */
  d: string;
  /** Cor de preenchimento (Hex, RGB ou null se transparente) */
  fill: string | null;
  /** Cor de contorno (Hex, RGB ou null se sem contorno) */
  stroke: string | null;
  /** Espessura do contorno em milímetros */
  strokeWidth_mm: number;
  /** Largura física do caminho delimitador em milímetros */
  physicalWidth_mm: number;
  /** Altura física do caminho delimitador em milímetros */
  physicalHeight_mm: number;
  /** Referência opcional ao ID do nó raster de origem */
  sourceRasterNodeId?: string;
  /** Metadados adicionais da geometria vetorial */
  metadata?: {
    pathIndex?: number;
    rule?: 'nonzero' | 'evenodd';
    segmentCount?: number;
  };
}

export interface VectorGroupNode extends BaseNode {
  type: 'group';
  /** Lista ordenada de IDs dos nós filhos pertencentes ao grupo */
  childrenIds: string[];
  /** Largura física total do grupo em milímetros */
  physicalWidth_mm: number;
  /** Altura física total do grupo em milímetros */
  physicalHeight_mm: number;
  /** Proporção do grupo (largura / altura) */
  aspectRatio: number;
  /** Dimensões da viewBox SVG original de onde os vetores foram vetorizados */
  sourceViewBox: {
    width: number;
    height: number;
  };
  /** Referência opcional ao ID do nó raster de origem */
  sourceRasterNodeId?: string;
  /** Metadados do processo de vetorização */
  metadata?: {
    vectorizationTimeMs?: number;
    totalPaths?: number;
    totalSegments?: number;
    preset?: string;
  };
}

export type JoinStyle = 'round' | 'miter' | 'square' | 'bevel';

export interface ContourPolygon {
  /** Lista ordenada de pontos (X, Y) do contorno em milímetros na prancheta */
  points_mm: Array<{ x: number; y: number }>;
  /** Indica se o polígono representa um furo/região interna */
  isHole?: boolean;
}

export interface CutContourNode extends BaseNode {
  type: 'cut_contour';
  /** ID do VectorGroupNode que originou esta faca */
  sourceNodeId: string;
  /** Distância física do offset externo em milímetros */
  offset_mm: number;
  /** Estilo dos cantos gerados no offset */
  joinStyle: JoinStyle;
  /** Se true, inclui contornos e furos internos. Se false (default), gera somente o contorno exterior */
  includeInnerContours: boolean;
  /** Conjunto de anéis poligonais fechados que compõem a linha de corte */
  contours: ContourPolygon[];
  /** Cor técnica de visualização do traço da faca (ex: '#E6007E' / '#ec4899' magenta) */
  strokeColor: string;
  /** Espessura nominal do traço da faca em milímetros (0.05 a 2.00 mm) */
  strokeWidth_mm: number;
  /** Largura delimitadora total da faca em milímetros */
  physicalWidth_mm: number;
  /** Altura delimitadora total da faca em milímetros */
  physicalHeight_mm: number;
  /** Proporção de aspecto da faca */
  aspectRatio: number;
  /** Papel técnico de produção gráfica */
  productionRole: 'cut';
  /** Metadados adicionais */
  metadata?: {
    totalPoints?: number;
    contourCount?: number;
    calculatedAt?: string;
    manualScaleApplied?: boolean;
    manualPositionApplied?: boolean;
    relativeOffsetX_mm?: number;
    relativeOffsetY_mm?: number;
  };
}

export type DocumentNode =
  | RasterNode
  | VectorPathNode
  | VectorGroupNode
  | CutContourNode;

export interface PrexyonDocument {
  /** Versão do schema do documento */
  version: '0.2.0';
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
