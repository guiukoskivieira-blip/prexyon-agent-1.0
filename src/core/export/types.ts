/**
 * Tipos e interfaces para o Módulo de Exportação / Saída de Produção (Etapa 5 — Fase 5.4)
 */

export type ExportFormat = 'png' | 'svg' | 'cut-svg' | 'manifest-json';

export type ExportDpi = 72 | 150 | 300;

export type ExportBackground = 'transparent' | 'white';

export type ExportCutTarget = 'all' | 'selected';

export interface ExportOptions {
  /** Formato de saída desejado */
  format: ExportFormat;

  /** Se true, expande as dimensões da exportação para incluir a área de sangria ativa */
  includeBleed: boolean;

  /** Se true, renderiza guias técnicas na saída (útil para provas técnicas) */
  includeTechnicalGuides?: boolean;

  /** Se true, renderiza a faca de corte na saída visual */
  includeCutContour?: boolean;

  /** Se true, embuti imagens raster no SVG via data URL (default: true) */
  includeRasterInSvg?: boolean;

  /** Cor de fundo para exportações raster/SVG ('transparent' ou 'white') */
  background?: ExportBackground;

  /** Resolução de rasterização para saída PNG (default: 300 DPI) */
  rasterDpi?: number;

  /** Para formato 'cut-svg': exportar todas as facas ou somente a selecionada */
  cutContourTarget?: ExportCutTarget;

  /** ID do nó atualmente selecionado no editor */
  selectedNodeId?: string | null;
}

export interface ExportResult {
  /** Nome sugerido do arquivo com extensão */
  fileName: string;
  /** Tipo MIME do arquivo */
  mimeType: string;
  /** Blob contendo os dados brutos para download */
  blob: Blob;
  /** Largura em pixels (para PNG) */
  width_px?: number;
  /** Altura em pixels (para PNG) */
  height_px?: number;
  /** Largura física total em milímetros */
  width_mm: number;
  /** Altura física total em milímetros */
  height_mm: number;
  /** Conteúdo em texto (para SVG ou JSON), útil para inspeção e testes */
  dataString?: string;
}

export interface ExportDimensionSummary {
  width_mm: number;
  height_mm: number;
  width_px: number;
  height_px: number;
  dpi: number;
  includeBleed: boolean;
  bleedTop_mm: number;
  bleedRight_mm: number;
  bleedBottom_mm: number;
  bleedLeft_mm: number;
  offsetX_mm: number;
  offsetY_mm: number;
}
