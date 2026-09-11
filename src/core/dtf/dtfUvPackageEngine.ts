/**
 * Prexyon Agent — DTF UV Production Package Engine (DTF UV Etapa 5)
 *
 * Motor determinístico de empacotamento técnico, exportação não destrutiva,
 * manifesto JSON estruturado e geração do arquivo ZIP para produção DTF UV.
 */

import { PrexyonDocument } from '../pdm/types';
import { ProductionProfile } from '../production/profile/types';
import { getProductionProfile } from '../production/profile/genericStickerProfile';
import { DTF_UV_PROFILE } from '../production/profile/dtfUvProfile';
import { ProductionArtifact, ProductionPackage, PackageStatus, PackageValidationReport } from '../production/package/types';
import { exportDocumentToPng } from '../export/pngExporter';
import { SimpleZipBuilder } from '../production/package/zipWriter';
import { validateProductionDocument } from '../validation/productionValidationEngine';
import { validateWhiteSeparationAlignment, calculateSeparationFingerprint } from './whiteUnderbaseEngine';
import { validateClearSeparationAlignment } from './clearSeparationEngine';
import { encodeGrayscalePng } from './pngEncoder';

export interface DtfUvPackageBuildOptions {
  profileId?: string;
  dpi?: number;
  includeBleed?: boolean;
  generateZip?: boolean;
  whitePolicy?: 'OPTIONAL' | 'REQUIRED' | 'DISABLED' | 'RIP_CONTROLLED';
  clearPolicy?: 'OPTIONAL' | 'REQUIRED' | 'DISABLED' | 'RIP_CONTROLLED';
  ignoreValidationErrors?: boolean;
}

export interface DtfUvManifest {
  schemaVersion: string;
  process: string;
  profile: string;
  generatedBy: string;
  document: {
    widthMm: number;
    heightMm: number;
    dpi: number;
  };
  color: {
    included: boolean;
    file: string;
  };
  white: {
    policy: string;
    included: boolean;
    file?: string;
    managedBy?: string;
  };
  clear: {
    policy: string;
    included: boolean;
    file?: string;
    managedBy?: string;
  };
  primer: {
    included: boolean;
    note?: string;
  };
  orientation: string;
  colorManagement: {
    conversionPerformed: boolean;
    iccManagedBy: string;
  };
  evidence?: {
    sourceFingerprint: string;
    separationFingerprints?: {
      white?: string;
      clear?: string;
    };
    profileVersion: string;
    timestamp: string;
    whiteDetails?: {
      generationMethod?: string;
      coverageRatio?: number;
      dpi?: number;
    };
    clearDetails?: {
      mode?: string;
      appliedArea?: string;
      coverageRatio?: number;
      dpi?: number;
    };
  };
}

export function slugifyFileName(name: string): string {
  const clean = (name || 'prexyon-job')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.[a-z0-9]{2,4}$/i, '') // Remove extensão de arquivo se houver (.png, .jpg)
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return clean || 'prexyon-job';
}

/**
 * Valida o documento para liberação do Pacote Técnico DTF UV.
 */
export function validateDocumentForDtfUvPackage(
  doc: PrexyonDocument,
  profile: ProductionProfile = DTF_UV_PROFILE,
  options: DtfUvPackageBuildOptions = {}
): PackageValidationReport {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const checkedRules: PackageValidationReport['checkedRules'] = [];

  // 1. Dimensões físicas positivas
  const hasPositiveDimensions =
    typeof doc.dimensions?.width_mm === 'number' &&
    typeof doc.dimensions?.height_mm === 'number' &&
    doc.dimensions.width_mm > 0 &&
    doc.dimensions.height_mm > 0;

  if (hasPositiveDimensions) {
    checkedRules.push({
      rule: 'DTF_UV_PKG_001_DIMENSIONS',
      passed: true,
      severity: 'info',
      message: `Dimensões válidas para DTF UV: ${doc.dimensions.width_mm} x ${doc.dimensions.height_mm} mm.`,
    });
  } else {
    blockers.push('O documento não possui dimensões físicas positivas válidas.');
    checkedRules.push({
      rule: 'DTF_UV_PKG_001_DIMENSIONS',
      passed: false,
      severity: 'error',
      message: 'Dimensões do documento inválidas ou menores/iguais a zero.',
    });
  }

  // 2. Elementos gráficos presentes (COLOR)
  const nodes = Object.values(doc.nodes || {});
  const graphicNodes = nodes.filter(
    (n) => n.type === 'raster_image' || (n as any).type === 'raster' || n.type === 'group' || n.type === 'vector_path'
  );

  if (graphicNodes.length > 0) {
    checkedRules.push({
      rule: 'DTF_UV_PKG_002_GRAPHIC_ELEMENTS',
      passed: true,
      severity: 'info',
      message: `Arte gráfica identificada: ${graphicNodes.length} elemento(s) para impressão COLOR.`,
    });
  } else {
    blockers.push('Nenhum elemento gráfico (imagem ou vetor) foi encontrado no documento para impressão COLOR.');
    checkedRules.push({
      rule: 'DTF_UV_PKG_002_GRAPHIC_ELEMENTS',
      passed: false,
      severity: 'error',
      message: 'Ausência total de arte gráfica para impressão.',
    });
  }

  // 3. Validação de pré-voo com ProductionValidationEngine
  const effectiveWhitePolicy = options.whitePolicy || profile.dtfUvConfig?.whitePolicy || 'OPTIONAL';
  const effectiveClearPolicy = options.clearPolicy || profile.dtfUvConfig?.clearPolicy || 'OPTIONAL';

  const engineReport = validateProductionDocument(doc, {
    profileId: 'dtf-uv',
    recommendedDpi: profile.validation?.recommendedDpi || 300,
    criticalDpi: profile.validation?.minDpi || 150,
    requireCutContour: false,
    checkAlphaTransparency: true,
    customConfig: {
      dtfUv: {
        family: 'dtf',
        processType: 'uv_transfer',
        capabilities: { supportsWhite: true, supportsClear: true, supportsPrimer: false, supportsSpotChannels: true },
        orientationPolicy: 'RIP_CONTROLLED',
        whitePolicy: effectiveWhitePolicy,
        clearPolicy: effectiveClearPolicy,
        primerPolicy: 'DISABLED',
        requireAlphaTransparency: true,
      },
    },
  });

  for (const issue of engineReport.issues) {
    if (issue.severity === 'error') {
      if (!blockers.includes(issue.message)) {
        blockers.push(issue.message);
      }
    } else if (issue.severity === 'warning') {
      if (!warnings.includes(issue.message)) {
        warnings.push(issue.message);
      }
    }
  }

  // 4. Governança da camada de Base Branca (White)
  const whiteSep = doc.separations?.['WHITE'];
  if (effectiveWhitePolicy === 'REQUIRED') {
    if (!whiteSep) {
      const msg = 'A separação de Base Branca (White Underbase) é obrigatória e não foi gerada.';
      if (!blockers.includes(msg)) blockers.push(msg);
      checkedRules.push({
        rule: 'DTF_UV_PKG_003_WHITE_REQUIRED',
        passed: false,
        severity: 'error',
        message: msg,
      });
    } else {
      const alignment = validateWhiteSeparationAlignment(doc, whiteSep);
      if (!alignment.valid || alignment.status === 'STALE' || alignment.status === 'INVALID') {
        const msg = `Separação de Base Branca inválida ou desatualizada: ${alignment.reason || alignment.status}`;
        if (!blockers.includes(msg)) blockers.push(msg);
        checkedRules.push({
          rule: 'DTF_UV_PKG_003_WHITE_REQUIRED',
          passed: false,
          severity: 'error',
          message: msg,
        });
      } else {
        checkedRules.push({
          rule: 'DTF_UV_PKG_003_WHITE_REQUIRED',
          passed: true,
          severity: 'info',
          message: 'Base Branca obrigatória válida e alinhada.',
        });
      }
    }
  } else if (effectiveWhitePolicy === 'OPTIONAL' && whiteSep) {
    const alignment = validateWhiteSeparationAlignment(doc, whiteSep);
    if (!alignment.valid || alignment.status === 'STALE' || alignment.status === 'INVALID') {
      const msg = `Separação de Base Branca presente está desatualizada (STALE) ou inválida: ${alignment.reason || alignment.status}`;
      if (!blockers.includes(msg)) blockers.push(msg);
      checkedRules.push({
        rule: 'DTF_UV_PKG_004_WHITE_OPTIONAL_ALIGNMENT',
        passed: false,
        severity: 'error',
        message: msg,
      });
    }
  }

  // 5. Governança da camada de Verniz (Clear / Varnish)
  const clearSep = doc.separations?.['CLEAR'];
  if (effectiveClearPolicy === 'REQUIRED') {
    if (!clearSep) {
      const msg = 'A separação de Verniz (Clear) é obrigatória e não foi gerada.';
      if (!blockers.includes(msg)) blockers.push(msg);
      checkedRules.push({
        rule: 'DTF_UV_PKG_005_CLEAR_REQUIRED',
        passed: false,
        severity: 'error',
        message: msg,
      });
    } else {
      const alignment = validateClearSeparationAlignment(doc, clearSep);
      if (!alignment.valid || alignment.status === 'STALE' || alignment.status === 'INVALID') {
        const msg = `Separação de Verniz (Clear) inválida ou desatualizada: ${alignment.reason || alignment.status}`;
        if (!blockers.includes(msg)) blockers.push(msg);
        checkedRules.push({
          rule: 'DTF_UV_PKG_005_CLEAR_REQUIRED',
          passed: false,
          severity: 'error',
          message: msg,
        });
      } else {
        checkedRules.push({
          rule: 'DTF_UV_PKG_005_CLEAR_REQUIRED',
          passed: true,
          severity: 'info',
          message: 'Verniz (Clear) obrigatório válido e alinhado.',
        });
      }
    }
  } else if (effectiveClearPolicy === 'OPTIONAL' && clearSep) {
    const alignment = validateClearSeparationAlignment(doc, clearSep);
    if (!alignment.valid || alignment.status === 'STALE' || alignment.status === 'INVALID') {
      const msg = `Separação de Verniz (Clear) presente está desatualizada (STALE) ou inválida: ${alignment.reason || alignment.status}`;
      if (!blockers.includes(msg)) blockers.push(msg);
      checkedRules.push({
        rule: 'DTF_UV_PKG_006_CLEAR_OPTIONAL_ALIGNMENT',
        passed: false,
        severity: 'error',
        message: msg,
      });
    }
  }

  let status: PackageStatus = 'READY';
  if (blockers.length > 0) {
    status = 'BLOCKED';
  } else if (warnings.length > 0) {
    status = 'READY_WITH_WARNINGS';
  }

  return {
    status,
    blockers,
    warnings,
    checkedRules,
    engineValidation: engineReport,
  };
}

/**
 * Constrói o Pacote Técnico DTF UV (Color PNG + White PNG + Clear PNG + Manifest JSON + ZIP).
 */
export async function buildDtfUvProductionPackage(
  doc: PrexyonDocument,
  options: DtfUvPackageBuildOptions = {}
): Promise<ProductionPackage> {
  const profile = getProductionProfile('dtf-uv') || DTF_UV_PROFILE;
  const validation = validateDocumentForDtfUvPackage(doc, profile, options);
  const packageId = `pkg_dtf_uv_${doc.id}_${Date.now()}`;
  const documentName = doc.name || 'Documento sem título';
  const baseName = slugifyFileName(documentName);
  const createdAt = new Date().toISOString();
  const dpi = options.dpi || profile.printArtifact.dpi || 300;

  // Se o pacote estiver bloqueado e não for solicitado ignoreValidationErrors
  if (validation.status === 'BLOCKED' && !options.ignoreValidationErrors) {
    return {
      id: packageId,
      profile,
      status: 'BLOCKED',
      documentId: doc.id,
      documentName,
      dimensions_mm: {
        width_mm: doc.dimensions?.width_mm ?? 100,
        height_mm: doc.dimensions?.height_mm ?? 100,
        unit: 'mm',
      },
      artifacts: [],
      validation,
      createdAt,
    };
  }

  const artifacts: ProductionArtifact[] = [];
  const effectiveWhitePolicy = options.whitePolicy || profile.dtfUvConfig?.whitePolicy || 'OPTIONAL';
  const effectiveClearPolicy = options.clearPolicy || profile.dtfUvConfig?.clearPolicy || 'OPTIONAL';

  // 1. Camada COLOR (Arte de Impressão de Alta Resolução — Fundo Transparente, 300 DPI, Sem Faca de Corte)
  const colorExportResult = await exportDocumentToPng(doc, {
    format: 'png',
    rasterDpi: dpi,
    includeBleed: options.includeBleed ?? false,
    background: 'transparent',
    includeCutContour: false,
  });

  const colorFileName = `${baseName}-color.png`;
  const colorArtifact: ProductionArtifact = {
    fileName: colorFileName,
    mimeType: colorExportResult.mimeType || 'image/png',
    format: 'png',
    description: `Arte gráfica COLOR de alta resolução para impressão DTF UV (${dpi} DPI, transparente, RGB original preservado)`,
    blob: colorExportResult.blob,
    dataUrl: (colorExportResult as any).dataUrl,
    width_mm: colorExportResult.width_mm,
    height_mm: colorExportResult.height_mm,
  };
  artifacts.push(colorArtifact);

  // 2. Camada WHITE (Base Branca — Somente se gerada e aplicável)
  const whiteSep = doc.separations?.['WHITE'];
  let whiteArtifact: ProductionArtifact | undefined;
  let whiteIncluded = false;
  let whiteFileName: string | undefined;

  if (effectiveWhitePolicy !== 'DISABLED' && effectiveWhitePolicy !== 'RIP_CONTROLLED' && whiteSep) {
    whiteFileName = `${baseName}-white.png`;
    let whiteBlob: Blob;
    let whiteBytes: Uint8Array;

    if (whiteSep.maskBuffer && whiteSep.maskBuffer.length > 0) {
      whiteBytes = encodeGrayscalePng(whiteSep.maskBuffer, whiteSep.widthPx, whiteSep.heightPx);
      whiteBlob = new Blob([whiteBytes.buffer as ArrayBuffer], { type: 'image/png' });
    } else {
      // Fallback a partir de dataUrl se buffer não estiver presente
      whiteBlob = new Blob([], { type: 'image/png' });
      whiteBytes = new Uint8Array(0);
    }

    whiteArtifact = {
      fileName: whiteFileName,
      mimeType: 'image/png',
      format: 'png',
      description: `Máscara técnica de Base Branca (White Underbase) em escala de cinza de 8 bits (${whiteSep.dpi} DPI, cobertura ${Math.round((whiteSep.coverageRatio || 0) * 100)}%)`,
      blob: whiteBlob,
      width_mm: whiteSep.widthMm,
      height_mm: whiteSep.heightMm,
    };
    (whiteArtifact as any)._bytes = whiteBytes;
    artifacts.push(whiteArtifact);
    whiteIncluded = true;
  }

  // 3. Camada CLEAR (Verniz — Somente se gerada e aplicável)
  const clearSep = doc.separations?.['CLEAR'];
  let clearArtifact: ProductionArtifact | undefined;
  let clearIncluded = false;
  let clearFileName: string | undefined;

  if (effectiveClearPolicy !== 'DISABLED' && effectiveClearPolicy !== 'RIP_CONTROLLED' && clearSep) {
    clearFileName = `${baseName}-clear.png`;
    let clearBlob: Blob;
    let clearBytes: Uint8Array;

    if (clearSep.maskBuffer && clearSep.maskBuffer.length > 0) {
      clearBytes = encodeGrayscalePng(clearSep.maskBuffer, clearSep.widthPx, clearSep.heightPx);
      clearBlob = new Blob([clearBytes.buffer as ArrayBuffer], { type: 'image/png' });
    } else {
      clearBlob = new Blob([], { type: 'image/png' });
      clearBytes = new Uint8Array(0);
    }

    clearArtifact = {
      fileName: clearFileName,
      mimeType: 'image/png',
      format: 'png',
      description: `Máscara técnica de Verniz (Clear / Varnish) em escala de cinza de 8 bits (${clearSep.dpi} DPI, modo ${clearSep.metadata?.mode || 'ARTWORK'})`,
      blob: clearBlob,
      width_mm: clearSep.widthMm,
      height_mm: clearSep.heightMm,
    };
    (clearArtifact as any)._bytes = clearBytes;
    artifacts.push(clearArtifact);
    clearIncluded = true;
  }

  // 4. Manifesto Técnico Estruturado (Manifest JSON)
  const sourceFingerprint = calculateSeparationFingerprint(doc);

  const manifest: DtfUvManifest = {
    schemaVersion: '1.0',
    process: 'DTF_UV',
    profile: 'dtf-uv',
    generatedBy: 'Prexyon Agent',
    document: {
      widthMm: doc.dimensions?.width_mm ?? 100,
      heightMm: doc.dimensions?.height_mm ?? 100,
      dpi,
    },
    color: {
      included: true,
      file: colorFileName,
    },
    white: {
      policy: effectiveWhitePolicy,
      included: whiteIncluded,
      ...(whiteFileName ? { file: whiteFileName } : {}),
      ...(effectiveWhitePolicy === 'RIP_CONTROLLED' ? { managedBy: 'RIP' } : {}),
    },
    clear: {
      policy: effectiveClearPolicy,
      included: clearIncluded,
      ...(clearFileName ? { file: clearFileName } : {}),
      ...(effectiveClearPolicy === 'RIP_CONTROLLED' ? { managedBy: 'RIP' } : {}),
    },
    primer: {
      included: false,
      note: 'Primer não aplicável no perfil genérico DTF UV (não utilizado)',
    },
    orientation: 'RIP_CONTROLLED',
    colorManagement: {
      conversionPerformed: false,
      iccManagedBy: 'RIP',
    },
    evidence: {
      sourceFingerprint,
      separationFingerprints: {
        ...(whiteSep?.sourceFingerprint ? { white: whiteSep.sourceFingerprint } : {}),
        ...(clearSep?.sourceFingerprint ? { clear: clearSep.sourceFingerprint } : {}),
      },
      profileVersion: profile.manifestArtifact?.version || '1.1.0',
      timestamp: createdAt,
      ...(whiteSep ? {
        whiteDetails: {
          generationMethod: whiteSep.generationMethod,
          coverageRatio: whiteSep.coverageRatio,
          dpi: whiteSep.dpi,
        },
      } : {}),
      ...(clearSep ? {
        clearDetails: {
          mode: clearSep.metadata?.mode as string | undefined,
          appliedArea: clearSep.metadata?.appliedArea as string | undefined,
          coverageRatio: clearSep.coverageRatio,
          dpi: clearSep.dpi,
        },
      } : {}),
    },
  };

  const manifestJsonString = JSON.stringify(manifest, null, 2);
  const manifestBlob = new Blob([manifestJsonString], { type: 'application/json' });
  const manifestFileName = `${baseName}-manifest.json`;

  const manifestArtifact: ProductionArtifact = {
    fileName: manifestFileName,
    mimeType: 'application/json',
    format: 'manifest-json',
    description: 'Manifesto técnico estruturado com parâmetros de produção DTF UV, separações e evidências',
    blob: manifestBlob,
    dataString: manifestJsonString,
  };
  artifacts.push(manifestArtifact);

  // 5. Arquivo Agrupado ZIP ([job-name]-dtf-uv.zip)
  let zipArtifact: ProductionArtifact | undefined;
  if (options.generateZip !== false) {
    const zipBuilder = new SimpleZipBuilder();

    // Adicionar color.png ao ZIP
    if (colorArtifact.blob) {
      if (typeof (colorArtifact.blob as any).arrayBuffer === 'function') {
        const arrayBuf = await colorArtifact.blob.arrayBuffer();
        zipBuilder.addFile(colorArtifact.fileName, new Uint8Array(arrayBuf));
      } else if ((colorArtifact as any).dataUrl) {
        const base64Data = (colorArtifact as any).dataUrl.split(',')[1] || '';
        const binaryStr = typeof atob === 'function' ? atob(base64Data) : '';
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        zipBuilder.addFile(colorArtifact.fileName, bytes);
      }
    }

    // Adicionar white.png ao ZIP se presente
    if (whiteArtifact) {
      const bytes = (whiteArtifact as any)._bytes instanceof Uint8Array
        ? (whiteArtifact as any)._bytes
        : whiteArtifact.blob && typeof (whiteArtifact.blob as any).arrayBuffer === 'function'
        ? new Uint8Array(await whiteArtifact.blob.arrayBuffer())
        : new Uint8Array(0);
      zipBuilder.addFile(whiteArtifact.fileName, bytes);
    }

    // Adicionar clear.png ao ZIP se presente
    if (clearArtifact) {
      const bytes = (clearArtifact as any)._bytes instanceof Uint8Array
        ? (clearArtifact as any)._bytes
        : clearArtifact.blob && typeof (clearArtifact.blob as any).arrayBuffer === 'function'
        ? new Uint8Array(await clearArtifact.blob.arrayBuffer())
        : new Uint8Array(0);
      zipBuilder.addFile(clearArtifact.fileName, bytes);
    }

    // Adicionar manifest.json ao ZIP
    zipBuilder.addFile(manifestArtifact.fileName, manifestJsonString);

    const zipBytes = zipBuilder.buildUint8Array();
    const zipBlob = zipBuilder.buildBlob();
    const zipFileName = `${baseName}-dtf-uv.zip`;

    zipArtifact = {
      fileName: zipFileName,
      mimeType: 'application/zip',
      format: 'zip',
      description: 'Pacote técnico DTF UV consolidado contendo arte COLOR, separações técnicas e manifesto JSON',
      blob: zipBlob,
      size_bytes: zipBytes.length,
    };
  }

  return {
    id: packageId,
    profile,
    status: validation.status,
    documentId: doc.id,
    documentName,
    dimensions_mm: {
      width_mm: doc.dimensions?.width_mm ?? 100,
      height_mm: doc.dimensions?.height_mm ?? 100,
      unit: 'mm',
    },
    artifacts,
    zipArtifact,
    validation,
    createdAt,
    fingerprint: sourceFingerprint,
    metadata: {
      manifest,
      sourceFingerprint,
    },
  };
}

/**
 * Verifica se um pacote DTF UV anteriormente gerado tornou-se desatualizado (STALE)
 * devido a alterações subsequentes no documento ou em suas separações.
 */
export function isDtfUvPackageStale(
  doc: PrexyonDocument,
  pkg: ProductionPackage
): boolean {
  if (!pkg || !pkg.artifacts || pkg.status === 'BLOCKED') return false;

  const currentFingerprint = calculateSeparationFingerprint(doc);
  const pkgFingerprint = (pkg as any).fingerprint || (pkg.metadata as any)?.sourceFingerprint;

  if (pkgFingerprint && pkgFingerprint !== currentFingerprint) {
    return true;
  }

  // Verifica se alguma separação existente está stale
  if (doc.separations?.['WHITE']) {
    const whiteAlign = validateWhiteSeparationAlignment(doc, doc.separations['WHITE']);
    if (whiteAlign.status === 'STALE' || whiteAlign.status === 'INVALID') return true;
  }

  if (doc.separations?.['CLEAR']) {
    const clearAlign = validateClearSeparationAlignment(doc, doc.separations['CLEAR']);
    if (clearAlign.status === 'STALE' || clearAlign.status === 'INVALID') return true;
  }

  return false;
}
