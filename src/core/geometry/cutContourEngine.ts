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
import { validateCutContourIntegrity, calculateClosedPathArea } from './vectorPathIntegrity';
export { validateCutContourIntegrity, calculateClosedPathArea };

export function cleanPolygonRing(pts: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (!pts || pts.length < 3) return [];

  // 1. Remove pontos duplicados ou quase idênticos (< 0.002 mm)
  const noDups: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (noDups.length === 0) {
      noDups.push(p);
      continue;
    }
    const prev = noDups[noDups.length - 1];
    if (Math.hypot(p.x - prev.x, p.y - prev.y) > 0.002) {
      noDups.push(p);
    }
  }

  // Remove fechamento duplicado no final
  if (noDups.length > 2) {
    const first = noDups[0];
    const last = noDups[noDups.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < 0.002) {
      noDups.pop();
    }
  }

  if (noDups.length < 3) return [];

  // 2. Remove pontos colineares redundantes mantendo tolerância de 1e-4 mm
  const cleaned: Array<{ x: number; y: number }> = [];
  const n = noDups.length;
  for (let i = 0; i < n; i++) {
    const prev = noDups[(i - 1 + n) % n];
    const curr = noDups[i];
    const next = noDups[(i + 1) % n];

    // Área do triângulo formado por prev, curr, next (Shoelace)
    const cross = (curr.x - prev.x) * (next.y - prev.y) - (curr.y - prev.y) * (next.x - prev.x);
    const d1 = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const d2 = Math.hypot(next.x - curr.x, next.y - curr.y);
    const d3 = Math.hypot(next.x - prev.x, next.y - prev.y);

    // Se a distância perpendicular é desprezível e curr está entre prev e next
    const isCollinear = Math.abs(cross) / Math.max(d3, 1e-6) < 0.001 && (d1 + d2 - d3) < 0.002;
    if (!isCollinear) {
      cleaned.push(curr);
    }
  }

  return cleaned.length >= 3 ? cleaned : noDups;
}

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
      const cleaned = cleanPolygonRing(p);
      if (cleaned.length >= 3) {
        allPolygons.push(cleaned);
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
  const minIslandAreaMm2 = 1.0; // Parâmetro interno documentado para eliminação de microilhas e microfuros

  for (const path of offsetPaths) {
    if (path.length < 3) continue;
    const pathArea = area(path);
    const isHole = pathArea < 0;

    // Se solicitado apenas contorno exterior principal (default), filtra furos internos
    if (shouldOnlyKeepOuter && isHole) {
      continue;
    }

    const rawPts = path64ToPolygonMm(path);
    const cleanedPts = cleanPolygonRing(rawPts);
    if (cleanedPts.length < 3) continue;

    // Filtra microilhas e microfuros com área insignificante em mm²
    const polyArea = calculateClosedPathArea(cleanedPts);
    if (polyArea < minIslandAreaMm2 && (isHole || contours.length > 0)) {
      continue;
    }

    contours.push({
      points_mm: cleanedPts,
      isHole,
    });
  }

  if (contours.length === 0) {
    throw new Error('Não consegui gerar uma faca segura automaticamente para esta arte.');
  }

  // Validação estrita de integridade pré-persistência
  const integrity = validateCutContourIntegrity(contours);
  if (!integrity.isValid) {
    throw new Error(`Não consegui gerar uma faca segura automaticamente para esta arte. (Irregularidades: ${integrity.failureReasons.join('; ')})`);
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
