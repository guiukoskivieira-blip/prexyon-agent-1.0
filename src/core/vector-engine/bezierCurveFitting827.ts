/**
 * PRYX — ETAPA 8.27
 * BÉZIER RECONSTRUCTION, SEGMENT CONSOLIDATION & CURVE FITTING
 *
 * Módulo matemático determinístico para:
 * 1. Simplificação de contorno por Visvalingam–Whyatt (área de triângulo em px²).
 * 2. Detecção robusta de cantos, inflexões e pontos dominantes (multiescala).
 * 3. Curve fitting recursivo adaptativo de Bézier cúbica (Philip J. Schneider, 1990).
 * 4. Reparametrização por Newton-Raphson e cálculo rigoroso de erro em distância euclidiana (px).
 * 5. Fusão bottom-up de curvas adjacentes com preservação e validação contra samples originais.
 * 6. Suporte completo a contornos fechados (invariância à rotação de início).
 */

import {
  CubicBezierSegment,
  RefinedPath,
  parseSvgToSegments,
  serializeSegmentsToSvg,
  extractSvgDimensions,
} from './vectorRefinementBenchmark826';

export interface Point {
  x: number;
  y: number;
}

export type DominantPointClass =
  | 'SMOOTH'
  | 'CORNER'
  | 'INFLECTION'
  | 'CUSP'
  | 'TERMINAL'
  | 'AMBIGUOUS';

export interface ClassifiedContourPoint {
  index: number;
  point: Point;
  classification: DominantPointClass;
  angleDegrees: number;
  curvature: number;
}

// ============================================================================
// 1. VISVALINGAM–WHYATT POLYLINE SIMPLIFICATION (px² dimensional area)
// ============================================================================

/**
 * Calcula a área efetiva do triângulo formado pelos pontos (p[i-1], p[i], p[i+1]) em px².
 */
export function triangleArea(a: Point, b: Point, c: Point): number {
  return 0.5 * Math.abs(a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
}

/**
 * Simplificação Visvalingam–Whyatt que remove iterativamente o ponto de menor área efetiva
 * até que todos os triângulos restantes tenham área >= simplify_area_px2.
 * Preserva os extremos em contornos abertos e garante integridade em contornos fechados.
 */
export function simplifyVisvalingamWhyatt(
  points: Point[],
  simplify_area_px2: number,
  isClosed: boolean = false
): Point[] {
  if (points.length <= (isClosed ? 3 : 2) || simplify_area_px2 <= 0) {
    return points.map((p) => ({ ...p }));
  }

  let pts = points.map((p) => ({ ...p }));
  const minPoints = isClosed ? 3 : 2;

  while (pts.length > minPoints) {
    let minArea = Infinity;
    let minIndex = -1;

    const n = pts.length;
    const count = isClosed ? n : n - 2;
    const startIdx = isClosed ? 0 : 1;

    for (let k = 0; k < count; k++) {
      const i = startIdx + k;
      const prev = pts[(i - 1 + n) % n];
      const curr = pts[i % n];
      const next = pts[(i + 1) % n];
      const area = triangleArea(prev, curr, next);

      if (area < minArea) {
        minArea = area;
        minIndex = i % n;
      }
    }

    if (minArea < simplify_area_px2 && minIndex !== -1) {
      pts.splice(minIndex, 1);
    } else {
      break;
    }
  }

  return pts;
}

// ============================================================================
// 2. CORNER & INFLECTION DOMINANT POINT DETECTION
// ============================================================================

/**
 * Classifica pontos de um contorno em cantos, inflexões, cusps e junções suaves.
 */
export function classifyContourPoints(
  points: Point[],
  isClosed: boolean = false,
  windowSize: number = 3
): ClassifiedContourPoint[] {
  const n = points.length;
  const result: ClassifiedContourPoint[] = [];

  if (n < 3) {
    return points.map((p, idx) => ({
      index: idx,
      point: { ...p },
      classification: idx === 0 || idx === n - 1 ? 'TERMINAL' : 'SMOOTH',
      angleDegrees: 0,
      curvature: 0,
    }));
  }

  for (let i = 0; i < n; i++) {
    if (!isClosed && (i === 0 || i === n - 1)) {
      result.push({
        index: i,
        point: { ...points[i] },
        classification: 'TERMINAL',
        angleDegrees: 0,
        curvature: 0,
      });
      continue;
    }

    const w = Math.min(windowSize, Math.floor((n - 1) / 2));
    const prevIdx = (i - w + n) % n;
    const nextIdx = (i + w) % n;

    const pPrev = points[prevIdx];
    const pCurr = points[i];
    const pNext = points[nextIdx];

    const v1 = { x: pCurr.x - pPrev.x, y: pCurr.y - pPrev.y };
    const v2 = { x: pNext.x - pCurr.x, y: pNext.y - pCurr.y };

    const len1 = Math.hypot(v1.x, v1.y) || 1e-9;
    const len2 = Math.hypot(v2.x, v2.y) || 1e-9;

    const dot = (v1.x * v2.x + v1.y * v2.y) / (len1 * len2);
    const clampedDot = Math.max(-1, Math.min(1, dot));
    const angleRad = Math.acos(clampedDot);
    const angleDeg = (angleRad * 180) / Math.PI;

    // Cross product (orientação do giro)
    const cross = (v1.x * v2.y - v1.y * v2.x) / (len1 * len2);
    const curvature = cross / ((len1 + len2) * 0.5);

    let classification: DominantPointClass = 'SMOOTH';

    if (angleDeg > 85) {
      classification = 'CUSP';
    } else if (angleDeg > 32) {
      classification = 'CORNER';
    } else if (Math.abs(angleDeg) > 15) {
      classification = 'AMBIGUOUS';
    }

    result.push({
      index: i,
      point: { ...pCurr },
      classification,
      angleDegrees: angleDeg,
      curvature,
    });
  }

  // Detectar inflexões verificando mudança de sinal da curvatura ao longo de janela suave
  for (let i = 1; i < result.length - 1; i++) {
    if (result[i].classification === 'SMOOTH' || result[i].classification === 'AMBIGUOUS') {
      const prevCurv = result[i - 1].curvature;
      const nextCurv = result[i + 1].curvature;
      if (prevCurv * nextCurv < -1e-6 && Math.abs(prevCurv - nextCurv) > 0.005) {
        result[i].classification = 'INFLECTION';
      }
    }
  }

  return result;
}

// ============================================================================
// 3. PHILIP J. SCHNEIDER ADAPTIVE CUBIC BÉZIER CURVE FITTER
// ============================================================================

/**
 * Avalia Bézier cúbica no parâmetro t in [0, 1].
 */
export function evaluateCubicBezier(b: CubicBezierSegment, t: number): Point {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x: mt3 * b.p0.x + 3 * mt2 * t * b.p1.x + 3 * mt * t2 * b.p2.x + t3 * b.p3.x,
    y: mt3 * b.p0.y + 3 * mt2 * t * b.p1.y + 3 * mt * t2 * b.p2.y + t3 * b.p3.y,
  };
}

/**
 * Primeira derivada B'(t).
 */
export function evaluateCubicBezierDerivative(b: CubicBezierSegment, t: number): Point {
  const mt = 1 - t;
  return {
    x: 3 * mt * mt * (b.p1.x - b.p0.x) + 6 * mt * t * (b.p2.x - b.p1.x) + 3 * t * t * (b.p3.x - b.p2.x),
    y: 3 * mt * mt * (b.p1.y - b.p0.y) + 6 * mt * t * (b.p2.y - b.p1.y) + 3 * t * t * (b.p3.y - b.p2.y),
  };
}

/**
 * Segunda derivada B''(t).
 */
export function evaluateCubicBezierSecondDerivative(b: CubicBezierSegment, t: number): Point {
  const mt = 1 - t;
  return {
    x: 6 * mt * (b.p2.x - 2 * b.p1.x + b.p0.x) + 6 * t * (b.p3.x - 2 * b.p2.x + b.p1.x),
    y: 6 * mt * (b.p2.y - 2 * b.p1.y + b.p0.y) + 6 * t * (b.p3.y - 2 * b.p2.y + b.p1.y),
  };
}

/**
 * Calcula a parametrização por comprimento de corda (Chord-length parameterization).
 */
export function chordLengthParameterize(points: Point[]): number[] {
  const u: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const dist = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    u.push(u[i - 1] + dist);
  }
  const totalLength = u[u.length - 1];
  if (totalLength > 1e-9) {
    for (let i = 1; i < u.length; i++) {
      u[i] /= totalLength;
    }
  } else {
    for (let i = 1; i < u.length; i++) {
      u[i] = i / (points.length - 1);
    }
  }
  return u;
}

/**
 * Estima o vetor unitário tangente à esquerda (no início da curva).
 */
export function computeLeftTangent(points: Point[]): Point {
  if (points.length >= 3) {
    const p0 = points[0];
    const p1 = points[1];
    const p2 = points[2];
    const dx = -p2.x + 4 * p1.x - 3 * p0.x;
    const dy = -p2.y + 4 * p1.y - 3 * p0.y;
    const len = Math.hypot(dx, dy);
    if (len > 1e-9) return { x: dx / len, y: dy / len };
  }
  const p0 = points[0];
  const p1 = points[1] || points[0];
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1e-9;
  return { x: dx / len, y: dy / len };
}

/**
 * Estima o vetor unitário tangente à direita (no final da curva).
 */
export function computeRightTangent(points: Point[]): Point {
  const n = points.length;
  if (n >= 3) {
    const pn = points[n - 1];
    const pn1 = points[n - 2];
    const pn2 = points[n - 3];
    const dx = -pn2.x + 4 * pn1.x - 3 * pn.x;
    const dy = -pn2.y + 4 * pn1.y - 3 * pn.y;
    const len = Math.hypot(dx, dy);
    if (len > 1e-9) return { x: dx / len, y: dy / len };
  }
  const pn = points[n - 1];
  const pPrev = points[n - 2] || points[0];
  const dx = pPrev.x - pn.x;
  const dy = pPrev.y - pn.y;
  const len = Math.hypot(dx, dy) || 1e-9;
  return { x: dx / len, y: dy / len };
}

/**
 * Estima a tangente central no índice de split.
 */
export function computeCenterTangent(points: Point[], splitIdx: number): Point {
  const pPrev = points[Math.max(0, splitIdx - 1)];
  const pNext = points[Math.min(points.length - 1, splitIdx + 1)];
  const dx = pNext.x - pPrev.x;
  const dy = pNext.y - pPrev.y;
  const len = Math.hypot(dx, dy) || 1e-9;
  return { x: dx / len, y: dy / len };
}

/**
 * Resolve o sistema dos mínimos quadrados para encontrar os handles de controle C1 e C2
 * dados P0, P3, tangentes unitárias t1, t2 e parâmetros u.
 */
export function generateBezierLeastSquares(
  points: Point[],
  uPrime: number[],
  tHat1: Point,
  tHat2: Point
): CubicBezierSegment {
  const n = points.length;
  const p0 = points[0];
  const p3 = points[n - 1];

  // Matriz C de tamanho 2x2 e vetor X de tamanho 2
  let c00 = 0, c01 = 0, c10 = 0, c11 = 0;
  let x0 = 0, x1 = 0;

  for (let i = 0; i < n; i++) {
    const u = uPrime[i];
    const mt = 1 - u;

    // Funções de base de Bernstein
    const b0 = mt * mt * mt;
    const b1 = 3 * mt * mt * u;
    const b2 = 3 * mt * u * u;
    const b3 = u * u * u;

    // Vetores A_i1 = tHat1 * b1, A_i2 = tHat2 * b2
    const a1x = tHat1.x * b1;
    const a1y = tHat1.y * b1;
    const a2x = tHat2.x * b2;
    const a2y = tHat2.y * b2;

    c00 += a1x * a1x + a1y * a1y;
    c01 += a1x * a2x + a1y * a2y;
    c10 = c01;
    c11 += a2x * a2x + a2y * a2y;

    // tmp = points[i] - (p0*b0 + p0*b1 + p3*b2 + p3*b3)
    const px = points[i].x - (p0.x * b0 + p0.x * b1 + p3.x * b2 + p3.x * b3);
    const py = points[i].y - (p0.y * b0 + p0.y * b1 + p3.y * b2 + p3.y * b3);

    x0 += a1x * px + a1y * py;
    x1 += a2x * px + a2y * py;
  }

  // Determinante do sistema 2x2
  const det = c00 * c11 - c10 * c01;
  const chordDist = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  let alphaL = chordDist / 3;
  let alphaR = chordDist / 3;

  if (Math.abs(det) > 1e-12) {
    const detL = x0 * c11 - x1 * c01;
    const detR = c00 * x1 - c10 * x0;

    const solvedL = detL / det;
    const solvedR = detR / det;

    // Validar se as distâncias calculadas são positivas e razoáveis
    if (solvedL > 1e-6 && solvedR > 1e-6 && solvedL < chordDist * 4 && solvedR < chordDist * 4) {
      alphaL = solvedL;
      alphaR = solvedR;
    }
  }

  const p1: Point = {
    x: p0.x + tHat1.x * alphaL,
    y: p0.y + tHat1.y * alphaL,
  };
  const p2: Point = {
    x: p3.x + tHat2.x * alphaR,
    y: p3.y + tHat2.y * alphaR,
  };

  return { p0, p1, p2, p3 };
}

/**
 * Reparametrização dos pontos usando o método de Newton-Raphson.
 */
export function reparameterizeNewtonRaphson(
  bezier: CubicBezierSegment,
  points: Point[],
  u: number[]
): number[] {
  const uPrime: number[] = [];

  for (let i = 0; i < points.length; i++) {
    let t = u[i];
    const pt = points[i];

    // 2 iterações de Newton-Raphson por ponto
    for (let iter = 0; iter < 2; iter++) {
      const q = evaluateCubicBezier(bezier, t);
      const qPrime = evaluateCubicBezierDerivative(bezier, t);
      const qSecond = evaluateCubicBezierSecondDerivative(bezier, t);

      const num = (q.x - pt.x) * qPrime.x + (q.y - pt.y) * qPrime.y;
      const den =
        qPrime.x * qPrime.x +
        qPrime.y * qPrime.y +
        (q.x - pt.x) * qSecond.x +
        (q.y - pt.y) * qSecond.y;

      if (Math.abs(den) > 1e-12) {
        t = t - num / den;
      }
      t = Math.max(0, Math.min(1, t));
    }
    uPrime.push(t);
  }

  return uPrime;
}

/**
 * Calcula o erro máximo euclidiano em PIXELS LINEARES (px) entre os pontos e a Bézier.
 * Retorna também o índice de maior desvio para split.
 */
export function computeMaxEuclideanError(
  bezier: CubicBezierSegment,
  points: Point[],
  uPrime: number[]
): { maxErrorPx: number; splitIndex: number; rmsErrorPx: number } {
  let maxDistSq = 0;
  let sumDistSq = 0;
  let splitIndex = Math.floor(points.length / 2);

  for (let i = 0; i < points.length; i++) {
    const bPt = evaluateCubicBezier(bezier, uPrime[i]);
    const dx = bPt.x - points[i].x;
    const dy = bPt.y - points[i].y;
    const distSq = dx * dx + dy * dy;

    sumDistSq += distSq;
    if (distSq > maxDistSq) {
      maxDistSq = distSq;
      splitIndex = i;
    }
  }

  const maxErrorPx = Math.sqrt(maxDistSq);
  const rmsErrorPx = Math.sqrt(sumDistSq / Math.max(1, points.length));

  // Proteção para evitar split nos extremos
  if (splitIndex <= 0) splitIndex = 1;
  if (splitIndex >= points.length - 1) splitIndex = points.length - 2;

  return { maxErrorPx, splitIndex, rmsErrorPx };
}

export interface CurveFitResult {
  segments: CubicBezierSegment[];
  maxErrorPx: number;
  rmsErrorPx: number;
  originalPointsPerSegment: Point[][];
}

/**
 * Algoritmo recursivo de Schneider para ajuste adaptativo de Bézier cúbica.
 */
export function fitCubicCurveRecursive(
  points: Point[],
  tHat1: Point,
  tHat2: Point,
  fit_error_px: number,
  maxDepth: number = 10,
  currentDepth: number = 0
): CurveFitResult {
  const n = points.length;

  if (n <= 2) {
    const p0 = points[0];
    const p3 = points[n - 1];
    const p1 = { x: p0.x + (p3.x - p0.x) / 3, y: p0.y + (p3.y - p0.y) / 3 };
    const p2 = { x: p0.x + (2 * (p3.x - p0.x)) / 3, y: p0.y + (2 * (p3.y - p0.y)) / 3 };
    return {
      segments: [{ p0, p1, p2, p3 }],
      maxErrorPx: 0,
      rmsErrorPx: 0,
      originalPointsPerSegment: [points],
    };
  }

  let uPrime = chordLengthParameterize(points);
  let bezier = generateBezierLeastSquares(points, uPrime, tHat1, tHat2);
  let errorInfo = computeMaxEuclideanError(bezier, points, uPrime);

  if (errorInfo.maxErrorPx <= fit_error_px) {
    return {
      segments: [bezier],
      maxErrorPx: errorInfo.maxErrorPx,
      rmsErrorPx: errorInfo.rmsErrorPx,
      originalPointsPerSegment: [points],
    };
  }

  // Tentar reparametrização por Newton-Raphson se o erro inicial for moderado
  if (errorInfo.maxErrorPx <= fit_error_px * 3.5) {
    for (let iter = 0; iter < 4; iter++) {
      uPrime = reparameterizeNewtonRaphson(bezier, points, uPrime);
      bezier = generateBezierLeastSquares(points, uPrime, tHat1, tHat2);
      errorInfo = computeMaxEuclideanError(bezier, points, uPrime);
      if (errorInfo.maxErrorPx <= fit_error_px) {
        return {
          segments: [bezier],
          maxErrorPx: errorInfo.maxErrorPx,
          rmsErrorPx: errorInfo.rmsErrorPx,
          originalPointsPerSegment: [points],
        };
      }
    }
  }

  // Se atingiu a profundidade máxima, aceitar a melhor aproximação
  if (currentDepth >= maxDepth || points.length <= 4) {
    return {
      segments: [bezier],
      maxErrorPx: errorInfo.maxErrorPx,
      rmsErrorPx: errorInfo.rmsErrorPx,
      originalPointsPerSegment: [points],
    };
  }

  // Dividir no ponto de maior erro
  const splitIdx = errorInfo.splitIndex;
  const tHatCenter = computeCenterTangent(points, splitIdx);
  const tHatCenterNeg = { x: -tHatCenter.x, y: -tHatCenter.y };

  const leftPoints = points.slice(0, splitIdx + 1);
  const rightPoints = points.slice(splitIdx);

  const leftFit = fitCubicCurveRecursive(
    leftPoints,
    tHat1,
    tHatCenterNeg,
    fit_error_px,
    maxDepth,
    currentDepth + 1
  );

  const rightFit = fitCubicCurveRecursive(
    rightPoints,
    tHatCenter,
    tHat2,
    fit_error_px,
    maxDepth,
    currentDepth + 1
  );

  return {
    segments: [...leftFit.segments, ...rightFit.segments],
    maxErrorPx: Math.max(leftFit.maxErrorPx, rightFit.maxErrorPx),
    rmsErrorPx: Math.hypot(leftFit.rmsErrorPx, rightFit.rmsErrorPx) / Math.SQRT2,
    originalPointsPerSegment: [
      ...leftFit.originalPointsPerSegment,
      ...rightFit.originalPointsPerSegment,
    ],
  };
}

// ============================================================================
// 4. BOTTOM-UP CURVE MERGE (Preserving Curve <-> Original Sample Mapping)
// ============================================================================

/**
 * Tenta fundir recursivamente/iterativamente curvas adjacentes enquanto
 * o ajuste unificado sobre a união dos samples originais mantiver erro <= fit_error_px.
 */
export function mergeAdjacentCurvesBottomUp(
  fitResult: CurveFitResult,
  fit_error_px: number,
  maxIterations: number = 8
): CurveFitResult {
  let segments = [...fitResult.segments];
  let originalPoints = [...fitResult.originalPointsPerSegment];

  if (segments.length <= 1) {
    return fitResult;
  }

  let mergedAny = true;
  let iter = 0;

  while (mergedAny && iter < maxIterations && segments.length > 1) {
    mergedAny = false;
    iter++;

    const nextSegments: CubicBezierSegment[] = [];
    const nextPoints: Point[][] = [];

    let i = 0;
    while (i < segments.length) {
      if (i < segments.length - 1) {
        // Tentar fundir segmento i e i + 1
        const combinedPoints: Point[] = [
          ...originalPoints[i],
          ...originalPoints[i + 1].slice(1), // Evitar ponto duplicado na junção
        ];

        const t1 = computeLeftTangent(combinedPoints);
        const t2 = computeRightTangent(combinedPoints);
        const u = chordLengthParameterize(combinedPoints);
        const candidateBezier = generateBezierLeastSquares(combinedPoints, u, t1, t2);

        // Reparametrizar para testar melhor ajuste possível
        const uRefined = reparameterizeNewtonRaphson(candidateBezier, combinedPoints, u);
        const refinedBezier = generateBezierLeastSquares(combinedPoints, uRefined, t1, t2);
        const err = computeMaxEuclideanError(refinedBezier, combinedPoints, uRefined);

        if (err.maxErrorPx <= fit_error_px) {
          // Fusão aceita!
          nextSegments.push(refinedBezier);
          nextPoints.push(combinedPoints);
          mergedAny = true;
          i += 2; // Pula os dois que foram fundidos
          continue;
        }
      }

      // Não fundiu, mantém segmento individual
      nextSegments.push(segments[i]);
      nextPoints.push(originalPoints[i]);
      i++;
    }

    segments = nextSegments;
    originalPoints = nextPoints;
  }

  // Recalcular erro global
  let maxErr = 0;
  let sumRms = 0;
  for (let k = 0; k < segments.length; k++) {
    const pts = originalPoints[k];
    const u = chordLengthParameterize(pts);
    const err = computeMaxEuclideanError(segments[k], pts, u);
    maxErr = Math.max(maxErr, err.maxErrorPx);
    sumRms += err.rmsErrorPx * err.rmsErrorPx;
  }

  return {
    segments,
    maxErrorPx: maxErr,
    rmsErrorPx: Math.sqrt(sumRms / Math.max(1, segments.length)),
    originalPointsPerSegment: originalPoints,
  };
}

// ============================================================================
// 5. CLOSED CONTOUR HANDLING & ROTATION INVARIANCE
// ============================================================================

/**
 * Ajusta contorno fechado dividindo nos cantos detectados ou segmentando
 * de forma circular sem introduzir costuras artificiais.
 */
export function fitClosedContour(
  points: Point[],
  fit_error_px: number,
  simplify_area_px2: number,
  enableMerge: boolean = true
): CurveFitResult {
  // 1. Pré-simplificação
  const simplified = simplifyVisvalingamWhyatt(points, simplify_area_px2, true);
  if (simplified.length < 3) {
    return fitCubicCurveRecursive(points, computeLeftTangent(points), computeRightTangent(points), fit_error_px);
  }

  // 2. Detecção de cantos dominantes
  const classified = classifyContourPoints(simplified, true);
  const cornerIndices: number[] = [];

  for (let i = 0; i < classified.length; i++) {
    if (classified[i].classification === 'CORNER' || classified[i].classification === 'CUSP') {
      cornerIndices.push(i);
    }
  }

  // Se não houver cantos (ex: círculo ou elipse perfeita), divide em 2 ou 4 seções naturais
  if (cornerIndices.length === 0) {
    const numSections = simplified.length >= 8 ? 4 : 2;
    const step = Math.floor(simplified.length / numSections);
    for (let s = 0; s < numSections; s++) {
      cornerIndices.push(s * step);
    }
  }

  const allSegments: CubicBezierSegment[] = [];
  const allPoints: Point[][] = [];
  let maxErr = 0;

  const m = cornerIndices.length;
  for (let k = 0; k < m; k++) {
    const startIdx = cornerIndices[k];
    const endIdx = cornerIndices[(k + 1) % m];

    let sectionPoints: Point[] = [];
    if (endIdx > startIdx) {
      sectionPoints = simplified.slice(startIdx, endIdx + 1);
    } else {
      sectionPoints = [...simplified.slice(startIdx), ...simplified.slice(0, endIdx + 1)];
    }

    const prevStartIdx = (startIdx - 1 + simplified.length) % simplified.length;
    const nextStartIdx = (startIdx + 1) % simplified.length;
    const dx1 = simplified[nextStartIdx].x - simplified[prevStartIdx].x;
    const dy1 = simplified[nextStartIdx].y - simplified[prevStartIdx].y;
    const len1 = Math.hypot(dx1, dy1) || 1e-9;
    const t1: Point = { x: dx1 / len1, y: dy1 / len1 };

    const prevEndIdx = (endIdx - 1 + simplified.length) % simplified.length;
    const nextEndIdx = (endIdx + 1) % simplified.length;
    const dx2 = simplified[prevEndIdx].x - simplified[nextEndIdx].x;
    const dy2 = simplified[prevEndIdx].y - simplified[nextEndIdx].y;
    const len2 = Math.hypot(dx2, dy2) || 1e-9;
    const t2: Point = { x: dx2 / len2, y: dy2 / len2 };

    let sectionFit = fitCubicCurveRecursive(sectionPoints, t1, t2, fit_error_px);

    if (enableMerge && sectionFit.segments.length > 1) {
      sectionFit = mergeAdjacentCurvesBottomUp(sectionFit, fit_error_px);
    }

    allSegments.push(...sectionFit.segments);
    allPoints.push(...sectionFit.originalPointsPerSegment);
    maxErr = Math.max(maxErr, sectionFit.maxErrorPx);
  }

  let finalResult: CurveFitResult = {
    segments: allSegments,
    maxErrorPx: maxErr,
    rmsErrorPx: 0,
    originalPointsPerSegment: allPoints,
  };

  if (enableMerge && finalResult.segments.length > 1) {
    finalResult = mergeAdjacentCurvesBottomUp(finalResult, fit_error_px);
  }

  return finalResult;
}

// ============================================================================
// 6. SVG RECONSTRUCTION PIPELINE WRAPPER
// ============================================================================

export interface ReconstructionPipelineOptions {
  fit_error_px: number;
  simplify_area_px2: number;
  enableSimplification: boolean;
  enableMerge: boolean;
  enableC2Polish?: boolean;
}

/**
 * Converte um caminho SVG completo usando o pipeline geométrico especificado.
 */
export function reconstructSvgPaths(
  svgString: string,
  options: ReconstructionPipelineOptions
): {
  reconstructedSvg: string;
  totalInputNodes: number;
  totalOutputNodes: number;
  totalOutputBeziers: number;
  nodeReductionPercent: number;
  maxFitErrorPx: number;
} {
  const paths = parseSvgToSegments(svgString);
  const dims = extractSvgDimensions(svgString);

  let totalInputNodes = 0;
  let totalOutputNodes = 0;
  let totalOutputBeziers = 0;
  let globalMaxError = 0;

  const refinedPaths: RefinedPath[] = paths.map((pathObj) => {
    const refinedSubpaths: CubicBezierSegment[][] = [];

    for (const subpath of pathObj.subpaths) {
      if (subpath.length === 0) continue;

      // Amostrar polilinha do subpath
      const points: Point[] = [];
      points.push({ x: subpath[0].p0.x, y: subpath[0].p0.y });

      for (const seg of subpath) {
        totalInputNodes++;
        // Amostrar cada curva cúbica em 4 pontos intermediários
        for (let t = 0.25; t <= 1.0; t += 0.25) {
          const pt = evaluateCubicBezier(seg, t);
          points.push(pt);
        }
      }

      const isClosed =
        Math.hypot(
          points[0].x - points[points.length - 1].x,
          points[0].y - points[points.length - 1].y
        ) < 1.0;

      let fitResult: CurveFitResult;

      if (isClosed) {
        fitResult = fitClosedContour(
          points,
          options.fit_error_px,
          options.enableSimplification ? options.simplify_area_px2 : 0,
          options.enableMerge
        );
      } else {
        let pts = points;
        if (options.enableSimplification && options.simplify_area_px2 > 0) {
          pts = simplifyVisvalingamWhyatt(points, options.simplify_area_px2, false);
        }
        const t1 = computeLeftTangent(pts);
        const t2 = computeRightTangent(pts);
        fitResult = fitCubicCurveRecursive(pts, t1, t2, options.fit_error_px);
        if (options.enableMerge && fitResult.segments.length > 1) {
          fitResult = mergeAdjacentCurvesBottomUp(fitResult, options.fit_error_px);
        }
      }

      globalMaxError = Math.max(globalMaxError, fitResult.maxErrorPx);
      totalOutputBeziers += fitResult.segments.length;
      totalOutputNodes += fitResult.segments.length + 1;

      refinedSubpaths.push(fitResult.segments);
    }

    return {
      fill: pathObj.fill,
      fillRule: pathObj.fillRule,
      subpaths: refinedSubpaths,
    };
  });

  const reconstructedSvg = serializeSegmentsToSvg(
    refinedPaths,
    dims.viewBox,
    dims.width,
    dims.height
  );

  const nodeReductionPercent =
    totalInputNodes > 0
      ? Math.max(0, ((totalInputNodes - totalOutputNodes) / totalInputNodes) * 100)
      : 0;

  return {
    reconstructedSvg,
    totalInputNodes,
    totalOutputNodes,
    totalOutputBeziers,
    nodeReductionPercent,
    maxFitErrorPx: globalMaxError,
  };
}
