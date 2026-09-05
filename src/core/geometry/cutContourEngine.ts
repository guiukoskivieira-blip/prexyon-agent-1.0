/**
 * Prexyon Cut Contour Geometry Engine
 *
 * Executa as operações booleanas e de offset geométrico real em milímetros
 * utilizando a biblioteca Clipper2 (clipper2-ts) de forma determinística e precisa.
 */

import {
  union,
  inflatePaths,
  JoinType,
  EndType,
  FillRule,
  area,
  Path64,
  Paths64,
} from 'clipper2-ts';
import { Polygon2D, flattenSvgPathToPolygons } from './svgPathFlatten';
import { mmToGeometryUnits, geometryUnitsToMm, GEOMETRY_SCALE } from './units';
import { VectorGroupNode, VectorPathNode, CutContourNode, PrexyonDocument } from '../pdm/types';
import { roundPrecision } from '../pdm/units';

export type CutJoinStyle = 'round' | 'miter' | 'square' | 'bevel';

export interface ContourPolygonResult {
  points_mm: Array<{ x: number; y: number }>;
  isHole: boolean;
}

export interface CutContourGenerationOptions {
  offset_mm: number;
  joinStyle?: CutJoinStyle;
  miterLimit?: number;
  includeInnerContours?: boolean;
  outerOnly?: boolean;
}

export interface CutContourGenerationResult {
  contours: ContourPolygonResult[];
  boundingBox_mm: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width_mm: number;
    height_mm: number;
  };
  sourceNodeId: string;
  offset_mm: number;
  joinStyle: CutJoinStyle;
  includeInnerContours: boolean;
}

/**
 * Mapeia o estilo de canto do Prexyon para o JoinType correspondente do Clipper2.
 */
function mapJoinType(style: CutJoinStyle): JoinType {
  switch (style) {
    case 'round':
      return JoinType.Round;
    case 'miter':
      return JoinType.Miter;
    case 'square':
      return JoinType.Square;
    case 'bevel':
      return JoinType.Bevel;
    default:
      return JoinType.Round;
  }
}

/**
 * Converte um polígono em mm (Polygon2D) para Path64 com escala de alta precisão.
 */
function polygon2DToPath64(poly: Polygon2D): Path64 {
  return poly.map((pt) => ({
    x: Math.round(pt.x * GEOMETRY_SCALE),
    y: Math.round(pt.y * GEOMETRY_SCALE),
  }));
}

/**
 * Converte um Path64 do Clipper2 para pontos em milímetros com 3 casas de precisão.
 */
function path64ToPolygonMm(path: Path64): Array<{ x: number; y: number }> {
  return path.map((pt) => ({
    x: roundPrecision(geometryUnitsToMm(pt.x), 3),
    y: roundPrecision(geometryUnitsToMm(pt.y), 3),
  }));
}

/**
 * Calcula o bounding box em milímetros a partir de um conjunto de contornos.
 */
function calculateBoundingBox(contours: ContourPolygonResult[]) {
  if (contours.length === 0 || contours.every((c) => c.points_mm.length === 0)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width_mm: 0, height_mm: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const c of contours) {
    for (const pt of c.points_mm) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }

  return {
    minX: roundPrecision(minX, 3),
    minY: roundPrecision(minY, 3),
    maxX: roundPrecision(maxX, 3),
    maxY: roundPrecision(maxY, 3),
    width_mm: roundPrecision(maxX - minX, 3),
    height_mm: roundPrecision(maxY - minY, 3),
  };
}

/**
 * Gera a faca de corte externa com offset real em milímetros a partir de um VectorGroupNode do PDM.
 */
export function generateCutContour(
  groupNode: VectorGroupNode,
  doc: PrexyonDocument,
  options: CutContourGenerationOptions
): CutContourGenerationResult {
  const {
    offset_mm,
    joinStyle = 'round',
    miterLimit = 2.0,
    includeInnerContours = false,
    outerOnly = false,
  } = options;

  const shouldOnlyKeepOuter = !includeInnerContours || outerOnly;

  if (offset_mm < 0.05 || offset_mm > 50) {
    throw new Error('Distância de offset inválida. O valor deve estar entre 0.10 e 50.00 mm.');
  }

  // 1. Coleta todos os VectorPathNodes filhos do grupo
  const allPolygons: Polygon2D[] = [];

  for (const childId of groupNode.childrenIds) {
    const pathNode = doc.nodes[childId] as VectorPathNode | undefined;
    if (!pathNode || pathNode.type !== 'vector_path' || !pathNode.d) continue;

    // Converte o SVG Path em polígonos em milímetros reais na prancheta
    const subPolys = flattenSvgPathToPolygons(pathNode.d, {
      position_mm: groupNode.position_mm,
      physicalWidth_mm: groupNode.physicalWidth_mm,
      physicalHeight_mm: groupNode.physicalHeight_mm,
      sourceViewBox: groupNode.sourceViewBox,
    });

    for (const p of subPolys) {
      if (p.length >= 3) {
        allPolygons.push(p);
      }
    }
  }

  if (allPolygons.length === 0) {
    throw new Error('Nenhuma geometria vetorial válida encontrada no grupo para gerar a faca.');
  }

  // 2. Converte para Paths64 inteiros de alta precisão
  const paths64: Paths64 = allPolygons.map(polygon2DToPath64);

  // 3. Executa união booleana para fundir elementos sobrepostos e consolidar contornos
  const unionPaths = union(paths64, FillRule.NonZero);

  if (unionPaths.length === 0) {
    throw new Error('Falha na consolidação booleana dos caminhos vetoriais.');
  }

  // 4. Executa o Offset Externo (Inflate) com Clipper2
  const deltaUnits = mmToGeometryUnits(offset_mm);
  const clipperJoin = mapJoinType(joinStyle);

  const offsetPaths = inflatePaths(
    unionPaths,
    deltaUnits,
    clipperJoin,
    EndType.Polygon,
    miterLimit,
    GEOMETRY_SCALE * 0.02 // Arc tolerance em unidades
  );

  if (offsetPaths.length === 0) {
    throw new Error('Falha ao calcular o contorno de corte com o offset especificado.');
  }

  // 5. Converte o resultado de volta para milímetros e classifica contornos/furos
  const contours: ContourPolygonResult[] = [];

  for (const path of offsetPaths) {
    if (path.length < 3) continue;
    const pathArea = area(path);
    const isHole = pathArea < 0;

    // Se solicitado apenas contorno exterior principal (default), filtra furos internos
    if (shouldOnlyKeepOuter && isHole) {
      continue;
    }

    contours.push({
      points_mm: path64ToPolygonMm(path),
      isHole,
    });
  }

  if (contours.length === 0) {
    throw new Error('Não foi possível gerar um contorno fechado válido para esta geometria.');
  }

  const boundingBox_mm = calculateBoundingBox(contours);

  return {
    contours,
    boundingBox_mm,
    sourceNodeId: groupNode.id,
    offset_mm: roundPrecision(offset_mm, 2),
    joinStyle,
    includeInnerContours: !shouldOnlyKeepOuter,
  };
}

/**
 * Recalcula a geometria de um CutContourNode a partir do seu vetor de origem no PDM.
 */
export function recalculateCutContourGeometry(
  doc: PrexyonDocument,
  cutContourNodeId: string
): CutContourNode {
  const cutNode = doc.nodes[cutContourNodeId] as CutContourNode | undefined;
  if (!cutNode || cutNode.type !== 'cut_contour') {
    throw new Error(`CutContourNode ${cutContourNodeId} não encontrado no documento.`);
  }

  const groupNode = doc.nodes[cutNode.sourceNodeId] as VectorGroupNode | undefined;
  if (!groupNode || groupNode.type !== 'group') {
    throw new Error(`VectorGroupNode de origem ${cutNode.sourceNodeId} não encontrado.`);
  }

  const result = generateCutContour(groupNode, doc, {
    offset_mm: cutNode.offset_mm,
    joinStyle: cutNode.joinStyle,
    includeInnerContours: cutNode.includeInnerContours,
  });

  return {
    ...cutNode,
    contours: result.contours,
    physicalWidth_mm: result.boundingBox_mm.width_mm,
    physicalHeight_mm: result.boundingBox_mm.height_mm,
    aspectRatio:
      result.boundingBox_mm.height_mm > 0
        ? roundPrecision(result.boundingBox_mm.width_mm / result.boundingBox_mm.height_mm, 4)
        : 1,
    position_mm: {
      x: result.boundingBox_mm.minX,
      y: result.boundingBox_mm.minY,
    },
    metadata: {
      ...cutNode.metadata,
      totalPoints: result.contours.reduce((sum, c) => sum + c.points_mm.length, 0),
      contourCount: result.contours.length,
      calculatedAt: new Date().toISOString(),
      manualScaleApplied: false,
    },
  };
}
