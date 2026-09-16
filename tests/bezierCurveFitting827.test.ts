import { describe, it, expect } from 'vitest';
import {
  Point,
  triangleArea,
  simplifyVisvalingamWhyatt,
  classifyContourPoints,
  evaluateCubicBezier,
  chordLengthParameterize,
  computeLeftTangent,
  computeRightTangent,
  generateBezierLeastSquares,
  reparameterizeNewtonRaphson,
  computeMaxEuclideanError,
  fitCubicCurveRecursive,
  mergeAdjacentCurvesBottomUp,
  fitClosedContour,
} from '../src/core/vector-engine/bezierCurveFitting827';

describe('PRYX ETAPA 8.27 — MATHEMATICAL AUDIT & CURVE FITTER UNIT TESTS', () => {
  // ==========================================================================
  // TEST 1: ERROR METRIC & SQUARED DISTANCE BUG REGRESSION TEST
  // ==========================================================================
  it('1. Regression Test: computeMaxEuclideanError returns linear px and compares strictly with fit_error_px', () => {
    // Definir uma curva cúbica conhecida
    const bezier = {
      p0: { x: 0, y: 0 },
      p1: { x: 20, y: 50 },
      p2: { x: 80, y: 50 },
      p3: { x: 100, y: 0 },
    };

    // Gerar 20 pontos ao longo da curva com um deslocamento induzido de exatamente 4.0 px
    const points: Point[] = [];
    const u: number[] = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      u.push(t);
      const pt = evaluateCubicBezier(bezier, t);
      // Injetar erro de 4.0 px no ponto central
      if (i === 10) {
        points.push({ x: pt.x, y: pt.y + 4.0 });
      } else {
        points.push(pt);
      }
    }

    const errorResult = computeMaxEuclideanError(bezier, points, u);

    // O erro máximo DEVE ser exatamente 4.0 px (e NÃO 16.0 px²)
    expect(errorResult.maxErrorPx).toBeCloseTo(4.0, 2);
    expect(errorResult.splitIndex).toBe(10);

    // Se o threshold for 5.0 px, o fit DEVE aceitar (4.0 <= 5.0)
    expect(errorResult.maxErrorPx <= 5.0).toBe(true);

    // Se houvesse o bug de comparar dist_sq (16.0) com fit_error (5.0), falharia erroneamente
    const buggyComparison = (errorResult.maxErrorPx * errorResult.maxErrorPx) <= 5.0;
    expect(buggyComparison).toBe(false); // Prova que a comparação ingênua causaria split indevido!
  });

  // ==========================================================================
  // TEST 2: VISVALINGAM–WHYATT DIMENSIONALITY (px² triangle area)
  // ==========================================================================
  it('2. Visvalingam–Whyatt operates strictly on triangle area (px²)', () => {
    // Triângulo com base 10 px e altura 4 px -> área = 0.5 * 10 * 4 = 20 px²
    const a: Point = { x: 0, y: 0 };
    const b: Point = { x: 5, y: 4 };
    const c: Point = { x: 10, y: 0 };

    const area = triangleArea(a, b, c);
    expect(area).toBeCloseTo(20.0, 4);

    // Polilinha com um canto grande (área 100 px²) e um ruído minúsculo (área 1.0 px²)
    const polyline: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 100 }, // Área ~ 2500 px² (canto dominante)
      { x: 100, y: 0 },
      { x: 105, y: 0.2 }, // Área ~ 1.0 px² (ruído subpixel)
      { x: 110, y: 0 },
    ];

    // Se simplify_area_px2 = 2.0 px², o ruído (1.0 px²) deve ser removido, preservando o canto dominante
    const simplified = simplifyVisvalingamWhyatt(polyline, 2.0, false);
    expect(simplified.length).toBe(4); // 5 - 1 = 4

    // Se simplify_area_px2 = 0.5 px², todos os pontos devem ser preservados
    const kept = simplifyVisvalingamWhyatt(polyline, 0.5, false);
    expect(kept.length).toBe(5);
  });

  // ==========================================================================
  // TEST 3: CLOSED_CONTOUR_START_INVARIANCE_TEST
  // ==========================================================================
  it('3. CLOSED_CONTOUR_START_INVARIANCE_TEST: Rotating starting sample does not degrade closed contour fit', () => {
    // Gerar círculo perfeito de raio 100 px com 64 samples
    const numSamples = 64;
    const radius = 100;
    const center = { x: 150, y: 150 };
    const circlePoints: Point[] = [];

    for (let i = 0; i < numSamples; i++) {
      const angle = (i / numSamples) * 2 * Math.PI;
      circlePoints.push({
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle),
      });
    }

    // Fit original
    const fitOriginal = fitClosedContour(circlePoints, 0.75, 0.5, true);

    // Rotacionar contorno em 16 samples (90 graus)
    const shift = 16;
    const rotatedPoints = [...circlePoints.slice(shift), ...circlePoints.slice(0, shift)];
    const fitRotated = fitClosedContour(rotatedPoints, 0.75, 0.5, true);

    // Ambos os fits devem ter quantidade razoável de segmentos (4 a 8 Béziers) e erro baixo
    expect(fitOriginal.segments.length).toBeGreaterThanOrEqual(4);
    expect(fitOriginal.segments.length).toBeLessThanOrEqual(8);

    expect(fitRotated.segments.length).toBeGreaterThanOrEqual(4);
    expect(fitRotated.segments.length).toBeLessThanOrEqual(8);

    // A diferença no número de segmentos deve ser no máximo 1 (estabilidade de rotação)
    expect(Math.abs(fitOriginal.segments.length - fitRotated.segments.length)).toBeLessThanOrEqual(1);
    expect(fitOriginal.maxErrorPx).toBeLessThanOrEqual(1.5);
    expect(fitRotated.maxErrorPx).toBeLessThanOrEqual(1.5);
  });

  // ==========================================================================
  // TEST 4: CORNER & INFLECTION POINT CLASSIFICATION
  // ==========================================================================
  it('4. Classifies corners, cusps, and inflections robustly on geometric primitives', () => {
    // Quadrado com cantos retos de 90 graus
    const square: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 100, y: 100 },
      { x: 50, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 50 },
    ];

    const classifiedSquare = classifyContourPoints(square, true, 1);
    const corners = classifiedSquare.filter(
      (p) => p.classification === 'CORNER' || p.classification === 'CUSP'
    );
    expect(corners.length).toBeGreaterThanOrEqual(4);

    // Curva em S com inflexão no centro
    const sCurve: Point[] = [];
    for (let x = -50; x <= 50; x += 5) {
      // y = x^3 / 2500
      const y = (x * x * x) / 2500;
      sCurve.push({ x: x + 50, y: y + 50 });
    }

    const classifiedS = classifyContourPoints(sCurve, false, 2);
    const inflections = classifiedS.filter((p) => p.classification === 'INFLECTION');
    expect(inflections.length).toBeGreaterThanOrEqual(1);
  });

  // ==========================================================================
  // TEST 5: BOTTOM-UP MERGE PRESERVES ORIGINAL SAMPLES MAPPING
  // ==========================================================================
  it('5. Bottom-Up Merge successfully consolidates redundant Bézier segments and tracks sample points', () => {
    // Criar uma parábola subdividida artificialmente em 3 seções
    const points: Point[] = [];
    for (let x = 0; x <= 100; x += 2) {
      const y = 0.01 * (x - 50) * (x - 50);
      points.push({ x, y });
    }

    // Forçar split com tolerância muito rigorosa
    const t1 = computeLeftTangent(points);
    const t2 = computeRightTangent(points);
    const strictFit = fitCubicCurveRecursive(points, t1, t2, 0.05);
    expect(strictFit.segments.length).toBeGreaterThan(1);

    // Ao executar merge com tolerância moderada (0.75 px), deve consolidar em menos segmentos
    const mergedFit = mergeAdjacentCurvesBottomUp(strictFit, 0.75);
    expect(mergedFit.segments.length).toBeLessThan(strictFit.segments.length);
    expect(mergedFit.originalPointsPerSegment.length).toBe(mergedFit.segments.length);

    // O total de pontos rastreados deve cobrir todos os samples originais
    let totalTrackedPoints = 0;
    for (const pts of mergedFit.originalPointsPerSegment) {
      totalTrackedPoints += pts.length;
    }
    expect(totalTrackedPoints).toBeGreaterThanOrEqual(points.length);
  });
});
