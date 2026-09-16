/**
 * Prexyon Vectorization Engine V2 — Hardened Metric Extraction & Evaluation (Etapa V2.2B)
 *
 * Módulo puro, determinístico e com análise topológica rigorosa (containment / ray-casting)
 * para medição precisa de geometria, furos verdadeiros, oclusões empilhadas, cores e editabilidade.
 */

import {
  GeometricMetrics,
  ColorMetrics,
  TopologyMetrics,
  EditabilityMetrics,
  VisualMetrics,
  MultidimensionalScoreReport,
  VectorBenchmarkCase,
  CaseBenchmarkResult,
} from './types';

export interface Point2D {
  x: number;
  y: number;
}

export interface SubpathGeometry {
  points: Point2D[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  area: number;
  isClosed: boolean;
}

export interface PathTagData {
  d: string;
  fill: string | null;
  stroke: string | null;
  fillRule: string | null;
  subpaths: SubpathGeometry[];
}


/**
 * Algoritmo Ray-Casting exato para determinar se um ponto P está contido em um polígono 2D.
 */
export function pointInPolygon(p: Point2D, polygon: Point2D[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Calcula área assinada de um polígono via fórmula Shoelace.
 */
function calculateShoelaceArea(points: Point2D[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const curr = points[i];
    const next = points[(i + 1) % n];
    sum += curr.x * next.y - next.x * curr.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Faz parsing de comandos SVG e discretiza subcaminhos em polígonos aproximados.
 */
export function parseSubpathsFromPathD(d: string): SubpathGeometry[] {
  const subpaths: SubpathGeometry[] = [];
  const cmdRegex = /([a-df-z])([^a-df-z]*)/gi;
  let match: RegExpExecArray | null;

  let currentPoints: Point2D[] = [];
  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0;
  let isClosed = false;

  const pushCurrentSubpath = () => {
    if (currentPoints.length > 0) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of currentPoints) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const area = calculateShoelaceArea(currentPoints);
      subpaths.push({
        points: currentPoints,
        minX,
        maxX,
        minY,
        maxY,
        area,
        isClosed,
      });
      currentPoints = [];
      isClosed = false;
    }
  };

  while ((match = cmdRegex.exec(d)) !== null) {
    const type = match[1];
    const typeUpper = type.toUpperCase();
    const isRel = type === type.toLowerCase() && typeUpper !== 'Z';
    const numRegex = /[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g;
    const args: number[] = [];
    let nMatch: RegExpExecArray | null;
    while ((nMatch = numRegex.exec(match[2])) !== null) {
      args.push(parseFloat(nMatch[0]));
    }

    if (typeUpper === 'M') {
      pushCurrentSubpath();
      for (let i = 0; i < args.length; i += 2) {
        if (i + 1 < args.length) {
          const x = isRel && i > 0 ? curX + args[i] : isRel ? curX + args[i] : args[i];
          const y = isRel && i > 0 ? curY + args[i + 1] : isRel ? curY + args[i + 1] : args[i + 1];
          curX = x;
          curY = y;
          if (i === 0) {
            startX = x;
            startY = y;
          }
          currentPoints.push({ x, y });
        }
      }
    } else if (typeUpper === 'L') {
      for (let i = 0; i < args.length; i += 2) {
        if (i + 1 < args.length) {
          const x = isRel ? curX + args[i] : args[i];
          const y = isRel ? curY + args[i + 1] : args[i + 1];
          curX = x;
          curY = y;
          currentPoints.push({ x, y });
        }
      }
    } else if (typeUpper === 'H') {
      for (let i = 0; i < args.length; i++) {
        const x = isRel ? curX + args[i] : args[i];
        curX = x;
        currentPoints.push({ x, y: curY });
      }
    } else if (typeUpper === 'V') {
      for (let i = 0; i < args.length; i++) {
        const y = isRel ? curY + args[i] : args[i];
        curY = y;
        currentPoints.push({ x: curX, y });
      }
    } else if (typeUpper === 'C') {
      for (let i = 0; i < args.length; i += 6) {
        if (i + 5 < args.length) {
          const cp1x = isRel ? curX + args[i] : args[i];
          const cp1y = isRel ? curY + args[i + 1] : args[i + 1];
          const cp2x = isRel ? curX + args[i + 2] : args[i + 2];
          const cp2y = isRel ? curY + args[i + 3] : args[i + 3];
          const endX = isRel ? curX + args[i + 4] : args[i + 4];
          const endY = isRel ? curY + args[i + 5] : args[i + 5];

          const p0x = curX;
          const p0y = curY;

          // Amostragem de pontos ao longo da curva cúbica de Bézier (t = 0.25, 0.5, 0.75, 1.0)
          for (const t of [0.25, 0.5, 0.75, 1.0]) {
            const mt = 1 - t;
            const bx = mt * mt * mt * p0x + 3 * mt * mt * t * cp1x + 3 * mt * t * t * cp2x + t * t * t * endX;
            const by = mt * mt * mt * p0y + 3 * mt * mt * t * cp1y + 3 * mt * t * t * cp2y + t * t * t * endY;
            currentPoints.push({ x: bx, y: by });
          }

          curX = endX;
          curY = endY;
        }
      }
    } else if (typeUpper === 'S' || typeUpper === 'Q') {
      for (let i = 0; i < args.length; i += 4) {
        if (i + 3 < args.length) {
          const cpx = isRel ? curX + args[i] : args[i];
          const cpy = isRel ? curY + args[i + 1] : args[i + 1];
          const endX = isRel ? curX + args[i + 2] : args[i + 2];
          const endY = isRel ? curY + args[i + 3] : args[i + 3];

          const p0x = curX;
          const p0y = curY;

          for (const t of [0.33, 0.67, 1.0]) {
            const mt = 1 - t;
            const bx = mt * mt * p0x + 2 * mt * t * cpx + t * t * endX;
            const by = mt * mt * p0y + 2 * mt * t * cpy + t * t * endY;
            currentPoints.push({ x: bx, y: by });
          }

          curX = endX;
          curY = endY;
        }
      }
    } else if (typeUpper === 'Z') {
      isClosed = true;
      curX = startX;
      curY = startY;
    }
  }

  pushCurrentSubpath();
  return subpaths;
}

/**
 * Extrai todas as tags <path> de um SVG com seus atributos e subcaminhos discretizados.
 */
export function extractPathTagsData(svgString: string): PathTagData[] {
  const pathMatches = svgString.match(/<path\b[^>]*\/?>/gi) || [];
  const results: PathTagData[] = [];

  for (const p of pathMatches) {
    const dMatch = p.match(/\bd\s*=\s*["']([^"']+)["']/i);
    const d = dMatch ? dMatch[1].trim() : '';

    let fill: string | null = null;
    const fillMatch = p.match(/\bfill\s*=\s*["']([^"']+)["']/i);
    if (fillMatch && fillMatch[1].toLowerCase() !== 'none') {
      fill = fillMatch[1].trim().toLowerCase();
    }

    let stroke: string | null = null;
    const strokeMatch = p.match(/\bstroke\s*=\s*["']([^"']+)["']/i);
    if (strokeMatch && strokeMatch[1].toLowerCase() !== 'none') {
      stroke = strokeMatch[1].trim().toLowerCase();
    }

    let fillRule: string | null = null;
    const ruleMatch = p.match(/\bfill-rule\s*=\s*["']([^"']+)["']/i);
    if (ruleMatch) {
      fillRule = ruleMatch[1].trim().toLowerCase();
    }

    const subpaths = parseSubpathsFromPathD(d);
    results.push({
      d,
      fill,
      stroke,
      fillRule,
      subpaths,
    });
  }

  return results;
}

/**
 * Analisa métricas geométricas com classificação estrita de ruído/densidade.
 */
export function extractGeometricMetrics(svgString: string, executionTimeMs: number): GeometricMetrics {
  const svgSizeBytes = typeof Buffer !== 'undefined'
    ? Buffer.byteLength(svgString, 'utf-8')
    : new TextEncoder().encode(svgString).length;

  const paths = extractPathTagsData(svgString);
  const totalPaths = paths.length;

  let totalSubpaths = 0;
  let totalNodes = 0;
  let closedCount = 0;
  let invalidPathCount = 0;
  let microObjectCount = 0;
  const MICRO_OBJECT_THRESHOLD_PX2 = 2.25; // 1.5px x 1.5px em espaço de raster (equivalente a ~0.016 mm² a 300 DPI)

  for (const p of paths) {
    totalSubpaths += p.subpaths.length;
    const cmdMatches = p.d.match(/[MmLlHhVvCcSsQqTtAaZz]/g) || [];
    const nodeCount = cmdMatches.length;
    totalNodes += nodeCount;

    if (nodeCount < 2) {
      invalidPathCount++;
    }

    if (/[Zz]/.test(p.d)) {
      closedCount++;
    }

    for (const sp of p.subpaths) {
      const spanX = Math.abs(sp.maxX - sp.minX);
      const spanY = Math.abs(sp.maxY - sp.minY);
      if ((spanX <= 1.5 && spanY <= 1.5) || sp.area <= MICRO_OBJECT_THRESHOLD_PX2) {
        microObjectCount++;
      }
    }
  }

  const microObjectRatio = totalPaths > 0 ? Number((microObjectCount / Math.max(1, totalSubpaths)).toFixed(4)) : 0;
  const closedPathRatio = totalPaths > 0 ? Number((closedCount / totalPaths).toFixed(4)) : 0;
  const avgNodesPerPath = totalPaths > 0 ? totalNodes / totalPaths : 0;

  // Classificação estritamente geométrica
  let geometricCleanliness: 'CLEAN' | 'MODERATE' | 'NOISY' = 'CLEAN';
  if (microObjectRatio > 0.15 || invalidPathCount > 0) {
    geometricCleanliness = 'NOISY';
  } else if (microObjectRatio > 0.03 || avgNodesPerPath >= 15) {
    // Densidade de nós inflada em formas simples
    geometricCleanliness = 'MODERATE';
  }

  return {
    totalPaths,
    totalSubpaths,
    totalNodes,
    svgSizeBytes,
    executionTimeMs,
    microObjectCount,
    microObjectRatio,
    microObjectThresholdPx2: MICRO_OBJECT_THRESHOLD_PX2,
    closedPathRatio,
    invalidPathCount,
    geometricCleanliness,
    selfIntersectionCount: 'NOT_AVAILABLE',
  };
}

/**
 * Analisa métricas de cor separando cores únicas de grupos semânticos reais.
 */
export function extractColorMetrics(svgString: string): ColorMetrics {
  const paths = extractPathTagsData(svgString);
  const uniqueFills = new Set<string>();

  for (const p of paths) {
    if (p.fill) {
      uniqueFills.add(p.fill);
    }
  }

  // Verifica se existem grupos <g> com identificação semântica de cor
  let semanticColorGroupCount: number | 'NOT_AVAILABLE' = 'NOT_AVAILABLE';
  const colorGroupMatches = svgString.match(/<g\b[^>]*(?:id=["']color-|data-color=["'])[^>]*>/gi);
  if (colorGroupMatches && colorGroupMatches.length > 0) {
    semanticColorGroupCount = colorGroupMatches.length;
  }

  return {
    uniqueFillColorCount: uniqueFills.size > 0 ? uniqueFills.size : 1,
    semanticColorGroupCount,
  };
}

/**
 * Testa se o subcaminho `inner` está estritamente contido no subcaminho `outer`.
 */
function isSubpathContained(inner: SubpathGeometry, outer: SubpathGeometry): boolean {
  if (inner.area >= outer.area) return false;
  // 1. Checagem rápida de Bounding Box (AABB)
  if (
    inner.minX < outer.minX - 0.01 ||
    inner.maxX > outer.maxX + 0.01 ||
    inner.minY < outer.minY - 0.01 ||
    inner.maxY > outer.maxY + 0.01
  ) {
    return false;
  }

  // 2. Checagem precisa de ponto interno (centroide / ponto médio)
  if (inner.points.length === 0 || outer.points.length === 0) return false;
  const samplePoint = inner.points[0];
  return pointInPolygon(samplePoint, outer.points);
}

/**
 * Analisa a topologia vetorial diferenciando furos verdadeiros de oclusões empilhadas e ilhas.
 */
export function extractTopologyMetrics(svgString: string): TopologyMetrics {
  const paths = extractPathTagsData(svgString);

  let compoundPathCount = 0;
  let trueHoleCount = 0;
  let disconnectedIslandCount = 0;
  let stackedOcclusionCount = 0;
  let hasExplicitFillRule = false;
  let orphanCount = 0;

  // 1. Análise intra-path (Compound Paths e True Holes)
  for (const p of paths) {
    if (p.fillRule) {
      hasExplicitFillRule = true;
    }

    if (!p.fill && !p.stroke) {
      orphanCount++;
    }

    const nSubpaths = p.subpaths.length;
    if (nSubpaths > 1) {
      compoundPathCount++;

      // Ordena subcaminhos por área decrescente
      const sorted = [...p.subpaths].sort((a, b) => b.area - a.area);
      const isHole = new Array(sorted.length).fill(false);

      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          if (!isHole[j] && isSubpathContained(sorted[j], sorted[i])) {
            isHole[j] = true;
            trueHoleCount++;
          }
        }
      }

      for (let i = 0; i < sorted.length; i++) {
        if (!isHole[i]) {
          disconnectedIslandCount++;
        }
      }
    } else if (nSubpaths === 1) {
      disconnectedIslandCount++;
    }
  }

  // 2. Análise inter-path (Oclusões por sobreposição / stacked visual holes)
  // Se um path $P_j$ de cor diferente está geometricamente contido dentro de $P_i$ como tag separada
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const pOuter = paths[i];
      const pInner = paths[j];
      if (pOuter.subpaths.length === 1 && pInner.subpaths.length === 1) {
        if (isSubpathContained(pInner.subpaths[0], pOuter.subpaths[0])) {
          stackedOcclusionCount++;
        }
      }
    }
  }

  return {
    compoundPathCount,
    trueHoleCount,
    disconnectedIslandCount,
    stackedOcclusionCount,
    fillRuleExplicit: hasExplicitFillRule,
    orphanPathCount: orphanCount,
  };
}

/**
 * Analisa a editabilidade vetorial e taxa de preservação de furos frente ao ground truth.
 */
export function extractEditabilityMetrics(
  topo: TopologyMetrics,
  benchmarkCase: VectorBenchmarkCase
): EditabilityMetrics {
  let holePreservationRate: number | 'NOT_APPLICABLE' | 'NOT_AVAILABLE' = 'NOT_AVAILABLE';
  let unexpectedHoleCount: number | 'NOT_AVAILABLE' = 'NOT_AVAILABLE';

  if (benchmarkCase.expectedHoleCount !== undefined && benchmarkCase.expectedHoleCount !== null) {
    if (benchmarkCase.expectedHoleCount === 0) {
      holePreservationRate = 'NOT_APPLICABLE';
      unexpectedHoleCount = topo.trueHoleCount;
    } else {
      holePreservationRate = Number((Math.min(benchmarkCase.expectedHoleCount, topo.trueHoleCount) / benchmarkCase.expectedHoleCount).toFixed(2));
      unexpectedHoleCount = Math.max(0, topo.trueHoleCount - benchmarkCase.expectedHoleCount);
    }
  }

  return {
    semanticObjectCount: 'NOT_AVAILABLE', // Não reconstruído no pipeline V1
    colorLayerSeparation: 'STACKED_UNGROUPED', // V1 gera paths empilhados planos
    holePreservationRate,
    unexpectedHoleCount,
    isMonolithic: topo.compoundPathCount <= 1 && topo.disconnectedIslandCount <= 1,
  };
}

/**
 * Métricas visuais (pixel diff, SSIM, Delta E).
 */
export function extractVisualMetrics(): VisualMetrics {
  return {
    pixelDiffRatio: 'NOT_AVAILABLE',
    ssim: 'NOT_AVAILABLE',
    deltaE: 'NOT_AVAILABLE',
  };
}

/**
 * Constrói o relatório multidimensional combinando as 6 dimensões.
 */
export function buildMultidimensionalReport(
  geo: GeometricMetrics,
  color: ColorMetrics,
  topo: TopologyMetrics,
  edit: EditabilityMetrics,
  benchmarkCase: VectorBenchmarkCase
): MultidimensionalScoreReport {
  const nodeRatio = geo.totalPaths > 0 ? Number((geo.totalNodes / geo.totalPaths).toFixed(1)) : 0;
  const pixels = benchmarkCase.dimensions.width * benchmarkCase.dimensions.height;
  const throughputKpixels = geo.executionTimeMs > 0
    ? Number(((pixels / 1000) / (geo.executionTimeMs / 1000)).toFixed(1))
    : 0;

  return {
    visual: {
      fidelity: 'Visual comparison deferred to headless rasterization stage',
      pixelDiffRatio: 'NOT_AVAILABLE',
      ssimScore: 'NOT_AVAILABLE',
      deltaE: 'NOT_AVAILABLE',
    },
    geometry: {
      totalPaths: geo.totalPaths,
      totalNodes: geo.totalNodes,
      nodePerPathRatio: nodeRatio,
      microSpeckleCount: geo.microObjectCount,
      microSpeckleRatio: geo.microObjectRatio,
      closedPathRatio: geo.closedPathRatio,
      cleanlinessRating: geo.geometricCleanliness,
    },
    color: {
      uniqueFillColors: color.uniqueFillColorCount,
      semanticColorGroups: color.semanticColorGroupCount,
    },
    topology: {
      compoundPaths: topo.compoundPathCount,
      trueHoles: topo.trueHoleCount,
      disconnectedIslands: topo.disconnectedIslandCount,
      stackedOcclusions: topo.stackedOcclusionCount,
      fillRuleExplicit: topo.fillRuleExplicit,
    },
    editability: {
      semanticObjects: edit.semanticObjectCount,
      colorLayerSeparation: edit.colorLayerSeparation,
      holePreservationRate: edit.holePreservationRate,
      unexpectedHoleCount: edit.unexpectedHoleCount,
      isMonolithic: edit.isMonolithic,
    },
    performance: {
      executionTimeMs: geo.executionTimeMs,
      svgSizeKb: Number((geo.svgSizeBytes / 1024).toFixed(2)),
      throughputKpixelsPerSec: throughputKpixels,
    },
  };
}

/**
 * Avalia um caso e produz o resultado consolidado e robusto do benchmark.
 */
export function evaluateBenchmarkCase(
  benchmarkCase: VectorBenchmarkCase,
  svgString: string,
  durationMs: number,
  pipelineVersion: 'CURRENT_V1' | 'V2_CANDIDATE' | 'V2_MASK_TRACING' | 'V2_GEOMETRIC_POSTPROCESSING' | 'EXTERNAL_REFERENCE' = 'CURRENT_V1'
): CaseBenchmarkResult {
  const geometricMetrics = extractGeometricMetrics(svgString, durationMs);
  const colorMetrics = extractColorMetrics(svgString);
  const topologyMetrics = extractTopologyMetrics(svgString);
  const editabilityMetrics = extractEditabilityMetrics(topologyMetrics, benchmarkCase);
  const visualMetrics = extractVisualMetrics();

  const multidimensionalReport = buildMultidimensionalReport(
    geometricMetrics,
    colorMetrics,
    topologyMetrics,
    editabilityMetrics,
    benchmarkCase
  );

  return {
    caseId: benchmarkCase.id,
    category: benchmarkCase.category,
    pipelineVersion,
    geometricMetrics,
    colorMetrics,
    topologyMetrics,
    editabilityMetrics,
    visualMetrics,
    multidimensionalReport,
    rawSvgSummary: {
      pathCount: geometricMetrics.totalPaths,
      svgLength: svgString.length,
    },
  };
}
