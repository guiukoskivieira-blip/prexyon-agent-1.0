/**
 * Prexyon Agent — Production Profile Types (Etapa 6.7 & DTF UV Etapa 2)
 *
 * Modelo de dados tipado para perfis de produção gráfica (Sticker / Print & Cut, DTF UV).
 * Projetado para extensibilidade futura (generic-sticker, dtf-uv, dtf-textile, roland, mimaki).
 */

import { JoinStyle } from '../../pdm/types';

export type ProductionProfileId = 'generic-sticker' | 'dtf-uv' | (string & {});

export type ProductionFamily = 'sticker' | 'dtf';
export type ProductionProcessType = 'print_and_cut' | 'uv_transfer' | 'textile_transfer';

export interface CutContourProfileConfig {
  /** Se a presença de faca de corte é obrigatória para este perfil */
  required: boolean;
  /** Offset padrão em milímetros */
  defaultOffset_mm: number;
  /** Limite mínimo de offset em mm */
  minOffset_mm: number;
  /** Limite máximo de offset em mm */
  maxOffset_mm: number;
  /** Estilo de cantos padrão */
  defaultJoinStyle: JoinStyle;
  /** Estilos de cantos permitidos */
  allowedJoinStyles: JoinStyle[];
  /** Espessura do traço técnico da faca em mm */
  strokeWidth_mm: number;
}

export interface PrintArtifactConfig {
  /** Formato da arte para impressão */
  format: 'png';
  /** Resolução de rasterização padrão em DPI */
  dpi: number;
  /** Fundo transparente por padrão */
  transparentBackground: boolean;
  /** Incluir área de sangria na arte de impressão */
  includeBleed: boolean;
}

export interface CutArtifactConfig {
  /** Formato da faca isolada */
  format: 'cut-svg';
  /** Faca em arquivo SVG separado e isolado */
  isolated: boolean;
}

export interface ManifestArtifactConfig {
  /** Formato do manifesto técnico */
  format: 'manifest-json';
  /** Versão da especificação do manifesto */
  version: string;
  /** Incluir relatório detalhado de validação */
  includeValidation: boolean;
}

export interface ArchiveArtifactConfig {
  /** Formato do pacote comprimido */
  format: 'zip';
  /** Se a geração de arquivo ZIP consolidado está ativa */
  enabled: boolean;
  /** Modelo de nomenclatura para o arquivo ZIP */
  fileNameTemplate: string;
}

export interface ProductionValidationConfig {
  /** Se a ausência de faca bloqueia o pacote */
  requireCutContour: boolean;
  /** Resolução mínima aceitável para raster (DPI) */
  minDpi: number;
  /** Resolução recomendada para raster (DPI) */
  recommendedDpi: number;
  /** Exigir dimensões positivas */
  requirePositiveDimensions: boolean;
  /** Exigir pelo menos um elemento gráfico (raster ou vetor) */
  requireGraphicElements: boolean;
  /** Se deve validar transparência e canal alfa (DTF UV) */
  requireAlphaTransparency?: boolean;
  /** Se exige espaço de cor CMYK estrito. Para DTF UV genérico: false (aceita RGB/sRGB sem conversão) */
  requireCMYK?: boolean;
}

export interface VectorPreflightProfileConfig {
  /** Espessura mínima recomendada para traços vetoriais em mm */
  minimumStrokeWidthMm: number;
  /** Limite máximo de gap para fechamento automático de contorno de corte em mm */
  maxAutoCloseGapMm: number;
  /** Tolerância máxima de desvio para pontos colineares em mm */
  maxCollinearToleranceMm?: number;
  /** Limite de pontos para alerta de complexidade excessiva */
  maxComplexityThresholdPoints?: number;
  /** Tolerância para detecção de auto-interseção de contornos em mm */
  intersectionToleranceMm?: number;
  /** Tolerância para detecção de segmentos sobrepostos em mm */
  overlapToleranceMm?: number;
  /** Área mínima para contornos fechados válidos em mm² */
  minimumClosedPathAreaMm2?: number;
  /** Tolerância máxima de erro para aproximação de curvas para análise de integridade em mm */
  curveFlatteningToleranceMm?: number;
}

export type DtfUvOrientationPolicy = 'NORMAL' | 'MIRRORED' | 'RIP_CONTROLLED';
export type DtfUvWhitePolicy = 'DISABLED' | 'OPTIONAL' | 'REQUIRED' | 'RIP_CONTROLLED';
export type DtfUvClearPolicy = 'DISABLED' | 'OPTIONAL' | 'REQUIRED' | 'RIP_CONTROLLED';
export type DtfUvPrimerPolicy = 'DISABLED' | 'OPTIONAL' | 'REQUIRED' | 'RIP_CONTROLLED';

export interface DtfUvCapabilities {
  /** Suporte a impressão de tinta branca (White underbase) */
  supportsWhite: boolean;
  /** Suporte a verniz UV (Clear gloss / matte / emboss) */
  supportsClear: boolean;
  /** Suporte a primer de adesão */
  supportsPrimer: boolean;
  /** Suporte a canais de cor especiais / spot channels no RIP */
  supportsSpotChannels: boolean;
  /** Suporte a verniz com espessura variável / texturas 3D */
  supportsVariableClear?: boolean;
}

export interface DtfUvColorPolicy {
  /** Se aceita arte em RGB/sRGB sem bloqueio ou conversão forçada */
  acceptRgb: boolean;
  /** Se aceita arte em CMYK quando suportado */
  acceptCmyk: boolean;
  /** Se executa conversão forçada no client (false: RIP assume gestão de cor) */
  autoConvertColor: boolean;
  /** Se delega perfil ICC, linearização e ink limits ao RIP */
  ripManagedIcc: boolean;
}

export interface DtfUvProfileConfig {
  family: 'dtf';
  processType: 'uv_transfer';
  capabilities: DtfUvCapabilities;
  colorPolicy?: DtfUvColorPolicy;
  orientationPolicy: DtfUvOrientationPolicy;
  whitePolicy: DtfUvWhitePolicy;
  clearPolicy: DtfUvClearPolicy;
  primerPolicy: DtfUvPrimerPolicy;
  requireAlphaTransparency: boolean;
}

export interface ProductionProfile {
  /** Identificador único do perfil (ex: 'generic-sticker', 'dtf-uv') */
  id: ProductionProfileId;
  /** Família de processo produtivo */
  family?: ProductionFamily;
  /** Tipo específico de processo */
  processType?: ProductionProcessType;
  /** Nome legível para humanos */
  name: string;
  /** Descrição técnica do perfil */
  description: string;
  /** Unidade de medida primária */
  units: 'mm';
  /** Configuração de faca de corte */
  cutContour: CutContourProfileConfig;
  /** Configuração da arte de impressão */
  printArtifact: PrintArtifactConfig;
  /** Configuração do arquivo de faca */
  cutArtifact: CutArtifactConfig;
  /** Configuração do manifesto */
  manifestArtifact: ManifestArtifactConfig;
  /** Configuração do arquivo ZIP agrupado */
  archiveArtifact: ArchiveArtifactConfig;
  /** Configurações de validação e pré-requisitos */
  validation: ProductionValidationConfig;
  /** Configurações de pré-voo vetorial (Etapa 6.12) */
  vectorPreflight?: VectorPreflightProfileConfig;
  /** Configurações específicas de DTF UV (quando aplicável) */
  dtfUvConfig?: DtfUvProfileConfig;
  /** Metadados adicionais para futura extensibilidade */
  metadata?: Record<string, unknown>;
}
