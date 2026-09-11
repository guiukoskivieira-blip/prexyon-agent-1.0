/**
 * Prexyon Agent — DTF UV Production Profile (DTF UV Etapa 2)
 *
 * Implementação do perfil genérico de produção para decalques DTF UV (Direct to Film UV Transfer).
 * Define capacidades de White Underbase, Verniz (Clear), ausência de faca mecânica obrigatória,
 * e pré-requisitos de transparência e resolução.
 */

import { ProductionProfile } from './types';

export const DTF_UV_PROFILE: ProductionProfile = {
  id: 'dtf-uv',
  family: 'dtf',
  processType: 'uv_transfer',
  name: 'DTF UV (Direct to Film UV Transfer)',
  description: 'Perfil de produção para decalques e transferências DTF UV em substratos rígidos com sob-base branca e acabamento verniz.',
  units: 'mm',
  cutContour: {
    required: false,
    defaultOffset_mm: 0,
    minOffset_mm: 0,
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
    version: '1.1.0',
    includeValidation: true,
  },
  archiveArtifact: {
    format: 'zip',
    enabled: true,
    fileNameTemplate: '{docName}-dtf-uv-pacote.zip',
  },
  validation: {
    requireCutContour: false,
    minDpi: 150,
    recommendedDpi: 300,
    requirePositiveDimensions: true,
    requireGraphicElements: true,
    requireAlphaTransparency: true,
    requireCMYK: false,
  },
  vectorPreflight: {
    minimumStrokeWidthMm: 0.35,
    maxAutoCloseGapMm: 0.5,
    maxCollinearToleranceMm: 0.005,
    maxComplexityThresholdPoints: 500,
    intersectionToleranceMm: 0.001,
    overlapToleranceMm: 0.005,
    minimumClosedPathAreaMm2: 0.01,
    curveFlatteningToleranceMm: 0.05,
  },
  dtfUvConfig: {
    family: 'dtf',
    processType: 'uv_transfer',
    capabilities: {
      supportsWhite: true,
      supportsClear: true,
      supportsPrimer: false,
      supportsSpotChannels: true,
      supportsVariableClear: false,
    },
    colorPolicy: {
      acceptRgb: true,
      acceptCmyk: true,
      autoConvertColor: false,
      ripManagedIcc: true,
    },
    orientationPolicy: 'RIP_CONTROLLED',
    whitePolicy: 'OPTIONAL',
    clearPolicy: 'OPTIONAL',
    primerPolicy: 'DISABLED',
    requireAlphaTransparency: true,
  },
  metadata: {
    vendor: 'generic',
    family: 'dtf',
    processType: 'uv_transfer',
    compatibility: ['Standard UV DTF Printers', 'Mimaki UJF Series', 'Roland VersaUV', 'Generic DTF UV RIPs'],
  },
};
