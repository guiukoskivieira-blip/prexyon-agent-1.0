/**
 * Prexyon Agent — Vector Path & Contour Integrity Module (Etapa 6.14)
 *
 * Módulo puro, determinístico e matemático para validação de integridade topológica,
 * detecção de auto-interseções, segmentos sobrepostos e validação de área em contornos
 * vetoriais e facas de corte.
 *
 * Recursos:
 * 1. Detecção exata de auto-interseção (self-intersection) em polígonos e polilinhas.
 * 2. Detecção de segmentos sobrepostos / duplicados (overlapping segments).
 * 3. Cálculo determinístico de área fechada em mm² (Shoelace formula).
 * 4. Validação de contornos degenerados (< 3 vértices, área nula ou colinearidade total).
 * 5. Suporte a caminhos curvos SVG via flattening adaptativo controlado para análise.
 * 6. Tolerâncias explícitas configuráveis via ProductionProfile.
 */

import { Point2D, parseSvgPath } from './vectorPathCleaner';
import { ContourPolygon } from '../pdm/types';

export interface Segment2D {
  p1: Point2D;
  p2: Point2D;
  index: number;
  subpathIndex: number;
}

export interface IntersectionPoint {
  point: Point2D;
  seg1Index: number;
  seg2Index: number;
  subpath1Index: number;
  subpath2Index: number;
  isVertexSharing: boolean;
  isCollinearOverlap: boolean;
}

export interface OverlappingSegment {
  seg1Index: number;
  seg2Index: number;
  subpath1Index: number;
  subpath2Index: number;
  overlapLength_mm: number;
}

export interface ContourIntegrityConfig {
  intersectionToleranceMm?: number;
  overlapToleranceMm?: number;
  minimumClosedPathAreaMm2?: number;
  curveFlatteningToleranceMm?: number;
}

export const DEFAULT_INTEGRITY_CONFIG: Required<ContourIntegrityConfig> = {
  intersectionToleranceMm: 0.001,
  overlapToleranceMm: 0.005,
  minimumClosedPathAreaMm2: 0.01,
  curveFlatteningToleranceMm: 0.05,
};

export interface ContourIntegrityResult {
  isValid: boolean;
  isSelfIntersecting: boolean;
  hasOverlappingSegments: boolean;
  isDegenerate: boolean;
  area_mm2: number;
  totalVertices: number;
  totalSegments: number;
  intersectionsCount: number;
  intersections: IntersectionPoint[];
  overlappingSegments: OverlappingSegment[];
  failureReasons: string[];
}

/**
 * Distância euclidiana entre dois pontos 2D.
 */
function dist(p1: Point2D, p2: Point2D): number {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

/**
 * Produto vetorial 2D (cross product) de vetores AB e AC.
 * Retorna valor positivo (anti-horário), negativo (horário) ou ~0 (colinear).
 */
function crossProduct(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/**
 * Verifica se o ponto Q está contido no segmento AB (quando já colineares).
 */
function onSegment(p: Point2D, q: Point2D, r: Point2D, tol: number): boolean {
  return (
    q.x <= Math.max(p.x, r.x) + tol &&
    q.x >= Math.min(p.x, r.x) - tol &&
    q.y <= Math.max(p.y, r.y) + tol &&
    q.y >= Math.min(p.y, r.y) - tol
  );
}

/**
 * Calcula a área de um anel poligonal fechado usando a fórmula Shoelace em mm².
 */
export function calculateClosedPathArea(polygon: Point2D[]): number {
  if (!polygon || polygon.length < 3) return 0;

  let sum = 0;
  const n = polygon.length;

  for (let i = 0; i < n; i++) {
    const curr = polygon[i];
    const next = polygon[(i + 1) % n];
    sum += curr.x * next.y - next.x * curr.y;
  }

  return Math.abs(sum) / 2.0;
}

/**
 * Distância perpendicular ao quadrado de um ponto P até o segmento AB.
 */
function pointToSegmentDistSq(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const dpx = p.x - a.x;
    const dpy = p.y - a.y;
    return dpx * dpx + dpy * dpy;
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  const distX = p.x - projX;
  const distY = p.y - projY;
  return distX * distX + distY * distY;
}

/**
 * Subdivisão adaptativa De Casteljau para curvas Bézier cúbicas.
 */
function flattenCubicBezier(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  tolSq: number,
  points: Point2D[],
  depth: number = 0
): void {
  if (depth > 10) {
    points.push(p3);
    return;
  }

  const d1 = pointToSegmentDistSq(p1, p0, p3);
  const d2 = pointToSegmentDistSq(p2, p0, p3);

  if (d1 <= tolSq && d2 <= tolSq) {
    points.push(p3);
  } else {
    // Ponto médio De Casteljau
    const p01 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    const p12 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const p23 = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
    const p012 = { x: (p01.x + p12.x) / 2, y: (p01.y + p12.y) / 2 };
    const p123 = { x: (p12.x + p23.x) / 2, y: (p12.y + p23.y) / 2 };
    const p0123 = { x: (p012.x + p123.x) / 2, y: (p012.y + p123.y) / 2 };

    flattenCubicBezier(p0, p01, p012, p0123, tolSq, points, depth + 1);
    flattenCubicBezier(p0123, p123, p23, p3, tolSq, points, depth + 1);
  }
}

/**
 * Converte comandos SVG 'd' em subcaminhos poligonais discretizados em mm.
 */
export function flattenSvgPathToPolygons(d: string, toleranceMm: number = 0.05): Point2D[][] {
  const commands = parseSvgPath(d);
  const polygons: Point2D[][] = [];
  let currentPolygon: Point2D[] = [];
  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0;
  const tolSq = toleranceMm * toleranceMm;

  for (const cmd of commands) {
    const isRel = cmd.type === cmd.type.toLowerCase() && cmd.type.toLowerCase() !== 'z';
    const typeUpper = cmd.type.toUpperCase();

    if (typeUpper === 'M') {
      if (currentPolygon.length > 0) {
        polygons.push(currentPolygon);
      }
      currentPolygon = [];
      for (let i = 0; i < cmd.args.length; i += 2) {
        if (i + 1 < cmd.args.length) {
          const x = isRel ? curX + cmd.args[i] : cmd.args[i];
          const y = isRel ? curY + cmd.args[i + 1] : cmd.args[i + 1];
          curX = x;
          curY = y;
          if (i === 0) {
            startX = x;
            startY = y;
          }
          currentPolygon.push({ x, y });
        }
      }
    } else if (typeUpper === 'L') {
      for (let i = 0; i < cmd.args.length; i += 2) {
        if (i + 1 < cmd.args.length) {
          const x = isRel ? curX + cmd.args[i] : cmd.args[i];
          const y = isRel ? curY + cmd.args[i + 1] : cmd.args[i + 1];
          curX = x;
          curY = y;
          currentPolygon.push({ x, y });
        }
      }
    } else if (typeUpper === 'H') {
      for (let i = 0; i < cmd.args.length; i++) {
        const x = isRel ? curX + cmd.args[i] : cmd.args[i];
        curX = x;
        currentPolygon.push({ x, y: curY });
      }
    } else if (typeUpper === 'V') {
      for (let i = 0; i < cmd.args.length; i++) {
        const y = isRel ? curY + cmd.args[i] : cmd.args[i];
        curY = y;
        currentPolygon.push({ x: curX, y });
      }
    } else if (typeUpper === 'C') {
      for (let i = 0; i < cmd.args.length; i += 6) {
        if (i + 5 < cmd.args.length) {
          const p0 = { x: curX, y: curY };
          const p1 = { x: isRel ? curX + cmd.args[i] : cmd.args[i], y: isRel ? curY + cmd.args[i + 1] : cmd.args[i + 1] };
          const p2 = { x: isRel ? curX + cmd.args[i + 2] : cmd.args[i + 2], y: isRel ? curY + cmd.args[i + 3] : cmd.args[i + 3] };
          const p3 = { x: isRel ? curX + cmd.args[i + 4] : cmd.args[i + 4], y: isRel ? curY + cmd.args[i + 5] : cmd.args[i + 5] };

          flattenCubicBezier(p0, p1, p2, p3, tolSq, currentPolygon);
          curX = p3.x;
          curY = p3.y;
        }
      }
    } else if (typeUpper === 'S' || typeUpper === 'Q') {
      for (let i = 0; i < cmd.args.length; i += 4) {
        if (i + 3 < cmd.args.length) {
          const endX = isRel ? curX + cmd.args[i + 2] : cmd.args[i + 2];
          const endY = isRel ? curY + cmd.args[i + 3] : cmd.args[i + 3];
          const midX = isRel ? curX + cmd.args[i] : cmd.args[i];
          const midY = isRel ? curY + cmd.args[i + 1] : cmd.args[i + 1];
          // Aproximação quadrática como cúbica
          const p0 = { x: curX, y: curY };
          const p1 = { x: curX + (2 / 3) * (midX - curX), y: curY + (2 / 3) * (midY - curY) };
          const p2 = { x: endX + (2 / 3) * (midX - endX), y: endY + (2 / 3) * (midY - endY) };
          const p3 = { x: endX, y: endY };
          flattenCubicBezier(p0, p1, p2, p3, tolSq, currentPolygon);
          curX = endX;
          curY = endY;
        }
      }
    } else if (typeUpper === 'Z') {
      curX = startX;
      curY = startY;
    }
  }

  if (currentPolygon.length > 0) {
    polygons.push(currentPolygon);
  }

  return polygons;
}

/**
 * Converte polígonos ou subpaths em uma lista plana de segmentos orientados.
 */
function extractSegmentsFromPolygons(polygons: Point2D[][]): Segment2D[] {
  const segments: Segment2D[] = [];
  let globalIndex = 0;

  for (let spIdx = 0; spIdx < polygons.length; spIdx++) {
    const pts = polygons[spIdx];
    if (pts.length < 2) continue;

    for (let i = 0; i < pts.length; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % pts.length];

      // Ignora segmentos degenerados de comprimento nulo
      if (dist(p1, p2) < 0.0001) continue;

      segments.push({
        p1,
        p2,
        index: globalIndex++,
        subpathIndex: spIdx,
      });
    }
  }

  return segments;
}

/**
 * Testa a interseção geométrica entre dois segmentos 2D.
 */
function testSegmentIntersection(
  s1: Segment2D,
  s2: Segment2D,
  tol: number,
  overlapTol: number
): { intersects: boolean; point?: Point2D; isCollinearOverlap: boolean; isVertexSharing: boolean; overlapLength: number } {
  const { p1, p2 } = s1;
  const { p1: p3, p2: p4 } = s2;

  // 1. Verificação rápida de Bounding Box (AABB)
  const minX1 = Math.min(p1.x, p2.x) - tol;
  const maxX1 = Math.max(p1.x, p2.x) + tol;
  const minY1 = Math.min(p1.y, p2.y) - tol;
  const maxY1 = Math.max(p1.y, p2.y) + tol;

  const minX2 = Math.min(p3.x, p4.x) - tol;
  const maxX2 = Math.max(p3.x, p4.x) + tol;
  const minY2 = Math.min(p3.y, p4.y) - tol;
  const maxY2 = Math.max(p3.y, p4.y) + tol;

  if (maxX1 < minX2 || minX1 > maxX2 || maxY1 < minY2 || minY1 > maxY2) {
    return { intersects: false, isCollinearOverlap: false, isVertexSharing: false, overlapLength: 0 };
  }

  // 2. Checagem de compartilhamento de vértice (segmentos adjacentes)
  const p1EqualsP3 = dist(p1, p3) <= tol;
  const p1EqualsP4 = dist(p1, p4) <= tol;
  const p2EqualsP3 = dist(p2, p3) <= tol;
  const p2EqualsP4 = dist(p2, p4) <= tol;

  const sharesVertex = p1EqualsP3 || p1EqualsP4 || p2EqualsP3 || p2EqualsP4;

  const d1 = crossProduct(p3, p4, p1);
  const d2 = crossProduct(p3, p4, p2);
  const d3 = crossProduct(p1, p2, p3);
  const d4 = crossProduct(p1, p2, p4);

  const isCollinear = Math.abs(d1) <= tol && Math.abs(d2) <= tol && Math.abs(d3) <= tol && Math.abs(d4) <= tol;

  if (isCollinear) {
    // Segmentos colineares: calcular sobreposição ao longo da reta
    const len1 = dist(p1, p2);
    const len2 = dist(p3, p4);
    if (len1 < tol || len2 < tol) {
      return { intersects: false, isCollinearOverlap: false, isVertexSharing: sharesVertex, overlapLength: 0 };
    }

    // Projeção no eixo principal (maior delta)
    const useX = Math.abs(p2.x - p1.x) > Math.abs(p2.y - p1.y);
    const a1 = useX ? Math.min(p1.x, p2.x) : Math.min(p1.y, p2.y);
    const a2 = useX ? Math.max(p1.x, p2.x) : Math.max(p1.y, p2.y);
    const b1 = useX ? Math.min(p3.x, p4.x) : Math.min(p3.y, p4.y);
    const b2 = useX ? Math.max(p3.x, p4.x) : Math.max(p3.y, p4.y);

    const overlapStart = Math.max(a1, b1);
    const overlapEnd = Math.min(a2, b2);
    const overlapDim = overlapEnd - overlapStart;

    if (overlapDim > overlapTol) {
      // Sobreposição colinear real
      const scale = len1 / (a2 - a1 || 1);
      const overlapLength_mm = overlapDim * scale;
      return {
        intersects: true,
        point: { x: (p1.x + p3.x) / 2, y: (p1.y + p3.y) / 2 },
        isCollinearOverlap: true,
        isVertexSharing: sharesVertex,
        overlapLength: overlapLength_mm,
      };
    }

    return { intersects: false, isCollinearOverlap: false, isVertexSharing: sharesVertex, overlapLength: 0 };
  }

  // Se compartilham apenas um vértice e não são colineares sobrepostos, não é interseção inválida
  if (sharesVertex) {
    return { intersects: false, isCollinearOverlap: false, isVertexSharing: true, overlapLength: 0 };
  }

  // 3. Teste de interseção padrão (interior dos segmentos)
  const straddles1 = (d1 > tol && d2 < -tol) || (d1 < -tol && d2 > tol);
  const straddles2 = (d3 > tol && d4 < -tol) || (d3 < -tol && d4 > tol);

  if (straddles1 && straddles2) {
    // Linhas se cruzam no interior
    // Calcula ponto de interseção
    const denom = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
    let ix = (p1.x + p2.x) / 2;
    let iy = (p1.y + p2.y) / 2;
    if (Math.abs(denom) > 1e-9) {
      const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / denom;
      ix = p1.x + t * (p2.x - p1.x);
      iy = p1.y + t * (p2.y - p1.y);
    }
    return {
      intersects: true,
      point: { x: ix, y: iy },
      isCollinearOverlap: false,
      isVertexSharing: false,
      overlapLength: 0,
    };
  }

  // 4. Teste de pontos finais tocando o interior do outro segmento (T-junction)
  if (Math.abs(d1) <= tol && onSegment(p3, p1, p4, tol)) {
    return { intersects: true, point: p1, isCollinearOverlap: false, isVertexSharing: false, overlapLength: 0 };
  }
  if (Math.abs(d2) <= tol && onSegment(p3, p2, p4, tol)) {
    return { intersects: true, point: p2, isCollinearOverlap: false, isVertexSharing: false, overlapLength: 0 };
  }
  if (Math.abs(d3) <= tol && onSegment(p1, p3, p2, tol)) {
    return { intersects: true, point: p3, isCollinearOverlap: false, isVertexSharing: false, overlapLength: 0 };
  }
  if (Math.abs(d4) <= tol && onSegment(p1, p4, p2, tol)) {
    return { intersects: true, point: p4, isCollinearOverlap: false, isVertexSharing: false, overlapLength: 0 };
  }

  return { intersects: false, isCollinearOverlap: false, isVertexSharing: false, overlapLength: 0 };
}

/**
 * Detecta deterministicamente auto-interseções e sobreposições em um conjunto de polígonos.
 */
export function detectContourIntersections(
  polygons: Point2D[][],
  config?: ContourIntegrityConfig
): { intersections: IntersectionPoint[]; overlappingSegments: OverlappingSegment[] } {
  const tol = config?.intersectionToleranceMm ?? DEFAULT_INTEGRITY_CONFIG.intersectionToleranceMm;
  const overlapTol = config?.overlapToleranceMm ?? DEFAULT_INTEGRITY_CONFIG.overlapToleranceMm;

  const segments = extractSegmentsFromPolygons(polygons);
  const intersections: IntersectionPoint[] = [];
  const overlappingSegments: OverlappingSegment[] = [];

  const n = segments.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s1 = segments[i];
      const s2 = segments[j];

      // Segmentos consecutivos no mesmo subpath que compartilham vértice são tratados na função
      const res = testSegmentIntersection(s1, s2, tol, overlapTol);

      if (res.intersects) {
        if (res.isCollinearOverlap) {
          overlappingSegments.push({
            seg1Index: s1.index,
            seg2Index: s2.index,
            subpath1Index: s1.subpathIndex,
            subpath2Index: s2.subpathIndex,
            overlapLength_mm: Number(res.overlapLength.toFixed(4)),
          });
        } else {
          intersections.push({
            point: res.point || { x: (s1.p1.x + s2.p1.x) / 2, y: (s1.p1.y + s2.p1.y) / 2 },
            seg1Index: s1.index,
            seg2Index: s2.index,
            subpath1Index: s1.subpathIndex,
            subpath2Index: s2.subpathIndex,
            isVertexSharing: res.isVertexSharing,
            isCollinearOverlap: false,
          });
        }
      }
    }
  }

  return { intersections, overlappingSegments };
}

/**
 * Normaliza contornos recebidos como ContourPolygon[] ou Point2D[][].
 */
export function normalizeContourPolygons(contours: (ContourPolygon | Point2D[])[]): Point2D[][] {
  return (contours || []).map((c) => {
    if (Array.isArray(c)) return c;
    return (c as ContourPolygon).points_mm || [];
  });
}

/**
 * Valida a integridade topológica e geométrica completa de uma faca de corte (CutContourNode ou Contornos).
 */
export function validateCutContourIntegrity(
  rawContours: (ContourPolygon | Point2D[])[],
  config?: ContourIntegrityConfig
): ContourIntegrityResult {
  const contours = normalizeContourPolygons(rawContours);
  const minArea = config?.minimumClosedPathAreaMm2 ?? DEFAULT_INTEGRITY_CONFIG.minimumClosedPathAreaMm2;
  const failureReasons: string[] = [];

  let totalVertices = 0;
  let totalArea = 0;

  for (const ring of contours) {
    totalVertices += ring.length;
    totalArea += calculateClosedPathArea(ring);
  }

  // 1. Verificação de Vértices Mínimos
  let isDegenerate = false;
  if (contours.length === 0 || totalVertices < 3) {
    isDegenerate = true;
    failureReasons.push('A faca de corte possui menos de 3 vértices úteis para fechamento.');
  }

  // 2. Verificação de Área Mínima
  if (totalArea < minArea) {
    isDegenerate = true;
    failureReasons.push(`A área total fechada da faca (${totalArea.toFixed(4)} mm²) é praticamente zero ou degenerada (mínimo: ${minArea} mm²).`);
  }

  // 3. Verificação de Auto-Interseções e Segmentos Sobrepostos
  const { intersections, overlappingSegments } = detectContourIntersections(contours, config);

  const isSelfIntersecting = intersections.length > 0;
  if (isSelfIntersecting) {
    failureReasons.push(`A faca de corte possui ${intersections.length} ponto(s) de auto-interseção (linhas que se cruzam).`);
  }

  const hasOverlappingSegments = overlappingSegments.length > 0;
  if (hasOverlappingSegments) {
    failureReasons.push(`A faca de corte contém ${overlappingSegments.length} segmento(s) colinear(es) sobreposto(s).`);
  }

  const isValid = !isDegenerate && !isSelfIntersecting && !hasOverlappingSegments;

  const totalSegments = contours.reduce((acc, c) => acc + c.length, 0);

  return {
    isValid,
    isSelfIntersecting,
    hasOverlappingSegments,
    isDegenerate,
    area_mm2: Number(totalArea.toFixed(4)),
    totalVertices,
    totalSegments,
    intersectionsCount: intersections.length,
    intersections,
    overlappingSegments,
    failureReasons,
  };
}

/**
 * Valida a integridade geométrica de um caminho vetorial regular (VectorPathNode).
 */
export function validateVectorPathIntegrity(
  d: string,
  config?: ContourIntegrityConfig
): ContourIntegrityResult {
  const flatteningTol = config?.curveFlatteningToleranceMm ?? DEFAULT_INTEGRITY_CONFIG.curveFlatteningToleranceMm;
  const polygons = flattenSvgPathToPolygons(d, flatteningTol);

  const failureReasons: string[] = [];

  let totalVertices = 0;
  let totalArea = 0;

  for (const poly of polygons) {
    totalVertices += poly.length;
    totalArea += calculateClosedPathArea(poly);
  }

  let isDegenerate = false;
  if (polygons.length === 0 || totalVertices < 2) {
    isDegenerate = true;
    failureReasons.push('O caminho vetorial não possui vértices suficientes para formar geometria válida.');
  }

  const { intersections, overlappingSegments } = detectContourIntersections(polygons, config);

  const isSelfIntersecting = intersections.length > 0;
  if (isSelfIntersecting) {
    failureReasons.push(`O caminho vetorial possui ${intersections.length} ponto(s) de auto-interseção.`);
  }

  const hasOverlappingSegments = overlappingSegments.length > 0;
  if (hasOverlappingSegments) {
    failureReasons.push(`O caminho vetorial contém ${overlappingSegments.length} segmento(s) sobreposto(s).`);
  }

  const isValid = !isDegenerate && !isSelfIntersecting && !hasOverlappingSegments;
  const totalSegments = polygons.reduce((acc, p) => acc + (p.length > 1 ? p.length : 0), 0);

  return {
    isValid,
    isSelfIntersecting,
    hasOverlappingSegments,
    isDegenerate,
    area_mm2: Number(totalArea.toFixed(4)),
    totalVertices,
    totalSegments,
    intersectionsCount: intersections.length,
    intersections,
    overlappingSegments,
    failureReasons,
  };
}
