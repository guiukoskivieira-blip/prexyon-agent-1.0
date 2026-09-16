/**
 * Prexyon Vectorization Engine V2 — Benchmark Types & Schemas (Etapa V2.2B)
 *
 * Tipos e interfaces estritas para o corpus de benchmark comparativo,
 * métricas geométricas, de cor, topológicas, de editabilidade e relatório multidimensional.
 */

export type VectorBenchmarkCategory =
  | 'LOGO_MONO_TYPOGRAPHY'
  | 'LOGO_GEOMETRIC'
  | 'LOGO_MULTICOLOR'
  | 'LOGO_JPEG_NOISY'
  | 'LOGO_FINE_DETAILS'
  | 'GRAPHIC_ART_FLAT'
  | 'GRAPHIC_ART_SHADED'
  | 'COMPLEX_BADGE';

export interface RgbaBitmap {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface VectorBenchmarkCase {
  id: string;
  category: VectorBenchmarkCategory;
  name: string;
  description: string;
  source: 'synthetic' | 'real_user';
  dimensions: {
    width: number;
    height: number;
    dpi?: number;
  };
  getBitmap: () => RgbaBitmap;
  expectedColorCount?: number | null;
  expectedObjectCount?: number | null;
  expectedHoleCount?: number | null;
  referenceAvailable: boolean;
  notes: string;
}

export interface GeometricMetrics {
  /** Quantidade total de elementos <path> no SVG gerado */
  totalPaths: number;
  /** Quantidade total de subcaminhos (comandos M/m) */
  totalSubpaths: number;
  /** Quantidade total de nós / segmentos de comando (M, L, C, S, Q, Z) */
  totalNodes: number;
  /** Tamanho do arquivo SVG gerado em bytes */
  svgSizeBytes: number;
  /** Tempo de execução da vetorização em milissegundos */
  executionTimeMs: number;
  /** Quantidade de caminhos com área <= limiar (micro-objetos/speckles) */
  microObjectCount: number;
  /** Proporção de micro-objetos em relação ao total de caminhos (0.0 a 1.0) */
  microObjectRatio: number;
  /** Limiar de área em pixels² utilizado para detecção de micro-objetos (ex: 2.25 px² = 1.5x1.5 px) */
  microObjectThresholdPx2: number;
  /** Proporção de caminhos com comando de fechamento Z (0.0 a 1.0) */
  closedPathRatio: number;
  /** Quantidade de caminhos degenerados ou inválidos (< 2 nós úteis) */
  invalidPathCount: number;
  /** Classificação estritamente geométrica de ruído/densidade de nós */
  geometricCleanliness: 'CLEAN' | 'MODERATE' | 'NOISY';
  /** Quantidade de auto-interseções detectadas ou NOT_AVAILABLE */
  selfIntersectionCount: number | 'NOT_AVAILABLE';
}

export interface ColorMetrics {
  /** Quantidade de cores de preenchimento distintas encontradas nas tags <path> */
  uniqueFillColorCount: number;
  /** Quantidade de grupos semânticos de cor (<g> organizados por cor no PDM). NOT_AVAILABLE se não estruturado */
  semanticColorGroupCount: number | 'NOT_AVAILABLE';
}

export interface TopologyMetrics {
  /** Quantidade de compound paths (elementos <path> contendo 2 ou mais subcaminhos M...Z) */
  compoundPathCount: number;
  /** Quantidade de furos/miolos topológicos verdadeiros (subcaminhos contidos dentro de um anel externo no mesmo path) */
  trueHoleCount: number;
  /** Quantidade de ilhas desconexas externas (anéis externos que não são furos de nenhum outro) */
  disconnectedIslandCount: number;
  /** Quantidade de oclusões visuais por sobreposição entre paths separados (ex: disco branco sobreposto a disco preto) */
  stackedOcclusionCount: number;
  /** Se o atributo fill-rule ("evenodd" / "nonzero") foi serializado explicitamente nas tags <path> */
  fillRuleExplicit: boolean;
  /** Quantidade de caminhos órfãos / sem preenchimento e sem traço */
  orphanPathCount: number;
}

export interface EditabilityMetrics {
  /** Quantidade de entidades/objetos semânticos individualizados reconstruídos. NOT_AVAILABLE no pipeline V1 */
  semanticObjectCount: number | 'NOT_AVAILABLE';
  /** Estrutura de camadas de cor: grupos isolados ou empilhamento desestruturado */
  colorLayerSeparation: 'SEPARATE_GROUPS' | 'STACKED_UNGROUPED' | 'NOT_AVAILABLE';
  /** Taxa de preservação de furos topológicos verdadeiros quando expectedHoleCount > 0. Se expectedHoleCount === 0, NOT_APPLICABLE */
  holePreservationRate: number | 'NOT_APPLICABLE' | 'NOT_AVAILABLE';
  /** Quantidade de furos verdadeiros gerados além do esperado pelo ground truth */
  unexpectedHoleCount: number | 'NOT_AVAILABLE';
  /** Se a arte foi gerada como um bloco único monolítico ou com objetos separados */
  isMonolithic: boolean;
}

export interface VisualMetrics {
  /** Proporção de erro pixel-a-pixel comparando rasterização do SVG vs original (0.0 a 1.0) */
  pixelDiffRatio: number | 'NOT_AVAILABLE';
  /** Structural Similarity Index Measure (SSIM) ou NOT_AVAILABLE */
  ssim: number | 'NOT_AVAILABLE';
  /** Média Delta E 2000 no espaço perceptual CIELAB ou NOT_AVAILABLE */
  deltaE: number | 'NOT_AVAILABLE';
}

export interface MultidimensionalScoreReport {
  visual: {
    fidelity: string;
    pixelDiffRatio: number | 'NOT_AVAILABLE';
    ssimScore: number | 'NOT_AVAILABLE';
    deltaE: number | 'NOT_AVAILABLE';
  };
  geometry: {
    totalPaths: number;
    totalNodes: number;
    nodePerPathRatio: number;
    microSpeckleCount: number;
    microSpeckleRatio: number;
    closedPathRatio: number;
    cleanlinessRating: 'CLEAN' | 'MODERATE' | 'NOISY';
  };
  color: {
    uniqueFillColors: number;
    semanticColorGroups: number | 'NOT_AVAILABLE';
  };
  topology: {
    compoundPaths: number;
    trueHoles: number;
    disconnectedIslands: number;
    stackedOcclusions: number;
    fillRuleExplicit: boolean;
  };
  editability: {
    semanticObjects: number | 'NOT_AVAILABLE';
    colorLayerSeparation: 'SEPARATE_GROUPS' | 'STACKED_UNGROUPED' | 'NOT_AVAILABLE';
    holePreservationRate: number | 'NOT_APPLICABLE' | 'NOT_AVAILABLE';
    unexpectedHoleCount: number | 'NOT_AVAILABLE';
    isMonolithic: boolean;
  };
  performance: {
    executionTimeMs: number;
    svgSizeKb: number;
    throughputKpixelsPerSec: number;
  };
}

export interface CaseBenchmarkResult {
  caseId: string;
  category: VectorBenchmarkCategory;
  pipelineVersion: 'CURRENT_V1' | 'V2_CANDIDATE' | 'V2_MASK_TRACING' | 'V2_GEOMETRIC_POSTPROCESSING' | 'EXTERNAL_REFERENCE';
  geometricMetrics: GeometricMetrics;
  colorMetrics: ColorMetrics;
  topologyMetrics: TopologyMetrics;
  editabilityMetrics: EditabilityMetrics;
  visualMetrics: VisualMetrics;
  multidimensionalReport: MultidimensionalScoreReport;
  rawSvgSummary: {
    pathCount: number;
    svgLength: number;
  };
}

export interface ComparativeCaseResult {
  caseId: string;
  caseName: string;
  category: VectorBenchmarkCategory;
  current: CaseBenchmarkResult;
  v2: CaseBenchmarkResult | 'NOT_AVAILABLE';
  v24: CaseBenchmarkResult | 'NOT_AVAILABLE';
  v26: CaseBenchmarkResult | 'NOT_AVAILABLE';
  reference: CaseBenchmarkResult | 'NOT_AVAILABLE';
}

export interface BenchmarkSuiteReport {
  timestamp: string;
  engineVersion: string;
  totalCases: number;
  results: ComparativeCaseResult[];
  summary: {
    totalExecutionTimeMs: number;
    totalPathsCurrent: number;
    totalNodesCurrent: number;
    avgExecutionTimeMs: number;
    avgMicroObjectRatio: number;
  };
}
