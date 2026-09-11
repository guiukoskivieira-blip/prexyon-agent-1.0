/**
 * Prexyon Agent — Production Profile Types (Etapa 6.7)
 *
 * Modelo de dados tipado para perfis de produção gráfica (Sticker / Print & Cut).
 * Projetado para extensibilidade futura (generic, roland-versaworks, mimaki-rasterlink).
 */

import { JoinStyle } from '../../pdm/types';

export type ProductionProfileId = 'generic-sticker' | (string & {});

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
}

export interface ProductionProfile {
  /** Identificador único do perfil (ex: 'generic-sticker') */
  id: ProductionProfileId;
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
  /** Metadados adicionais para futura extensibilidade */
  metadata?: Record<string, unknown>;
}
