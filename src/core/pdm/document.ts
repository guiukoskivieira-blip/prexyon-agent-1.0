/**
 * Prexyon Document Manager — Pure PDM Operations (v0.2)
 *
 * Todas as funções deste arquivo são imutáveis e puras.
 * Nenhuma função altera os objetos diretamente; elas retornam uma nova versão do documento.
 */

import {
  PrexyonDocument,
  DocumentDimensions,
  DocumentNode,
  RasterNode,
  VectorGroupNode,
  VectorPathNode,
  CutContourNode,
  ContourPolygon,
  JoinStyle,
  Position_mm,
  BleedSettings,
  SafetyMarginSettings,
  ProductionSettings,
  TechnicalGuideNode,
  TechnicalGuideOrientation,
  TechnicalGuideRole,
} from './types';
import {
  calculateHeightFromWidth,
  calculateWidthFromHeight,
  roundPrecision,
} from './units';
import { validatePhysicalDimension } from './validation';
import { generateCutContour } from '../geometry/cutContourEngine';

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
 * Configurações padrão de produção técnica (Sangria e Margem de Segurança)
 */
export const DEFAULT_PRODUCTION_SETTINGS: ProductionSettings = {
  bleed: {
    enabled: false,
    top_mm: 3,
    right_mm: 3,
    bottom_mm: 3,
    left_mm: 3,
    linked: true,
  },
  safetyMargin: {
    enabled: false,
    top_mm: 5,
    right_mm: 5,
    bottom_mm: 5,
    left_mm: 5,
    linked: true,
  },
};

/**
 * Cria um novo documento Prexyon vazio com prancheta padrão 100x100 mm.
 */
export function createDocument(
  dimensions: Partial<DocumentDimensions> = {},
  productionSettings?: Partial<ProductionSettings>
): PrexyonDocument {
  const now = new Date().toISOString();
  return {
    version: '0.2.0',
    id: generateUUID(),
    dimensions: {
      width_mm: dimensions.width_mm ?? 100,
      height_mm: dimensions.height_mm ?? 100,
      unit: 'mm',
    },
    productionSettings: {
      bleed: {
        ...DEFAULT_PRODUCTION_SETTINGS.bleed,
        ...(productionSettings?.bleed || {}),
      },
      safetyMargin: {
        ...DEFAULT_PRODUCTION_SETTINGS.safetyMargin,
        ...(productionSettings?.safetyMargin || {}),
      },
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

export interface CreateCutContourNodeParams {
  id?: string;
  name: string;
  sourceNodeId: string;
  offset_mm: number;
  joinStyle?: JoinStyle;
  includeInnerContours?: boolean;
  contours: ContourPolygon[];
  physicalWidth_mm: number;
  physicalHeight_mm: number;
  position_mm: Position_mm;
  strokeColor?: string;
  strokeWidth_mm?: number;
}

/**
 * Cria um novo CutContourNode estruturado no PDM.
 */
export function createCutContourNode(params: CreateCutContourNodeParams): CutContourNode {
  const totalPoints = params.contours.reduce((sum, c) => sum + c.points_mm.length, 0);
  const width = roundPrecision(params.physicalWidth_mm, 2);
  const height = roundPrecision(params.physicalHeight_mm, 2);
  const aspectRatio = height > 0 ? roundPrecision(width / height, 4) : 1;

  return {
    id: params.id ?? generateUUID(),
    type: 'cut_contour',
    name: params.name,
    sourceNodeId: params.sourceNodeId,
    offset_mm: roundPrecision(params.offset_mm, 2),
    joinStyle: params.joinStyle ?? 'round',
    includeInnerContours: params.includeInnerContours ?? false,
    contours: params.contours,
    strokeColor: params.strokeColor ?? '#ec4899', // Magenta técnico padrão de arte-final
    strokeWidth_mm: params.strokeWidth_mm ?? 0.3,
    physicalWidth_mm: width,
    physicalHeight_mm: height,
    aspectRatio,
    position_mm: {
      x: roundPrecision(params.position_mm?.x ?? 0, 2),
      y: roundPrecision(params.position_mm?.y ?? 0, 2),
    },
    rotation_deg: 0,
    opacity: 1.0,
    visible: true,
    locked: false,
    productionRole: 'cut',
    metadata: {
      totalPoints,
      contourCount: params.contours.length,
      calculatedAt: new Date().toISOString(),
      manualScaleApplied: false,
    },
  };
}

export interface CreateTechnicalGuideParams {
  id?: string;
  name?: string;
  orientation: TechnicalGuideOrientation;
  position_mm?: number;
  guidePosition_mm?: number;
  guideRole?: TechnicalGuideRole;
  strokeColor?: string;
  strokeWidth_mm?: number;
  dashPattern?: number[];
  visible?: boolean;
  locked?: boolean;
}

/**
 * Cria um novo TechnicalGuideNode no PDM.
 */
export function createTechnicalGuideNode(
  params: CreateTechnicalGuideParams,
  artboardDimensions?: DocumentDimensions
): TechnicalGuideNode {
  const defaultPos = artboardDimensions
    ? (params.orientation === 'vertical' ? artboardDimensions.width_mm / 2 : artboardDimensions.height_mm / 2)
    : 50;

  const rawPos = params.guidePosition_mm !== undefined
    ? params.guidePosition_mm
    : (params.position_mm !== undefined ? params.position_mm : defaultPos);

  const maxDim = artboardDimensions
    ? (params.orientation === 'vertical' ? artboardDimensions.width_mm : artboardDimensions.height_mm)
    : 5000;
  const clampedPos = roundPrecision(Math.max(0, Math.min(maxDim, rawPos)), 2);

  const roleLabels: Record<TechnicalGuideRole, string> = {
    generic: 'Guia',
    fold: 'Dobra',
    crease: 'Vinco',
    cut_reference: 'Ref. Corte',
    alignment: 'Alinhamento',
  };

  const defaultName = `${roleLabels[params.guideRole ?? 'generic']} ${params.orientation === 'vertical' ? 'vertical' : 'horizontal'} — ${clampedPos.toFixed(1)} mm`;

  return {
    id: params.id ?? generateUUID(),
    type: 'technical_guide',
    name: params.name ?? defaultName,
    orientation: params.orientation,
    guidePosition_mm: clampedPos,
    position_mm: {
      x: params.orientation === 'vertical' ? clampedPos : 0,
      y: params.orientation === 'horizontal' ? clampedPos : 0,
    },
    guideRole: params.guideRole ?? 'generic',
    strokeColor: params.strokeColor,
    strokeWidth_mm: params.strokeWidth_mm ?? 0.3,
    dashPattern: params.dashPattern,
    productionRole: 'guide',
    rotation_deg: 0,
    opacity: 1.0,
    visible: params.visible ?? true,
    locked: params.locked ?? false,
    metadata: {
      createdAt: new Date().toISOString(),
    },
  };
}

/**
 * Atualiza propriedades de um TechnicalGuideNode de forma pura e imutável.
 * Se a orientação for alterada, faz clamp automático aos limites da nova dimensão.
 */
export function updateTechnicalGuideNode(
  doc: PrexyonDocument,
  nodeId: string,
  updates: Partial<TechnicalGuideNode>
): PrexyonDocument {
  const node = doc.nodes[nodeId];
  if (!node || node.type !== 'technical_guide') {
    throw new Error(`Guia técnica "${nodeId}" não encontrada.`);
  }

  const currentGuide = node as TechnicalGuideNode;
  const nextOrientation = updates.orientation ?? currentGuide.orientation;
  const maxDim = nextOrientation === 'vertical' ? doc.dimensions.width_mm : doc.dimensions.height_mm;

  let nextPos = updates.guidePosition_mm !== undefined
    ? updates.guidePosition_mm
    : (updates.position_mm !== undefined
        ? (nextOrientation === 'vertical' ? updates.position_mm.x : updates.position_mm.y)
        : currentGuide.guidePosition_mm);

  nextPos = roundPrecision(Math.max(0, Math.min(maxDim, nextPos)), 2);

  const updatedGuide: TechnicalGuideNode = {
    ...currentGuide,
    ...updates,
    orientation: nextOrientation,
    guidePosition_mm: nextPos,
    position_mm: {
      x: nextOrientation === 'vertical' ? nextPos : 0,
      y: nextOrientation === 'horizontal' ? nextPos : 0,
    },
  };

  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [nodeId]: updatedGuide,
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Duplica uma guia técnica existente com deslocamento de +5 mm (ou -5 mm se ultrapassar o limite).
 */
export function duplicateTechnicalGuideNode(
  doc: PrexyonDocument,
  sourceNodeId: string
): { doc: PrexyonDocument; newGuide: TechnicalGuideNode; duplicatedNode: TechnicalGuideNode } {
  const node = doc.nodes[sourceNodeId];
  if (!node || node.type !== 'technical_guide') {
    throw new Error(`Guia técnica "${sourceNodeId}" não encontrada.`);
  }
  const guide = node as TechnicalGuideNode;
  const maxDim = guide.orientation === 'vertical' ? doc.dimensions.width_mm : doc.dimensions.height_mm;

  // Tenta +5 mm; se ultrapassar, usa -5 mm
  let targetPos = guide.guidePosition_mm + 5.0;
  if (targetPos > maxDim) {
    targetPos = Math.max(0, guide.guidePosition_mm - 5.0);
  }

  const newGuide = createTechnicalGuideNode({
    orientation: guide.orientation,
    position_mm: targetPos,
    guideRole: guide.guideRole,
    strokeColor: guide.strokeColor,
    strokeWidth_mm: guide.strokeWidth_mm,
    dashPattern: guide.dashPattern ? [...guide.dashPattern] : undefined,
    visible: guide.visible,
    locked: false,
  }, doc.dimensions);

  const nextDoc = addNode(doc, newGuide);
  return { doc: nextDoc, newGuide, duplicatedNode: newGuide };
}

/**
 * Encontra a faca de corte dependente vinculada a um VectorGroupNode.
 */
export function findCutContourForSourceNode(
  doc: PrexyonDocument,
  sourceVectorNodeId: string
): CutContourNode | undefined {
  return Object.values(doc.nodes).find(
    (n): n is CutContourNode => n.type === 'cut_contour' && n.sourceNodeId === sourceVectorNodeId
  );
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
 * Adiciona um grupo vetorial com seus caminhos filhos de forma atômica no PDM.
 */
export function addVectorGroup(
  doc: PrexyonDocument,
  groupNode: VectorGroupNode,
  pathNodes: VectorPathNode[]
): PrexyonDocument {
  const newNodes = { ...doc.nodes, [groupNode.id]: groupNode };
  for (const p of pathNodes) {
    newNodes[p.id] = p;
  }

  return {
    ...doc,
    nodes: newNodes,
    rootNodeIds: [...doc.rootNodeIds.filter((id) => id !== groupNode.id), groupNode.id],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Remove um nó do documento (e recursivamente seus filhos e facas dependentes).
 */
export function removeNode(
  doc: PrexyonDocument,
  nodeId: string
): PrexyonDocument {
  const node = doc.nodes[nodeId];
  const newNodes = { ...doc.nodes };
  let idsToRemove = [nodeId];

  if (node && node.type === 'group') {
    const group = node as VectorGroupNode;
    // Remove filhos caminhos
    for (const childId of group.childrenIds) {
      delete newNodes[childId];
    }
    // Remove facas de corte vinculadas a este grupo
    const dependentCut = findCutContourForSourceNode(doc, nodeId);
    if (dependentCut) {
      delete newNodes[dependentCut.id];
      idsToRemove.push(dependentCut.id);
    }
  }

  delete newNodes[nodeId];

  return {
    ...doc,
    nodes: newNodes,
    rootNodeIds: doc.rootNodeIds.filter((id) => !idsToRemove.includes(id)),
    updatedAt: new Date().toISOString(),
  };
}

export interface UpdateDimensionsOptions {
  physicalWidth_mm?: number;
  physicalHeight_mm?: number;
  keepAspectRatio?: boolean;
}

/**
 * Atualiza as dimensões físicas de um nó (RasterNode, VectorGroupNode ou CutContourNode) no PDM.
 */
export function updateNodeDimensions(
  doc: PrexyonDocument,
  nodeId: string,
  options: UpdateDimensionsOptions
): PrexyonDocument {
  const node = doc.nodes[nodeId];
  if (!node) return doc;

  if (node.type !== 'raster_image' && node.type !== 'group' && node.type !== 'cut_contour') {
    return doc;
  }

  const keepAspect = options.keepAspectRatio ?? true;

  // --- TRATAMENTO ESPECÍFICO PARA CUT CONTOUR NODE ---
  if (node.type === 'cut_contour') {
    const cutNode = node as CutContourNode;
    const currentRatio =
      cutNode.aspectRatio > 0
        ? cutNode.aspectRatio
        : cutNode.physicalHeight_mm > 0
        ? cutNode.physicalWidth_mm / cutNode.physicalHeight_mm
        : 1;

    let newWidth = cutNode.physicalWidth_mm;
    let newHeight = cutNode.physicalHeight_mm;
    let newAspectRatio = currentRatio;

    if (options.physicalWidth_mm !== undefined && options.physicalHeight_mm !== undefined) {
      const valW = validatePhysicalDimension(options.physicalWidth_mm, 'Largura');
      if (!valW.valid) throw new Error(valW.error);
      const valH = validatePhysicalDimension(options.physicalHeight_mm, 'Altura');
      if (!valH.valid) throw new Error(valH.error);
      newWidth = roundPrecision(options.physicalWidth_mm, 2);
      newHeight = roundPrecision(options.physicalHeight_mm, 2);
      newAspectRatio = roundPrecision(newWidth / newHeight, 4);
    } else if (options.physicalWidth_mm !== undefined) {
      const valW = validatePhysicalDimension(options.physicalWidth_mm, 'Largura');
      if (!valW.valid) throw new Error(valW.error);
      newWidth = roundPrecision(options.physicalWidth_mm, 2);
      if (keepAspect) {
        newHeight = roundPrecision(calculateHeightFromWidth(newWidth, currentRatio), 2);
      } else {
        newAspectRatio = roundPrecision(newWidth / newHeight, 4);
      }
    } else if (options.physicalHeight_mm !== undefined) {
      const valH = validatePhysicalDimension(options.physicalHeight_mm, 'Altura');
      if (!valH.valid) throw new Error(valH.error);
      newHeight = roundPrecision(options.physicalHeight_mm, 2);
      if (keepAspect) {
        newWidth = roundPrecision(calculateWidthFromHeight(newHeight, currentRatio), 2);
      } else {
        newAspectRatio = roundPrecision(newWidth / newHeight, 4);
      }
    }

    const scaleX = cutNode.physicalWidth_mm > 0 ? newWidth / cutNode.physicalWidth_mm : 1;
    const scaleY = cutNode.physicalHeight_mm > 0 ? newHeight / cutNode.physicalHeight_mm : 1;

    const posX = cutNode.position_mm.x;
    const posY = cutNode.position_mm.y;

    const scaledContours = cutNode.contours.map((c) => ({
      ...c,
      points_mm: c.points_mm.map((pt) => ({
        x: roundPrecision(posX + (pt.x - posX) * scaleX, 3),
        y: roundPrecision(posY + (pt.y - posY) * scaleY, 3),
      })),
    }));

    const newStrokeWidth = cutNode.strokeWidth_mm || 0.30;

    const updatedCutNode: CutContourNode = {
      ...cutNode,
      physicalWidth_mm: newWidth,
      physicalHeight_mm: newHeight,
      aspectRatio: newAspectRatio,
      strokeWidth_mm: newStrokeWidth,
      contours: scaledContours,
      metadata: {
        ...cutNode.metadata,
        manualScaleApplied: true,
      },
    };

    return {
      ...doc,
      nodes: {
        ...doc.nodes,
        [nodeId]: updatedCutNode,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  // --- TRATAMENTO PARA RASTER E VECTOR GROUP ---
  const currentRatio =
    (node as RasterNode | VectorGroupNode).aspectRatio > 0
      ? (node as RasterNode | VectorGroupNode).aspectRatio
      : node.type === 'raster_image'
      ? (node as RasterNode).naturalWidth / (node as RasterNode).naturalHeight
      : (node as VectorGroupNode).physicalWidth_mm / (node as VectorGroupNode).physicalHeight_mm;

  let newWidth = (node as RasterNode | VectorGroupNode).physicalWidth_mm;
  let newHeight = (node as RasterNode | VectorGroupNode).physicalHeight_mm;
  let newAspectRatio = currentRatio;

  // Caso 1: Ambas as dimensões fornecidas simultaneamente
  if (options.physicalWidth_mm !== undefined && options.physicalHeight_mm !== undefined) {
    const valW = validatePhysicalDimension(options.physicalWidth_mm, 'Largura');
    if (!valW.valid) throw new Error(valW.error);
    const valH = validatePhysicalDimension(options.physicalHeight_mm, 'Altura');
    if (!valH.valid) throw new Error(valH.error);

    newWidth = roundPrecision(options.physicalWidth_mm, 2);
    newHeight = roundPrecision(options.physicalHeight_mm, 2);
    newAspectRatio = roundPrecision(newWidth / newHeight, 4);
  }
  // Caso 2: Apenas Largura informada
  else if (options.physicalWidth_mm !== undefined) {
    const valW = validatePhysicalDimension(options.physicalWidth_mm, 'Largura');
    if (!valW.valid) throw new Error(valW.error);

    newWidth = roundPrecision(options.physicalWidth_mm, 2);
    if (keepAspect) {
      newHeight = roundPrecision(calculateHeightFromWidth(newWidth, currentRatio), 2);
    } else {
      newAspectRatio = roundPrecision(newWidth / newHeight, 4);
    }
  }
  // Caso 3: Apenas Altura informada
  else if (options.physicalHeight_mm !== undefined) {
    const valH = validatePhysicalDimension(options.physicalHeight_mm, 'Altura');
    if (!valH.valid) throw new Error(valH.error);

    newHeight = roundPrecision(options.physicalHeight_mm, 2);
    if (keepAspect) {
      newWidth = roundPrecision(calculateWidthFromHeight(newHeight, currentRatio), 2);
    } else {
      newAspectRatio = roundPrecision(newWidth / newHeight, 4);
    }
  }

  const updatedNode = {
    ...node,
    physicalWidth_mm: newWidth,
    physicalHeight_mm: newHeight,
    aspectRatio: newAspectRatio,
  };

  const newNodes = {
    ...doc.nodes,
    [nodeId]: updatedNode,
  };

  // Se o nó alterado for um VectorGroupNode com faca dependente, sincroniza a faca recalculando o contorno
  if (node.type === 'group') {
    const dependentCut = findCutContourForSourceNode(doc, nodeId);
    if (dependentCut) {
      try {
        const cutResult = generateCutContour(updatedNode as VectorGroupNode, { ...doc, nodes: newNodes }, {
          offset_mm: dependentCut.offset_mm,
          joinStyle: dependentCut.joinStyle,
          includeInnerContours: dependentCut.includeInnerContours,
        });

        const relX = dependentCut.metadata?.relativeOffsetX_mm ?? 0;
        const relY = dependentCut.metadata?.relativeOffsetY_mm ?? 0;

        const contours =
          relX !== 0 || relY !== 0
            ? cutResult.contours.map((c) => ({
                ...c,
                points_mm: c.points_mm.map((pt) => ({
                  x: roundPrecision(pt.x + relX, 4),
                  y: roundPrecision(pt.y + relY, 4),
                })),
              }))
            : cutResult.contours;

        newNodes[dependentCut.id] = {
          ...dependentCut,
          contours,
          physicalWidth_mm: cutResult.boundingBox_mm.width_mm,
          physicalHeight_mm: cutResult.boundingBox_mm.height_mm,
          aspectRatio:
            cutResult.boundingBox_mm.height_mm > 0
              ? roundPrecision(cutResult.boundingBox_mm.width_mm / cutResult.boundingBox_mm.height_mm, 4)
              : 1,
          position_mm: {
            x: roundPrecision(cutResult.boundingBox_mm.minX + relX, 2),
            y: roundPrecision(cutResult.boundingBox_mm.minY + relY, 2),
          },
          metadata: {
            ...dependentCut.metadata,
            manualScaleApplied: false,
            totalPoints: cutResult.contours.reduce((sum, c) => sum + c.points_mm.length, 0),
            contourCount: cutResult.contours.length,
            calculatedAt: new Date().toISOString(),
          },
        };
      } catch (err) {
        console.warn('Falha ao sincronizar faca dependente no redimensionamento:', err);
      }
    }
  }

  return {
    ...doc,
    nodes: newNodes,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Atualiza a posição física (X, Y em mm) de um nó no PDM com translação de geometria.
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

  const dx = roundPrecision(newPos.x - currentPos.x, 4);
  const dy = roundPrecision(newPos.y - currentPos.y, 4);

  // Se a posição não mudou, retorna o documento intacto
  if (dx === 0 && dy === 0) {
    return doc;
  }

  // --- CASO 0: O NÓ MOVIDO É UMA GUIA TÉCNICA ---
  if (node.type === 'technical_guide') {
    const guide = node as TechnicalGuideNode;
    const maxDim = guide.orientation === 'vertical' ? doc.dimensions.width_mm : doc.dimensions.height_mm;
    const rawPos = guide.orientation === 'vertical' ? newPos.x : newPos.y;
    const clampedPos = roundPrecision(Math.max(0, Math.min(maxDim, rawPos)), 2);

    const updatedGuide: TechnicalGuideNode = {
      ...guide,
      guidePosition_mm: clampedPos,
      position_mm: {
        x: guide.orientation === 'vertical' ? clampedPos : 0,
        y: guide.orientation === 'horizontal' ? clampedPos : 0,
      },
    };

    return {
      ...doc,
      nodes: {
        ...doc.nodes,
        [nodeId]: updatedGuide,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  // --- CASO 1: O NÓ MOVIDO É A PRÓPRIA FACA DE CORTE ---
  if (node.type === 'cut_contour') {
    const cutNode = node as CutContourNode;

    const shiftedContours = cutNode.contours.map((c) => ({
      ...c,
      points_mm: c.points_mm.map((pt) => ({
        x: roundPrecision(pt.x + dx, 4),
        y: roundPrecision(pt.y + dy, 4),
      })),
    }));

    const updatedCutNode: CutContourNode = {
      ...cutNode,
      position_mm: newPos,
      contours: shiftedContours,
      metadata: {
        ...cutNode.metadata,
        manualPositionApplied: true,
        relativeOffsetX_mm: roundPrecision((cutNode.metadata?.relativeOffsetX_mm ?? 0) + dx, 3),
        relativeOffsetY_mm: roundPrecision((cutNode.metadata?.relativeOffsetY_mm ?? 0) + dy, 3),
      },
    };

    return {
      ...doc,
      nodes: {
        ...doc.nodes,
        [nodeId]: updatedCutNode,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  // --- CASO 2: O NÓ MOVIDO É UM VECTOR GROUP OU RASTER ---
  const updatedNode = {
    ...node,
    position_mm: newPos,
  };

  const newNodes: Record<string, DocumentNode> = {
    ...doc.nodes,
    [nodeId]: updatedNode,
  };

  // Se o nó for um VectorGroupNode com faca vinculada, translada a faca preservando o deslocamento manual relativo
  if (node.type === 'group') {
    const dependentCut = findCutContourForSourceNode(doc, nodeId);
    if (dependentCut) {
      const shiftedCutPos: Position_mm = {
        x: roundPrecision(dependentCut.position_mm.x + dx, 2),
        y: roundPrecision(dependentCut.position_mm.y + dy, 2),
      };

      const shiftedContours = dependentCut.contours.map((c) => ({
        ...c,
        points_mm: c.points_mm.map((pt) => ({
          x: roundPrecision(pt.x + dx, 4),
          y: roundPrecision(pt.y + dy, 4),
        })),
      }));

      newNodes[dependentCut.id] = {
        ...dependentCut,
        position_mm: shiftedCutPos,
        contours: shiftedContours,
      };
    }
  }

  return {
    ...doc,
    nodes: newNodes,
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
  if (!parsed || !parsed.version || !parsed.dimensions || !parsed.nodes) {
    throw new Error('Formato inválido de PrexyonDocument.');
  }
  if (!parsed.productionSettings) {
    parsed.productionSettings = JSON.parse(JSON.stringify(DEFAULT_PRODUCTION_SETTINGS));
  } else {
    parsed.productionSettings = {
      bleed: {
        ...DEFAULT_PRODUCTION_SETTINGS.bleed,
        ...parsed.productionSettings.bleed,
      },
      safetyMargin: {
        ...DEFAULT_PRODUCTION_SETTINGS.safetyMargin,
        ...parsed.productionSettings.safetyMargin,
      },
    };
  }
  return parsed as PrexyonDocument;
}

/**
 * Calcula a área total e dimensões totais considerando a prancheta nominal e a sangria.
 */
export function calculateBleedDimensions(
  dimensions: DocumentDimensions,
  bleed: BleedSettings
): {
  width_mm: number;
  height_mm: number;
  totalWidth_mm: number;
  totalHeight_mm: number;
  offsetX_mm: number;
  offsetY_mm: number;
} {
  const left = bleed.enabled ? bleed.left_mm : 0;
  const right = bleed.enabled ? bleed.right_mm : 0;
  const top = bleed.enabled ? bleed.top_mm : 0;
  const bottom = bleed.enabled ? bleed.bottom_mm : 0;
  const totalW = roundPrecision(dimensions.width_mm + left + right, 2);
  const totalH = roundPrecision(dimensions.height_mm + top + bottom, 2);

  return {
    width_mm: totalW,
    height_mm: totalH,
    totalWidth_mm: totalW,
    totalHeight_mm: totalH,
    offsetX_mm: roundPrecision(-left, 2),
    offsetY_mm: roundPrecision(-top, 2),
  };
}

/**
 * Calcula a área segura interna e sua posição na prancheta.
 */
export function calculateSafetyArea(
  dimensions: DocumentDimensions,
  safety: SafetyMarginSettings
): {
  width_mm: number;
  height_mm: number;
  x_mm: number;
  y_mm: number;
  safeWidth_mm: number;
  safeHeight_mm: number;
  safePosX_mm: number;
  safePosY_mm: number;
} {
  const left = safety.enabled ? safety.left_mm : 0;
  const right = safety.enabled ? safety.right_mm : 0;
  const top = safety.enabled ? safety.top_mm : 0;
  const bottom = safety.enabled ? safety.bottom_mm : 0;
  const safeW = roundPrecision(Math.max(0, dimensions.width_mm - left - right), 2);
  const safeH = roundPrecision(Math.max(0, dimensions.height_mm - top - bottom), 2);

  return {
    width_mm: safeW,
    height_mm: safeH,
    x_mm: roundPrecision(left, 2),
    y_mm: roundPrecision(top, 2),
    safeWidth_mm: safeW,
    safeHeight_mm: safeH,
    safePosX_mm: roundPrecision(left, 2),
    safePosY_mm: roundPrecision(top, 2),
  };
}

/**
 * Valida e atualiza as configurações de sangria (BleedSettings).
 * Limites: 0 mm a 100 mm por lado.
 */
export function updateBleedSettings(
  doc: PrexyonDocument,
  bleedUpdates: Partial<BleedSettings>
): PrexyonDocument {
  const currentBleed = doc.productionSettings?.bleed ?? DEFAULT_PRODUCTION_SETTINGS.bleed;
  const nextBleed: BleedSettings = {
    ...currentBleed,
    ...bleedUpdates,
  };

  // Se linked for true e um valor de lado foi modificado, sincroniza todos os 4 lados
  if (nextBleed.linked) {
    if (bleedUpdates.top_mm !== undefined) {
      nextBleed.right_mm = bleedUpdates.top_mm;
      nextBleed.bottom_mm = bleedUpdates.top_mm;
      nextBleed.left_mm = bleedUpdates.top_mm;
    } else if (bleedUpdates.right_mm !== undefined) {
      nextBleed.top_mm = bleedUpdates.right_mm;
      nextBleed.bottom_mm = bleedUpdates.right_mm;
      nextBleed.left_mm = bleedUpdates.right_mm;
    } else if (bleedUpdates.bottom_mm !== undefined) {
      nextBleed.top_mm = bleedUpdates.bottom_mm;
      nextBleed.right_mm = bleedUpdates.bottom_mm;
      nextBleed.left_mm = bleedUpdates.bottom_mm;
    } else if (bleedUpdates.left_mm !== undefined) {
      nextBleed.top_mm = bleedUpdates.left_mm;
      nextBleed.right_mm = bleedUpdates.left_mm;
      nextBleed.bottom_mm = bleedUpdates.left_mm;
    }
  }

  // Validação de limites (0 a 100 mm)
  for (const side of ['top_mm', 'right_mm', 'bottom_mm', 'left_mm'] as const) {
    const val = nextBleed[side];
    if (typeof val !== 'number' || isNaN(val) || val < 0 || val > 100) {
      throw new Error(`Valor de sangria inválido (${val} mm). Deve ser entre 0 e 100 mm.`);
    }
    nextBleed[side] = roundPrecision(val, 2);
  }

  return {
    ...doc,
    productionSettings: {
      bleed: nextBleed,
      safetyMargin: doc.productionSettings?.safetyMargin ?? DEFAULT_PRODUCTION_SETTINGS.safetyMargin,
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Valida e atualiza as configurações de margem de segurança (SafetyMarginSettings).
 * Validação: left + right < artboard.width e top + bottom < artboard.height
 */
export function updateSafetyMarginSettings(
  doc: PrexyonDocument,
  safetyUpdates: Partial<SafetyMarginSettings>
): PrexyonDocument {
  const currentSafety = doc.productionSettings?.safetyMargin ?? DEFAULT_PRODUCTION_SETTINGS.safetyMargin;
  const nextSafety: SafetyMarginSettings = {
    ...currentSafety,
    ...safetyUpdates,
  };

  if (nextSafety.linked) {
    if (safetyUpdates.top_mm !== undefined) {
      nextSafety.right_mm = safetyUpdates.top_mm;
      nextSafety.bottom_mm = safetyUpdates.top_mm;
      nextSafety.left_mm = safetyUpdates.top_mm;
    } else if (safetyUpdates.right_mm !== undefined) {
      nextSafety.top_mm = safetyUpdates.right_mm;
      nextSafety.bottom_mm = safetyUpdates.right_mm;
      nextSafety.left_mm = safetyUpdates.right_mm;
    } else if (safetyUpdates.bottom_mm !== undefined) {
      nextSafety.top_mm = safetyUpdates.bottom_mm;
      nextSafety.right_mm = safetyUpdates.bottom_mm;
      nextSafety.left_mm = safetyUpdates.bottom_mm;
    } else if (safetyUpdates.left_mm !== undefined) {
      nextSafety.top_mm = safetyUpdates.left_mm;
      nextSafety.right_mm = safetyUpdates.left_mm;
      nextSafety.bottom_mm = safetyUpdates.left_mm;
    }
  }

  for (const side of ['top_mm', 'right_mm', 'bottom_mm', 'left_mm'] as const) {
    const val = nextSafety[side];
    if (typeof val !== 'number' || isNaN(val) || val < 0) {
      throw new Error(`Valor de margem de segurança inválido (${val} mm). Deve ser >= 0 mm.`);
    }
    nextSafety[side] = roundPrecision(val, 2);
  }

  // Validação contra as dimensões da prancheta
  if (nextSafety.left_mm + nextSafety.right_mm >= doc.dimensions.width_mm) {
    throw new Error(
      `Soma das margens horizontais (${nextSafety.left_mm + nextSafety.right_mm} mm) excede ou iguala a largura da prancheta (${doc.dimensions.width_mm} mm).`
    );
  }

  if (nextSafety.top_mm + nextSafety.bottom_mm >= doc.dimensions.height_mm) {
    throw new Error(
      `Soma das margens verticais (${nextSafety.top_mm + nextSafety.bottom_mm} mm) excede ou iguala a altura da prancheta (${doc.dimensions.height_mm} mm).`
    );
  }

  return {
    ...doc,
    productionSettings: {
      bleed: doc.productionSettings?.bleed ?? DEFAULT_PRODUCTION_SETTINGS.bleed,
      safetyMargin: nextSafety,
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Atualiza as dimensões físicas da prancheta (artboard) com validação de limites seguros (10 mm a 5000 mm).
 */
export function updateArtboardDimensions(
  doc: PrexyonDocument,
  dimensions: Partial<DocumentDimensions>
): PrexyonDocument {
  let width_mm = doc.dimensions.width_mm;
  let height_mm = doc.dimensions.height_mm;

  if (dimensions.width_mm !== undefined) {
    const valW = validatePhysicalDimension(dimensions.width_mm, 'Largura da prancheta', 5000);
    if (!valW.valid) throw new Error(valW.error);
    if (dimensions.width_mm < 10) throw new Error('Largura da prancheta deve ser de pelo menos 10 mm.');
    width_mm = roundPrecision(dimensions.width_mm, 2);
  }

  if (dimensions.height_mm !== undefined) {
    const valH = validatePhysicalDimension(dimensions.height_mm, 'Altura da prancheta', 5000);
    if (!valH.valid) throw new Error(valH.error);
    if (dimensions.height_mm < 10) throw new Error('Altura da prancheta deve ser de pelo menos 10 mm.');
    height_mm = roundPrecision(dimensions.height_mm, 2);
  }

  if (width_mm === doc.dimensions.width_mm && height_mm === doc.dimensions.height_mm) {
    return doc;
  }

  // Clampa quaisquer guias técnicas que excederem as novas dimensões da prancheta
  let hasGuideUpdates = false;
  const nextNodes: Record<string, DocumentNode> = {};

  for (const [id, node] of Object.entries(doc.nodes)) {
    if (node.type === 'technical_guide') {
      const guide = node as TechnicalGuideNode;
      if (guide.orientation === 'vertical' && guide.guidePosition_mm > width_mm) {
        hasGuideUpdates = true;
        nextNodes[id] = {
          ...guide,
          guidePosition_mm: width_mm,
          position_mm: { x: width_mm, y: 0 },
        };
      } else if (guide.orientation === 'horizontal' && guide.guidePosition_mm > height_mm) {
        hasGuideUpdates = true;
        nextNodes[id] = {
          ...guide,
          guidePosition_mm: height_mm,
          position_mm: { x: 0, y: height_mm },
        };
      } else {
        nextNodes[id] = node;
      }
    } else {
      nextNodes[id] = node;
    }
  }

  return {
    ...doc,
    dimensions: {
      ...doc.dimensions,
      width_mm,
      height_mm,
    },
    nodes: hasGuideUpdates ? nextNodes : doc.nodes,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Centraliza uma faca de corte (CutContourNode) exatamente sobre o centro do seu VectorGroupNode de origem.
 */
export function centerCutContourOnSource(
  doc: PrexyonDocument,
  cutContourNodeId: string
): { doc: PrexyonDocument; nextCutNode: CutContourNode } {
  const cutNode = doc.nodes[cutContourNodeId] as CutContourNode | undefined;
  if (!cutNode || cutNode.type !== 'cut_contour') {
    throw new Error('Nó de faca de corte inválido ou não encontrado.');
  }

  const sourceNode = doc.nodes[cutNode.sourceNodeId] as VectorGroupNode | undefined;
  if (!sourceNode || sourceNode.type !== 'group') {
    throw new Error('Grupo vetorial de origem não encontrado no documento.');
  }

  const sourceCenterX = sourceNode.position_mm.x + sourceNode.physicalWidth_mm / 2;
  const sourceCenterY = sourceNode.position_mm.y + sourceNode.physicalHeight_mm / 2;

  const cutCenterX = cutNode.position_mm.x + cutNode.physicalWidth_mm / 2;
  const cutCenterY = cutNode.position_mm.y + cutNode.physicalHeight_mm / 2;

  const dx = roundPrecision(sourceCenterX - cutCenterX, 4);
  const dy = roundPrecision(sourceCenterY - cutCenterY, 4);

  const newPosX = roundPrecision(cutNode.position_mm.x + dx, 2);
  const newPosY = roundPrecision(cutNode.position_mm.y + dy, 2);

  const shiftedContours = cutNode.contours.map((c) => ({
    ...c,
    points_mm: c.points_mm.map((pt) => ({
      x: roundPrecision(pt.x + dx, 4),
      y: roundPrecision(pt.y + dy, 4),
    })),
  }));

  const nextCutNode: CutContourNode = {
    ...cutNode,
    position_mm: { x: newPosX, y: newPosY },
    contours: shiftedContours,
    metadata: {
      ...cutNode.metadata,
      manualPositionApplied: false,
      relativeOffsetX_mm: 0,
      relativeOffsetY_mm: 0,
    },
  };

  const newDoc: PrexyonDocument = {
    ...doc,
    nodes: {
      ...doc.nodes,
      [cutContourNodeId]: nextCutNode,
    },
    updatedAt: new Date().toISOString(),
  };

  return { doc: newDoc, nextCutNode };
}

/**
 * Clona profundamente um documento PDM.
 */
export function cloneDocument(doc: PrexyonDocument): PrexyonDocument {
  return JSON.parse(JSON.stringify(doc));
}
