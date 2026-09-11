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

export type ProductionSeparationRole = 'COLOR' | 'WHITE' | 'CLEAR' | 'PRIMER';

export type SeparationStatus = 'GENERATED' | 'STALE' | 'INVALID';

export interface ProductionSeparation {
  /** Identificador único da separação (ex: 'sep_white_123') */
  id: string;
  /** Papel técnico de produção da camada */
  role: ProductionSeparationRole;
  /** IDs dos nós do PDM que compõem esta separação */
  sourceNodeIds: string[];
  /** Fingerprint de revisão do documento/nós de origem para detecção de STALE */
  sourceFingerprint: string;
  /** Largura da máscara em pixels */
  widthPx: number;
  /** Altura da máscara em pixels */
  heightPx: number;
  /** Largura física da máscara em milímetros */
  widthMm: number;
  /** Altura física da máscara em milímetros */
  heightMm: number;
  /** Resolução técnica em DPI */
  dpi: number;
  /** Estado de validade e sincronismo da separação */
  status: SeparationStatus;
  /** Método/algoritmo utilizado na derivação técnica */
  generationMethod: string;
  /** Proporção de cobertura de tinta branca (0.0 a 1.0) */
  coverageRatio?: number;
  /** URI / Data URL da máscara para preview e download */
  maskDataUrl?: string;
  /** Buffer bruto de bytes da máscara (RGBA ou 8-bit grayscale) */
  maskBuffer?: Uint8Array | Uint8ClampedArray;
  /** Timestamp de geração */
  createdAt: number;
  /** Timestamp da última atualização */
  updatedAt: number;
  /** Metadados adicionais */
  metadata?: Record<string, unknown>;
}

export type DtfProductionRole = ProductionSeparationRole;

export interface DtfSeparationLayer extends ProductionSeparation {
  /** Tipo MIME */
  mimeType: string;
  /** Se a camada foi materializada */
  isMaterialized: boolean;
}
