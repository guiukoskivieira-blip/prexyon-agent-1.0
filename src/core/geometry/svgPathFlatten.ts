/**
 * Prexyon SVG Path Flattening Module
 *
 * Converte instruções de caminho SVG (path data 'd') contendo retas e curvas Bézier
 * em anéis poligonais planos aproximados em coordenadas físicas (milímetros).
 * Suporta transformação proporcional direta da viewBox SVG para o espaço da prancheta.
 */

import { GEOMETRY_FLATTEN_TOLERANCE_MM } from './units';

export interface Point2D {
  x: number;
  y: number;
}

export type Polygon2D = Point2D[];

export interface FlattenOptions {
  /** Posição física (origem X, Y) do nó na prancheta em mm */
  position_mm: { x: number; y: number };
  /** Largura física atual do grupo no documento em mm */
  physicalWidth_mm: number;
  /** Altura física atual do grupo no documento em mm */
  physicalHeight_mm: number;
  /** Dimensões da viewBox nativa do SVG original */
  sourceViewBox: { width: number; height: number };
  /** Tolerância máxima de erro para aproximação de curvas em mm (padrão: 0.05 mm) */
  tolerance_mm?: number;
}

interface PathCommand {
  type: string;
  args: number[];
}

/**
 * Faz o parsing de uma string pathData SVG ('d') em uma sequência de comandos normalizados.
 */
function parsePathData(d: string): PathCommand[] {
  const commands: PathCommand[] = [];
  const regex = /([a-df-z])([^a-df-z]*)/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(d)) !== null) {
    const type = match[1];
    const argsString = match[2].trim();
    // Extrai números (incluindo notação científica, números negativos e com ponto)
    const numRegex = /[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g;
    const args: number[] = [];
    let numMatch: RegExpExecArray | null;
    while ((numMatch = numRegex.exec(argsString)) !== null) {
      args.push(parseFloat(numMatch[0]));
    }
    commands.push({ type, args });
  }

  return commands;
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
  if (depth > 12) {
    points.push(p3);
    return;
  }

  // Verifica desvio dos pontos de controle em relação à corda p0-p3
  const d1 = pointToSegmentDistSq(p1, p0, p3);
  const d2 = pointToSegmentDistSq(p2, p0, p3);

  if (d1 <= tolSq && d2 <= tolSq) {
    points.push(p3);
    return;
  }

  // Ponto médio de cada segmento
  const p01 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const p12 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const p23 = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };

  const p012 = { x: (p01.x + p12.x) / 2, y: (p01.y + p12.y) / 2 };
  const p123 = { x: (p12.x + p23.x) / 2, y: (p12.y + p23.y) / 2 };

  const p0123 = { x: (p012.x + p123.x) / 2, y: (p012.y + p123.y) / 2 };

  flattenCubicBezier(p0, p01, p012, p0123, tolSq, points, depth + 1);
  flattenCubicBezier(p0123, p123, p23, p3, tolSq, points, depth + 1);
}

/**
 * Subdivisão adaptativa para curvas Bézier quadráticas.
 */
function flattenQuadraticBezier(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  tolSq: number,
  points: Point2D[],
  depth: number = 0
): void {
  if (depth > 12) {
    points.push(p2);
    return;
  }

  const d = pointToSegmentDistSq(p1, p0, p2);
  if (d <= tolSq) {
    points.push(p2);
    return;
  }

  const p01 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const p12 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const p012 = { x: (p01.x + p12.x) / 2, y: (p01.y + p12.y) / 2 };

  flattenQuadraticBezier(p0, p01, p012, tolSq, points, depth + 1);
  flattenQuadraticBezier(p012, p12, p2, tolSq, points, depth + 1);
}

/**
 * Converte um caminho SVG em uma lista de anéis poligonais transformados para coordenadas físicas (mm).
 */
export function flattenSvgPathToPolygons(
  d: string,
  options: FlattenOptions
): Polygon2D[] {
  const {
    position_mm,
    physicalWidth_mm,
    physicalHeight_mm,
    sourceViewBox,
    tolerance_mm = GEOMETRY_FLATTEN_TOLERANCE_MM,
  } = options;

  const scaleX = physicalWidth_mm / (sourceViewBox.width || 100);
  const scaleY = physicalHeight_mm / (sourceViewBox.height || 100);
  const tolSq = tolerance_mm * tolerance_mm;

  // Função de mapeamento de coordenadas locais do SVG -> coordenadas físicas globais (mm)
  const toPhys = (x: number, y: number): Point2D => ({
    x: position_mm.x + x * scaleX,
    y: position_mm.y + y * scaleY,
  });

  const commands = parsePathData(d);
  const polygons: Polygon2D[] = [];

  let currentPoly: Point2D[] = [];
  let currX = 0;
  let currY = 0;
  let startX = 0;
  let startY = 0;
  let lastControlX = 0;
  let lastControlY = 0;
  let lastCmd = '';

  const closeCurrentPoly = () => {
    if (currentPoly.length >= 3) {
      // Garante que o polígono não tenha pontos consecutivos idênticos
      const cleaned: Point2D[] = [];
      for (let i = 0; i < currentPoly.length; i++) {
        const pt = currentPoly[i];
        const prev = cleaned[cleaned.length - 1];
        if (!prev || Math.hypot(pt.x - prev.x, pt.y - prev.y) > 0.0001) {
          cleaned.push(pt);
        }
      }
      if (cleaned.length >= 3) {
        polygons.push(cleaned);
      }
    }
    currentPoly = [];
  };

  for (const cmd of commands) {
    const { type, args } = cmd;
    let i = 0;

    switch (type) {
      case 'M':
        while (i < args.length) {
          if (i > 0) closeCurrentPoly();
          currX = args[i++];
          currY = args[i++];
          startX = currX;
          startY = currY;
          currentPoly.push(toPhys(currX, currY));
          // Comandos adicionais após M são interpretados como L
          while (i < args.length && (type === 'M' || type === 'm')) {
            currX = args[i++];
            currY = args[i++];
            currentPoly.push(toPhys(currX, currY));
          }
        }
        break;

      case 'm':
        while (i < args.length) {
          if (i > 0) closeCurrentPoly();
          currX += args[i++];
          currY += args[i++];
          startX = currX;
          startY = currY;
          currentPoly.push(toPhys(currX, currY));
          while (i < args.length) {
            currX += args[i++];
            currY += args[i++];
            currentPoly.push(toPhys(currX, currY));
          }
        }
        break;

      case 'L':
        while (i < args.length) {
          currX = args[i++];
          currY = args[i++];
          currentPoly.push(toPhys(currX, currY));
        }
        break;

      case 'l':
        while (i < args.length) {
          currX += args[i++];
          currY += args[i++];
          currentPoly.push(toPhys(currX, currY));
        }
        break;

      case 'H':
        while (i < args.length) {
          currX = args[i++];
          currentPoly.push(toPhys(currX, currY));
        }
        break;

      case 'h':
        while (i < args.length) {
          currX += args[i++];
          currentPoly.push(toPhys(currX, currY));
        }
        break;

      case 'V':
        while (i < args.length) {
          currY = args[i++];
          currentPoly.push(toPhys(currX, currY));
        }
        break;

      case 'v':
        while (i < args.length) {
          currY += args[i++];
          currentPoly.push(toPhys(currX, currY));
        }
        break;

      case 'C':
        while (i + 5 < args.length) {
          const x1 = args[i++];
          const y1 = args[i++];
          const x2 = args[i++];
          const y2 = args[i++];
          const x = args[i++];
          const y = args[i++];

          const p0 = toPhys(currX, currY);
          const p1 = toPhys(x1, y1);
          const p2 = toPhys(x2, y2);
          const p3 = toPhys(x, y);

          flattenCubicBezier(p0, p1, p2, p3, tolSq, currentPoly);

          currX = x;
          currY = y;
          lastControlX = x2;
          lastControlY = y2;
        }
        break;

      case 'c':
        while (i + 5 < args.length) {
          const x1 = currX + args[i++];
          const y1 = currY + args[i++];
          const x2 = currX + args[i++];
          const y2 = currY + args[i++];
          const x = currX + args[i++];
          const y = currY + args[i++];

          const p0 = toPhys(currX, currY);
          const p1 = toPhys(x1, y1);
          const p2 = toPhys(x2, y2);
          const p3 = toPhys(x, y);

          flattenCubicBezier(p0, p1, p2, p3, tolSq, currentPoly);

          currX = x;
          currY = y;
          lastControlX = x2;
          lastControlY = y2;
        }
        break;

      case 'S':
        while (i + 3 < args.length) {
          let x1 = currX;
          let y1 = currY;
          if (lastCmd === 'C' || lastCmd === 'c' || lastCmd === 'S' || lastCmd === 's') {
            x1 = 2 * currX - lastControlX;
            y1 = 2 * currY - lastControlY;
          }
          const x2 = args[i++];
          const y2 = args[i++];
          const x = args[i++];
          const y = args[i++];

          const p0 = toPhys(currX, currY);
          const p1 = toPhys(x1, y1);
          const p2 = toPhys(x2, y2);
          const p3 = toPhys(x, y);

          flattenCubicBezier(p0, p1, p2, p3, tolSq, currentPoly);

          currX = x;
          currY = y;
          lastControlX = x2;
          lastControlY = y2;
        }
        break;

      case 's':
        while (i + 3 < args.length) {
          let x1 = currX;
          let y1 = currY;
          if (lastCmd === 'C' || lastCmd === 'c' || lastCmd === 'S' || lastCmd === 's') {
            x1 = 2 * currX - lastControlX;
            y1 = 2 * currY - lastControlY;
          }
          const x2 = currX + args[i++];
          const y2 = currY + args[i++];
          const x = currX + args[i++];
          const y = currY + args[i++];

          const p0 = toPhys(currX, currY);
          const p1 = toPhys(x1, y1);
          const p2 = toPhys(x2, y2);
          const p3 = toPhys(x, y);

          flattenCubicBezier(p0, p1, p2, p3, tolSq, currentPoly);

          currX = x;
          currY = y;
          lastControlX = x2;
          lastControlY = y2;
        }
        break;

      case 'Q':
        while (i + 3 < args.length) {
          const x1 = args[i++];
          const y1 = args[i++];
          const x = args[i++];
          const y = args[i++];

          const p0 = toPhys(currX, currY);
          const p1 = toPhys(x1, y1);
          const p2 = toPhys(x, y);

          flattenQuadraticBezier(p0, p1, p2, tolSq, currentPoly);

          currX = x;
          currY = y;
          lastControlX = x1;
          lastControlY = y1;
        }
        break;

      case 'q':
        while (i + 3 < args.length) {
          const x1 = currX + args[i++];
          const y1 = currY + args[i++];
          const x = currX + args[i++];
          const y = currY + args[i++];

          const p0 = toPhys(currX, currY);
          const p1 = toPhys(x1, y1);
          const p2 = toPhys(x, y);

          flattenQuadraticBezier(p0, p1, p2, tolSq, currentPoly);

          currX = x;
          currY = y;
          lastControlX = x1;
          lastControlY = y1;
        }
        break;

      case 'Z':
      case 'z':
        if (currentPoly.length > 0) {
          currX = startX;
          currY = startY;
          closeCurrentPoly();
        }
        break;

      default:
        break;
    }

    lastCmd = type;
  }

  closeCurrentPoly();
  return polygons;
}
