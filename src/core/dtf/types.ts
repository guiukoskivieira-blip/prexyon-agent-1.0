/**
 * Prexyon Agent — DTF (Direct to Film) Types (DTF UV Etapa 2)
 *
 * Tipagens e contratos para análise determinística de transparência e canais de cor/adesão.
 */

export interface AlphaAnalysis {
  /** Indica se o formato/origem suporta nativamente canal alfa (ex: PNG com RGBA) */
  hasAlphaChannel: boolean;
  /** Indica se há pixels totalmente transparentes (alpha === 0) */
  hasTransparentPixels: boolean;
  /** Indica se há pixels com transparência intermediária / gradiente (0 < alpha < 255) */
  hasSemiTransparentPixels: boolean;
  /** Proporção de pixels totalmente transparentes (0.0 a 1.0) */
  transparentPixelRatio: number;
  /** Proporção de pixels semi-transparentes (0.0 a 1.0) */
  semiTransparentPixelRatio: number;
  /** Proporção de pixels totalmente opacos (0.0 a 1.0) */
  opaquePixelRatio: number;
  /** Total de pixels avaliados na amostragem/análise */
  totalSampledPixels: number;
  /** Quantidade absoluta de pixels transparentes */
  transparentPixelCount: number;
  /** Quantidade absoluta de pixels semi-transparentes */
  semiTransparentPixelCount: number;
  /** Quantidade absoluta de pixels opacos */
  opaquePixelCount: number;
  /** Timestamp da análise */
  analyzedAt: number;
  /** Duração em milissegundos do processamento */
  durationMs: number;
}

export type DtfProductionRole = 'COLOR' | 'WHITE' | 'CLEAR' | 'PRIMER';

export interface DtfSeparationLayer {
  /** Identificador único da separação */
  id: string;
  /** Papel produtivo da camada */
  role: DtfProductionRole;
  /** Tipo MIME */
  mimeType: string;
  /** Resolução em DPI */
  dpi: number;
  /** Se a camada foi materializada */
  isMaterialized: boolean;
  /** Metadados adicionais */
  metadata?: Record<string, unknown>;
}
