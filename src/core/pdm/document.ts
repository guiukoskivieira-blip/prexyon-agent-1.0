/**
 * Prexyon Document Manager — Pure PDM Operations
 *
 * Todas as funções deste arquivo são imutáveis e puras.
 * Nenhuma função altera os objetos diretamente; elas retornam uma nova versão do documento.
 */

import {
  PrexyonDocument,
  DocumentDimensions,
  DocumentNode,
  RasterNode,
  Position_mm,
} from './types';
import {
  calculateHeightFromWidth,
  calculateWidthFromHeight,
  roundPrecision,
} from './units';
import { validatePhysicalDimension } from './validation';

/**
 * Utilitário seguro para geração de UUID v4
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Cria um novo documento Prexyon vazio com prancheta padrão 100x100 mm.
 */
export function createDocument(
  dimensions: Partial<DocumentDimensions> = {}
): PrexyonDocument {
  const now = new Date().toISOString();
  return {
    version: '0.1.0',
    id: generateUUID(),
    dimensions: {
      width_mm: dimensions.width_mm ?? 100,
      height_mm: dimensions.height_mm ?? 100,
      unit: 'mm',
    },
    nodes: {},
    rootNodeIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

export interface CreateRasterNodeParams {
  id?: string;
  name: string;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  physicalWidth_mm: number;
  physicalHeight_mm: number;
  position_mm: Position_mm;
  mimeType: 'image/png' | 'image/jpeg';
  fileSize_bytes: number;
  fileName: string;
}

/**
 * Cria um novo RasterNode com validação de proporção e limites.
 */
export function createRasterNode(params: CreateRasterNodeParams): RasterNode {
  const aspectRatio = params.naturalWidth / params.naturalHeight;
  return {
    id: params.id ?? generateUUID(),
    type: 'raster_image',
    name: params.name,
    visible: true,
    locked: false,
    position_mm: {
      x: roundPrecision(params.position_mm.x, 2),
      y: roundPrecision(params.position_mm.y, 2),
    },
    rotation_deg: 0,
    opacity: 1.0,
    src: params.src,
    naturalWidth: params.naturalWidth,
    naturalHeight: params.naturalHeight,
    physicalWidth_mm: roundPrecision(params.physicalWidth_mm, 2),
    physicalHeight_mm: roundPrecision(params.physicalHeight_mm, 2),
    aspectRatio,
    mimeType: params.mimeType,
    fileSize_bytes: params.fileSize_bytes,
    fileName: params.fileName,
  };
}

/**
 * Adiciona um nó ao documento (no topo da ordem z-index).
 */
export function addNode(
  doc: PrexyonDocument,
  node: DocumentNode
): PrexyonDocument {
  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [node.id]: node,
    },
    rootNodeIds: [...doc.rootNodeIds.filter((id) => id !== node.id), node.id],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Remove um nó do documento.
 */
export function removeNode(
  doc: PrexyonDocument,
  nodeId: string
): PrexyonDocument {
  const newNodes = { ...doc.nodes };
  delete newNodes[nodeId];

  return {
    ...doc,
    nodes: newNodes,
    rootNodeIds: doc.rootNodeIds.filter((id) => id !== nodeId),
    updatedAt: new Date().toISOString(),
  };
}

export interface UpdateDimensionsOptions {
  physicalWidth_mm?: number;
  physicalHeight_mm?: number;
  keepAspectRatio?: boolean;
}

/**
 * Atualiza as dimensões físicas de um nó no PDM garantindo validação e proporção.
 */
export function updateNodeDimensions(
  doc: PrexyonDocument,
  nodeId: string,
  options: UpdateDimensionsOptions
): PrexyonDocument {
  const node = doc.nodes[nodeId];
  if (!node || node.type !== 'raster_image') return doc;

  const rasterNode = node as RasterNode;
  const keepAspect = options.keepAspectRatio ?? true;

  let newWidth = rasterNode.physicalWidth_mm;
  let newHeight = rasterNode.physicalHeight_mm;

  if (options.physicalWidth_mm !== undefined) {
    const valResult = validatePhysicalDimension(options.physicalWidth_mm, 'Largura');
    if (!valResult.valid) throw new Error(valResult.error);

    newWidth = roundPrecision(options.physicalWidth_mm, 2);
    if (keepAspect) {
      newHeight = roundPrecision(
        calculateHeightFromWidth(newWidth, rasterNode.aspectRatio),
        2
      );
    }
  } else if (options.physicalHeight_mm !== undefined) {
    const valResult = validatePhysicalDimension(options.physicalHeight_mm, 'Altura');
    if (!valResult.valid) throw new Error(valResult.error);

    newHeight = roundPrecision(options.physicalHeight_mm, 2);
    if (keepAspect) {
      newWidth = roundPrecision(
        calculateWidthFromHeight(newHeight, rasterNode.aspectRatio),
        2
      );
    }
  }

  const updatedNode: RasterNode = {
    ...rasterNode,
    physicalWidth_mm: newWidth,
    physicalHeight_mm: newHeight,
  };

  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [nodeId]: updatedNode,
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Atualiza a posição física (X, Y em mm) de um nó no PDM.
 */
export function updateNodePosition(
  doc: PrexyonDocument,
  nodeId: string,
  position_mm: Partial<Position_mm>
): PrexyonDocument {
  const node = doc.nodes[nodeId];
  if (!node) return doc;

  const currentPos = node.position_mm;
  const newPos: Position_mm = {
    x: position_mm.x !== undefined ? roundPrecision(position_mm.x, 2) : currentPos.x,
    y: position_mm.y !== undefined ? roundPrecision(position_mm.y, 2) : currentPos.y,
  };

  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [nodeId]: {
        ...node,
        position_mm: newPos,
      },
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Atualiza propriedades gerais (nome, visibilidade, travamento).
 */
export function updateNodeMetadata(
  doc: PrexyonDocument,
  nodeId: string,
  updates: Partial<Pick<DocumentNode, 'name' | 'visible' | 'locked' | 'opacity'>>
): PrexyonDocument {
  const node = doc.nodes[nodeId];
  if (!node) return doc;

  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [nodeId]: {
        ...node,
        ...updates,
      },
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Serializa o documento PDM para JSON puro.
 */
export function serializeDocument(doc: PrexyonDocument): string {
  return JSON.stringify(doc, null, 2);
}

/**
 * Desserializa um JSON em um PrexyonDocument com validação de estrutura.
 */
export function deserializeDocument(json: string): PrexyonDocument {
  const parsed = JSON.parse(json);
  if (!parsed || parsed.version !== '0.1.0' || !parsed.dimensions || !parsed.nodes) {
    throw new Error('Formato inválido de PrexyonDocument.');
  }
  return parsed as PrexyonDocument;
}

/**
 * Clona profundamente um documento PDM.
 */
export function cloneDocument(doc: PrexyonDocument): PrexyonDocument {
  return JSON.parse(JSON.stringify(doc));
}
