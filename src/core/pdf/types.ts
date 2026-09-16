/**
 * Prexyon PDF Vector Engine — Types & Interfaces (v0.1)
 *
 * Módulo de tipos para decodificação e importação de gráficos vetoriais PDF para o PDM.
 */

export interface PdfMediaBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfDecodedPathObject {
  /** Comandos SVG Path (M, L, C, Z) normalizados em pontos ou mm */
  d: string;
  /** Cor de preenchimento em Hex (#rrggbb) ou null se transparente */
  fill: string | null;
  /** Cor de traço em Hex (#rrggbb) ou null se sem traço */
  stroke: string | null;
  /** Espessura do traço em milímetros */
  strokeWidth_mm: number;
  /** Opacidade (0.0 a 1.0) */
  opacity: number;
  /** Se o caminho é composto (possui múltiplos subcaminhos 'M') */
  isCompound: boolean;
  /** Regra de preenchimento: 'nonzero' ou 'evenodd' */
  fillRule: 'nonzero' | 'evenodd';
  /** Bounding box local do caminho em milímetros */
  bounds_mm: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width_mm: number;
    height_mm: number;
  };
}

export type PdfFeatureClassification =
  | 'FULLY_EDITABLE'
  | 'PARTIALLY_EDITABLE'
  | 'VIEW_ONLY_UNSUPPORTED';

export interface PdfFeatureAudit {
  hasRasterImages: boolean;
  hasGradients: boolean;
  hasTransparency: boolean;
  hasMasks: boolean;
  hasBlendModes: boolean;
  hasClipping: boolean;
  hasPatterns: boolean;
  hasText: boolean;
  hasFonts: boolean;
  unsupportedOperators: string[];
  classification: PdfFeatureClassification;
}

export interface PdfColorDistribution {
  [hexColor: string]: number;
}

export interface PdfImportReport {
  pageNumber: number;
  width_mm: number;
  height_mm: number;
  totalObjects: number;
  paths: number;
  compoundPaths: number;
  groups: number;
  textObjects: number;
  rasterObjects: number;
  clippingPaths: number;
  colors: string[];
  colorDistribution: PdfColorDistribution;
  features: PdfFeatureAudit;
  durationMs: number;
}

export interface PdfImportOptions {
  /** Se true, agrupa todos os caminhos importados em um único VectorGroupNode inicial (default: true) */
  groupOnImport?: boolean;
  /** Nome personalizado para o grupo ou camada */
  importName?: string;
  /** Posição inicial no documento em milímetros (default: {x: 0, y: 0}) */
  targetPosition_mm?: { x: number; y: number };
  /** Redimensionar a prancheta do PDM para as dimensões exatas do PDF (default: false) */
  fitArtboardToPdf?: boolean;
}
