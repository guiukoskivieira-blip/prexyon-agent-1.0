/**
 * Prexyon Agent — Vector Path Cleaner & Simplifier (Etapa 6.13)
 *
 * Módulo puro e determinístico para análise, higienização geométrica e simplificação
 * de caminhos vetoriais SVG (path data 'd').
 *
 * Recursos:
 * 1. Detecção e remoção de pontos consecutivos duplicados.
 * 2. Detecção e remoção de segmentos de comprimento zero (ex.: L x y onde x,y == anterior, l 0 0, h 0, v 0).
 * 3. Detecção e remoção de pontos intermediários colineares redundantes (tolerância <= 0.005 mm).
 * 4. Detecção de nós/pontos excessivos (> 500 pontos).
 * 5. Simplificação controlada via Ramer-Douglas-Peucker com cálculo de erro máximo estimado.
 * 6. Preservação estrita de subcaminhos, fechamento (Z/z) e integridade visual.
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface PathAnalysisResult {
  totalPoints: number;
  subpathCount: number;
  duplicatePointsCount: number;
  zeroLengthSegmentsCount: number;
  collinearPointsCount: number;
  isExcessivelyComplex: boolean;
  isClosed: boolean;
}

export interface CleanRedundantResult {
  cleanedD: string;
  nodesBefore: number;
  nodesAfter: number;
  removedDuplicates: number;
  removedZeroLength: number;
  removedCollinear: number;
  totalRemoved: number;
}

export interface SimplifyPathResult {
  simplifiedD: string;
  nodesBefore: number;
  nodesAfter: number;
  nodesReduced: number;
  reductionPercentage: number;
  maxEstimatedError_mm: number;
  tolerance_mm: number;
}

interface ParsedCommand {
  type: string;
  args: number[];
}

/**
 * Faz parsing de comandos SVG 'd' preservando a sequência de instruções.
 */
export function parseSvgPath(d: string): ParsedCommand[] {
  const commands: ParsedCommand[] = [];
  const cmdRegex = /([a-df-z])([^a-df-z]*)/gi;
  let match: RegExpExecArray | null;

  while ((match = cmdRegex.exec(d)) !== null) {
    const type = match[1];
    const argsString = match[2].trim();
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
 * Distância euclidiana entre dois pontos.
 */
function dist(p1: Point2D, p2: Point2D): number {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

/**
 * Distância perpendicular de um ponto P a um segmento AB, com projeção restrita a [0, 1].
 */
function perpendicularDistanceToSegment(p: Point2D, a: Point2D, b: Point2D): { dist: number; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return { dist: dist(p, a), t: 0 };
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  const clampedT = Math.max(0, Math.min(1, t));
  const projX = a.x + clampedT * dx;
  const projY = a.y + clampedT * dy;
  return { dist: Math.hypot(p.x - projX, p.y - projY), t };
}

/**
 * Representa um subcaminho absoluto normalizado.
 */
interface AbsoluteSubpath {
  points: { point: Point2D; originalCmdType: string; isCurve?: boolean; rawCommand?: ParsedCommand }[];
  isClosed: boolean;
  closeChar?: string;
}

/**
 * Converte comandos SVG em subcaminhos com pontos em coordenadas absolutas.
 */
function toAbsoluteSubpaths(commands: ParsedCommand[]): AbsoluteSubpath[] {
  const subpaths: AbsoluteSubpath[] = [];
  let currentSubpath: AbsoluteSubpath | null = null;
  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0;

  for (const cmd of commands) {
    const isRel = cmd.type === cmd.type.toLowerCase() && cmd.type.toLowerCase() !== 'z';
    const typeUpper = cmd.type.toUpperCase();

    if (typeUpper === 'M') {
      if (currentSubpath && currentSubpath.points.length > 0) {
        subpaths.push(currentSubpath);
      }
      currentSubpath = { points: [], isClosed: false };
      const args = cmd.args;
      for (let i = 0; i < args.length; i += 2) {
        if (i + 1 < args.length) {
          const x = isRel && i > 0 ? curX + args[i] : (isRel ? curX + args[i] : args[i]);
          const y = isRel && i > 0 ? curY + args[i + 1] : (isRel ? curY + args[i + 1] : args[i + 1]);
          curX = x;
          curY = y;
          if (i === 0) {
            startX = x;
            startY = y;
            currentSubpath.points.push({ point: { x, y }, originalCmdType: 'M' });
          } else {
            // Comandos M com múltiplos pares de coordenadas funcionam implicitamente como L
            currentSubpath.points.push({ point: { x, y }, originalCmdType: 'L' });
          }
        }
      }
    } else if (typeUpper === 'L') {
      if (!currentSubpath) {
        currentSubpath = { points: [{ point: { x: curX, y: curY }, originalCmdType: 'M' }], isClosed: false };
      }
      for (let i = 0; i < cmd.args.length; i += 2) {
        if (i + 1 < cmd.args.length) {
          const x = isRel ? curX + cmd.args[i] : cmd.args[i];
          const y = isRel ? curY + cmd.args[i + 1] : cmd.args[i + 1];
          curX = x;
          curY = y;
          currentSubpath.points.push({ point: { x, y }, originalCmdType: 'L' });
        }
      }
    } else if (typeUpper === 'H') {
      if (!currentSubpath) {
        currentSubpath = { points: [{ point: { x: curX, y: curY }, originalCmdType: 'M' }], isClosed: false };
      }
      for (let i = 0; i < cmd.args.length; i++) {
        const x = isRel ? curX + cmd.args[i] : cmd.args[i];
        curX = x;
        currentSubpath.points.push({ point: { x, y: curY }, originalCmdType: 'L' });
      }
    } else if (typeUpper === 'V') {
      if (!currentSubpath) {
        currentSubpath = { points: [{ point: { x: curX, y: curY }, originalCmdType: 'M' }], isClosed: false };
      }
      for (let i = 0; i < cmd.args.length; i++) {
        const y = isRel ? curY + cmd.args[i] : cmd.args[i];
        curY = y;
        currentSubpath.points.push({ point: { x: curX, y }, originalCmdType: 'L' });
      }
    } else if (typeUpper === 'Z') {
      if (currentSubpath) {
        currentSubpath.isClosed = true;
        currentSubpath.closeChar = cmd.type;
        curX = startX;
        curY = startY;
      }
    } else {
      // Para curvas e outros comandos (C, S, Q, T, A), armazenamos como nó com marcação isCurve
      if (!currentSubpath) {
        currentSubpath = { points: [{ point: { x: curX, y: curY }, originalCmdType: 'M' }], isClosed: false };
      }
      let endX = curX;
      let endY = curY;
      if (typeUpper === 'C') {
        for (let i = 0; i < cmd.args.length; i += 6) {
          if (i + 5 < cmd.args.length) {
            endX = isRel ? curX + cmd.args[i + 4] : cmd.args[i + 4];
            endY = isRel ? curY + cmd.args[i + 5] : cmd.args[i + 5];
            curX = endX;
            curY = endY;
          }
        }
      } else if (typeUpper === 'S' || typeUpper === 'Q') {
        for (let i = 0; i < cmd.args.length; i += 4) {
          if (i + 3 < cmd.args.length) {
            endX = isRel ? curX + cmd.args[i + 2] : cmd.args[i + 2];
            endY = isRel ? curY + cmd.args[i + 3] : cmd.args[i + 3];
            curX = endX;
            curY = endY;
          }
        }
      } else if (typeUpper === 'T') {
        for (let i = 0; i < cmd.args.length; i += 2) {
          if (i + 1 < cmd.args.length) {
            endX = isRel ? curX + cmd.args[i] : cmd.args[i];
            endY = isRel ? curY + cmd.args[i + 1] : cmd.args[i + 1];
            curX = endX;
            curY = endY;
          }
        }
      } else if (typeUpper === 'A') {
        for (let i = 0; i < cmd.args.length; i += 7) {
          if (i + 6 < cmd.args.length) {
            endX = isRel ? curX + cmd.args[i + 5] : cmd.args[i + 5];
            endY = isRel ? curY + cmd.args[i + 6] : cmd.args[i + 6];
            curX = endX;
            curY = endY;
          }
        }
      }
      currentSubpath.points.push({
        point: { x: curX, y: curY },
        originalCmdType: cmd.type,
        isCurve: true,
        rawCommand: cmd
      });
    }
  }

  if (currentSubpath && currentSubpath.points.length > 0) {
    subpaths.push(currentSubpath);
  }

  return subpaths;
}

/**
 * Formata um número para string SVG limpa (máximo 4 casas decimais, sem zeros à direita).
 */
function formatCoord(n: number): string {
  const rounded = Number(n.toFixed(4));
  return Number.isInteger(rounded) ? rounded.toString() : rounded.toString();
}

/**
 * Analisa as propriedades geométricas de um path SVG.
 */
export function analyzeSvgPath(
  d: string,
  options?: { collinearToleranceMm?: number; complexityThreshold?: number }
): PathAnalysisResult {
  const collinearTol = options?.collinearToleranceMm ?? 0.005;
  const complexityLimit = options?.complexityThreshold ?? 500;

  const commands = parseSvgPath(d);
  const subpaths = toAbsoluteSubpaths(commands);

  let totalPoints = 0;
  let duplicatePointsCount = 0;
  let zeroLengthSegmentsCount = 0;
  let collinearPointsCount = 0;
  let isClosed = false;

  for (const sp of subpaths) {
    totalPoints += sp.points.length;
    if (sp.isClosed) isClosed = true;

    const pts = sp.points;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1].point;
      const curr = pts[i].point;
      const dVal = dist(prev, curr);

      if (dVal < 0.0001) {
        duplicatePointsCount++;
        zeroLengthSegmentsCount++;
      }
    }

    // Verifica fechamento redundante (último ponto == primeiro ponto)
    if (sp.isClosed && pts.length > 2) {
      const first = pts[0].point;
      const last = pts[pts.length - 1].point;
      if (dist(first, last) < 0.0001) {
        duplicatePointsCount++;
      }
    }

    // Verifica colinearidade em sequências de retas A -> B -> C
    for (let i = 1; i < pts.length - 1; i++) {
      if (pts[i - 1].isCurve || pts[i].isCurve || pts[i + 1].isCurve) continue;
      const a = pts[i - 1].point;
      const b = pts[i].point;
      const c = pts[i + 1].point;

      const { dist: perpDist, t } = perpendicularDistanceToSegment(b, a, c);
      if (perpDist <= collinearTol && t > 0 && t < 1) {
        collinearPointsCount++;
      }
    }
  }

  return {
    totalPoints,
    subpathCount: subpaths.length,
    duplicatePointsCount,
    zeroLengthSegmentsCount,
    collinearPointsCount,
    isExcessivelyComplex: totalPoints > complexityLimit,
    isClosed
  };
}

/**
 * Remove pontos consecutivos duplicados, segmentos de comprimento zero e pontos colineares redundantes.
 * Retorna o SVG `d` higienizado de forma determinística e segura.
 */
export function removeRedundantVectorPoints(
  d: string,
  options?: { collinearToleranceMm?: number }
): CleanRedundantResult {
  const collinearTol = options?.collinearToleranceMm ?? 0.005;
  const commands = parseSvgPath(d);
  const subpaths = toAbsoluteSubpaths(commands);

  let nodesBefore = 0;
  let nodesAfter = 0;
  let removedDuplicates = 0;
  let removedZeroLength = 0;
  let removedCollinear = 0;

  const reconstructedParts: string[] = [];

  for (const sp of subpaths) {
    nodesBefore += sp.points.length;
    let pts = [...sp.points];

    // Passo 1: Remover duplicatas consecutivas e segmentos de tamanho zero
    const deduped: typeof pts = [];
    for (let i = 0; i < pts.length; i++) {
      if (i === 0) {
        deduped.push(pts[i]);
      } else {
        const prev = deduped[deduped.length - 1].point;
        const curr = pts[i].point;
        if (dist(prev, curr) < 0.0001 && !pts[i].isCurve) {
          removedDuplicates++;
          removedZeroLength++;
        } else {
          deduped.push(pts[i]);
        }
      }
    }

    // Se o último ponto for idêntico ao primeiro em um subcaminho fechado, removemos a redundância
    if (sp.isClosed && deduped.length > 2) {
      const first = deduped[0].point;
      const last = deduped[deduped.length - 1].point;
      if (dist(first, last) < 0.0001 && !deduped[deduped.length - 1].isCurve) {
        deduped.pop();
        removedDuplicates++;
      }
    }

    // Passo 2: Remover pontos colineares intermediários estritos
    let changed = true;
    while (changed && deduped.length > 2) {
      changed = false;
      for (let i = 1; i < deduped.length - 1; i++) {
        if (deduped[i - 1].isCurve || deduped[i].isCurve || deduped[i + 1].isCurve) {
          continue;
        }
        const a = deduped[i - 1].point;
        const b = deduped[i].point;
        const c = deduped[i + 1].point;

        const { dist: perpDist, t } = perpendicularDistanceToSegment(b, a, c);
        if (perpDist <= collinearTol && t >= 0 && t <= 1) {
          deduped.splice(i, 1);
          removedCollinear++;
          changed = true;
          break; // reinicia o scan para segurança topológica
        }
      }
    }

    nodesAfter += deduped.length;

    // Reconstrói a string SVG para este subcaminho
    const subpathStrs: string[] = [];
    for (let i = 0; i < deduped.length; i++) {
      const node = deduped[i];
      if (i === 0) {
        subpathStrs.push(`M ${formatCoord(node.point.x)} ${formatCoord(node.point.y)}`);
      } else if (node.isCurve && node.rawCommand) {
        // Preserva o comando original de curva
        const raw = node.rawCommand;
        const argsStr = raw.args.map(formatCoord).join(' ');
        subpathStrs.push(`${raw.type} ${argsStr}`);
      } else {
        subpathStrs.push(`L ${formatCoord(node.point.x)} ${formatCoord(node.point.y)}`);
      }
    }

    if (sp.isClosed) {
      subpathStrs.push(sp.closeChar || 'Z');
    }

    reconstructedParts.push(subpathStrs.join(' '));
  }

  const cleanedD = reconstructedParts.join(' ').trim();
  const totalRemoved = removedDuplicates + removedCollinear;

  return {
    cleanedD: cleanedD || d,
    nodesBefore,
    nodesAfter,
    removedDuplicates,
    removedZeroLength,
    removedCollinear,
    totalRemoved
  };
}

/**
 * Algoritmo Ramer-Douglas-Peucker para simplificação de polilinhas 2D.
 */
function ramerDouglasPeucker(points: Point2D[], tolerance: number): { points: Point2D[]; maxError: number } {
  if (points.length <= 2) {
    return { points: [...points], maxError: 0 };
  }

  let dmax = 0;
  let index = 0;
  const end = points.length - 1;

  for (let i = 1; i < end; i++) {
    const { dist: d } = perpendicularDistanceToSegment(points[i], points[0], points[end]);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }

  if (dmax > tolerance) {
    const rec1 = ramerDouglasPeucker(points.slice(0, index + 1), tolerance);
    const rec2 = ramerDouglasPeucker(points.slice(index), tolerance);

    const merged = rec1.points.slice(0, -1).concat(rec2.points);
    return {
      points: merged,
      maxError: Math.max(rec1.maxError, rec2.maxError)
    };
  } else {
    return {
      points: [points[0], points[end]],
      maxError: dmax
    };
  }
}

/**
 * Simplifica um caminho SVG usando Douglas-Peucker com cálculo de erro máximo estimado.
 */
export function simplifyVectorPath(
  d: string,
  toleranceMm: number = 0.05
): SimplifyPathResult {
  const commands = parseSvgPath(d);
  const subpaths = toAbsoluteSubpaths(commands);

  let nodesBefore = 0;
  let nodesAfter = 0;
  let maxEstimatedError_mm = 0;

  const reconstructedParts: string[] = [];

  for (const sp of subpaths) {
    nodesBefore += sp.points.length;
    const pts = sp.points.map(p => p.point);

    if (pts.length <= 2) {
      nodesAfter += pts.length;
      const subpathStrs = pts.map((p, i) => (i === 0 ? `M ${formatCoord(p.x)} ${formatCoord(p.y)}` : `L ${formatCoord(p.x)} ${formatCoord(p.y)}`));
      if (sp.isClosed) subpathStrs.push(sp.closeChar || 'Z');
      reconstructedParts.push(subpathStrs.join(' '));
      continue;
    }

    let simplifiedPts: Point2D[];
    let subMaxError = 0;

    if (sp.isClosed) {
      // Para polígono fechado, simplificamos em duas metades preservando fechamento
      const mid = Math.floor(pts.length / 2);
      const half1 = ramerDouglasPeucker(pts.slice(0, mid + 1), toleranceMm);
      const half2 = ramerDouglasPeucker(pts.slice(mid).concat([pts[0]]), toleranceMm);

      simplifiedPts = half1.points.slice(0, -1).concat(half2.points.slice(0, -1));
      subMaxError = Math.max(half1.maxError, half2.maxError);
    } else {
      const res = ramerDouglasPeucker(pts, toleranceMm);
      simplifiedPts = res.points;
      subMaxError = res.maxError;
    }

    if (subMaxError > maxEstimatedError_mm) {
      maxEstimatedError_mm = subMaxError;
    }

    nodesAfter += simplifiedPts.length;

    const subpathStrs: string[] = [];
    for (let i = 0; i < simplifiedPts.length; i++) {
      const p = simplifiedPts[i];
      if (i === 0) {
        subpathStrs.push(`M ${formatCoord(p.x)} ${formatCoord(p.y)}`);
      } else {
        subpathStrs.push(`L ${formatCoord(p.x)} ${formatCoord(p.y)}`);
      }
    }

    if (sp.isClosed) {
      subpathStrs.push(sp.closeChar || 'Z');
    }

    reconstructedParts.push(subpathStrs.join(' '));
  }

  const simplifiedD = reconstructedParts.join(' ').trim() || d;
  const nodesReduced = Math.max(0, nodesBefore - nodesAfter);
  const reductionPercentage = nodesBefore > 0 ? Number(((nodesReduced / nodesBefore) * 100).toFixed(1)) : 0;

  return {
    simplifiedD,
    nodesBefore,
    nodesAfter,
    nodesReduced,
    reductionPercentage,
    maxEstimatedError_mm: Number(maxEstimatedError_mm.toFixed(4)),
    tolerance_mm: toleranceMm
  };
}
