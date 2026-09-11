/**
 * Prexyon Agent — Generic Sticker Production Profile (Etapa 6.7)
 *
 * Implementação do perfil genérico de produção para adesivos e rótulos (Print + Cut).
 * Centraliza unidades (mm), faca de corte, resolução e artefatos de saída.
 */

import { ProductionProfile } from './types';

export const GENERIC_STICKER_PROFILE: ProductionProfile = {
  id: 'generic-sticker',
  name: 'Perfil Genérico de Adesivos (Print & Cut)',
  description: 'Perfil de produção padronizado para adesivos, rótulos e etiquetas com impressão digital e faca de corte externa em milímetros.',
  units: 'mm',
  cutContour: {
    required: true,
    defaultOffset_mm: 2.0,
    minOffset_mm: 0.1,
    maxOffset_mm: 50.0,
    defaultJoinStyle: 'round',
    allowedJoinStyles: ['round', 'miter', 'bevel'],
    strokeWidth_mm: 0.3,
  },
  printArtifact: {
    format: 'png',
    dpi: 300,
    transparentBackground: true,
    includeBleed: false,
  },
  cutArtifact: {
    format: 'cut-svg',
    isolated: true,
  },
  manifestArtifact: {
    format: 'manifest-json',
    version: '1.0.0',
    includeValidation: true,
  },
  archiveArtifact: {
    format: 'zip',
    enabled: true,
    fileNameTemplate: '{docName}-pacote-producao.zip',
  },
  validation: {
    requireCutContour: true,
    minDpi: 150,
    recommendedDpi: 300,
    requirePositiveDimensions: true,
    requireGraphicElements: true,
  },
  vectorPreflight: {
    minimumStrokeWidthMm: 0.2,
    maxAutoCloseGapMm: 0.5,
    maxCollinearToleranceMm: 0.005,
    maxComplexityThresholdPoints: 500,
    intersectionToleranceMm: 0.001,
    overlapToleranceMm: 0.005,
    minimumClosedPathAreaMm2: 0.01,
    curveFlatteningToleranceMm: 0.05,
  },
  metadata: {
    vendor: 'generic',
    compatibility: ['Standard Print & Cut RIPs', 'Flatbed / Roll Cutters'],
  },
};

import { DTF_UV_PROFILE } from './dtfUvProfile';

/**
 * Registro e resolução de perfis de produção.
 * Permite extensibilidade futura para outros perfis sem refatorações.
 */
const profilesRegistry: Record<string, ProductionProfile> = {
  'generic-sticker': GENERIC_STICKER_PROFILE,
  'generic': GENERIC_STICKER_PROFILE,
  'dtf-uv': DTF_UV_PROFILE,
};

export function getProductionProfile(profileId?: string): ProductionProfile {
  if (!profileId) {
    return GENERIC_STICKER_PROFILE;
  }
  return profilesRegistry[profileId] || GENERIC_STICKER_PROFILE;
}

export function registerProductionProfile(profile: ProductionProfile): void {
  profilesRegistry[profile.id] = profile;
}
