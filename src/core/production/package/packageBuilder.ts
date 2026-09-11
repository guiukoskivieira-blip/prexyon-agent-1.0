/**
 * Prexyon Agent — Production Package Builder (Etapa 6.7)
 *
 * Constrói o Pacote Final de Produção reunindo arte para impressão (PNG),
 * faca vetorial isolada (Cut-SVG), manifesto técnico (JSON) e arquivo agrupado (ZIP).
 */

import { PrexyonDocument, CutContourNode } from '../../pdm/types';
import { getProductionProfile } from '../profile/genericStickerProfile';
import { PackageBuildOptions, ProductionArtifact, ProductionPackage } from './types';
import { validateDocumentForPackage } from './packageValidator';
import { exportDocumentToPng } from '../../export/pngExporter';
import { exportCutContourToSvg } from '../../export/cutContourExporter';
import { SimpleZipBuilder } from './zipWriter';
import { buildDtfUvProductionPackage } from '../../dtf/dtfUvPackageEngine';

function slugifyFileName(name: string): string {
  return (name || 'documento')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function buildProductionPackage(
  doc: PrexyonDocument,
  options: PackageBuildOptions = {}
): Promise<ProductionPackage> {
  const profile = getProductionProfile(options.profileId);

  if (profile.id === 'dtf-uv') {
    return buildDtfUvProductionPackage(doc, options as any);
  }

  const validation = validateDocumentForPackage(doc, profile);
  const packageId = `pkg_${doc.id}_${Date.now()}`;
  const documentName = doc.name || 'Documento sem título';
  const baseName = slugifyFileName(documentName);
  const createdAt = new Date().toISOString();

  // Se o pacote estiver BLOQUEADO e não for solicitado ignoreValidationErrors
  if (validation.status === 'BLOCKED' && !options.ignoreValidationErrors) {
    return {
      id: packageId,
      profile,
      status: 'BLOCKED',
      documentId: doc.id,
      documentName,
      dimensions_mm: {
        width_mm: doc.dimensions.width_mm,
        height_mm: doc.dimensions.height_mm,
        unit: 'mm',
      },
      artifacts: [],
      validation,
      createdAt,
    };
  }

  const artifacts: ProductionArtifact[] = [];

  // 1. Arte para Impressão (PNG de Alta Resolução)
  const dpi = options.dpi || profile.printArtifact.dpi;
  const includeBleed = options.includeBleed ?? profile.printArtifact.includeBleed;
  const background = options.transparentBackground === false ? 'white' : 'transparent';

  const pngResult = await exportDocumentToPng(doc, {
    format: 'png',
    rasterDpi: dpi,
    includeBleed,
    background,
    includeCutContour: false, // Faca não deve ser impressa na arte colorida
  });

  const printArtifact: ProductionArtifact = {
    fileName: `${baseName}-print.png`,
    mimeType: pngResult.mimeType,
    format: 'png',
    description: `Arte gráfica de alta resolução para impressão (${dpi} DPI, fundo ${background})`,
    blob: pngResult.blob,
    dataUrl: (pngResult as any).dataUrl,
    width_mm: pngResult.width_mm,
    height_mm: pngResult.height_mm,
  };
  artifacts.push(printArtifact);

  // 2. Faca de Corte Isolada (Cut-SVG)
  const cutNode = Object.values(doc.nodes).find(
    (n): n is CutContourNode => n.type === 'cut_contour'
  );

  let cutArtifact: ProductionArtifact | undefined;
  if (cutNode) {
    const cutResult = exportCutContourToSvg(doc, {
      format: 'cut-svg',
      includeBleed: false,
    });

    cutArtifact = {
      fileName: `${baseName}-cut.svg`,
      mimeType: cutResult.mimeType,
      format: 'cut-svg',
      description: `Geometria vetorial isolada da faca de corte (offset ${cutNode.offset_mm} mm, ${cutNode.contours.length} contornos)`,
      blob: cutResult.blob,
      dataString: cutResult.dataString,
      width_mm: cutResult.width_mm,
      height_mm: cutResult.height_mm,
    };
    artifacts.push(cutArtifact);
  }

  // 3. Manifesto Técnico Estruturado (Manifest JSON)
  const manifestData = {
    manifestVersion: profile.manifestArtifact.version,
    generator: 'Prexyon Agent — Production Engine v1.0',
    exportedAt: createdAt,
    profile: {
      id: profile.id,
      name: profile.name,
      units: profile.units,
      target: 'Generic Sticker Print & Cut',
    },
    document: {
      id: doc.id,
      name: doc.name,
      dimensions: {
        width_mm: doc.dimensions.width_mm,
        height_mm: doc.dimensions.height_mm,
        unit: 'mm',
      },
    },
    printSettings: {
      format: 'png',
      dpi,
      background,
      includeBleed,
    },
    cutContour: cutNode
      ? {
          present: true,
          offset_mm: cutNode.offset_mm,
          joinStyle: cutNode.joinStyle,
          contoursCount: cutNode.contours.length,
          strokeColor: cutNode.strokeColor,
          strokeWidth_mm: cutNode.strokeWidth_mm,
        }
      : {
          present: false,
        },
    artifacts: artifacts.map((a) => ({
      fileName: a.fileName,
      format: a.format,
      mimeType: a.mimeType,
      description: a.description,
    })),
    validation: {
      status: validation.status,
      blockers: validation.blockers,
      warnings: validation.warnings,
      errorCount: validation.engineValidation?.errorCount || 0,
      warningCount: validation.engineValidation?.warningCount || 0,
    },
  };

  const manifestJsonString = JSON.stringify(manifestData, null, 2);
  const manifestBlob = new Blob([manifestJsonString], { type: 'application/json' });

  const manifestArtifact: ProductionArtifact = {
    fileName: `${baseName}-manifest.json`,
    mimeType: 'application/json',
    format: 'manifest-json',
    description: 'Manifesto técnico estruturado com parâmetros de produção e validação',
    blob: manifestBlob,
    dataString: manifestJsonString,
  };
  artifacts.push(manifestArtifact);

  // 4. Arquivo Agrupado ZIP
  let zipArtifact: ProductionArtifact | undefined;
  if (options.generateZip !== false && profile.archiveArtifact.enabled) {
    const zipBuilder = new SimpleZipBuilder();

    // Adicionar print.png ao ZIP
    if (printArtifact.blob) {
      if (typeof (printArtifact.blob as any).arrayBuffer === 'function') {
        const arrayBuf = await printArtifact.blob.arrayBuffer();
        zipBuilder.addFile(printArtifact.fileName, new Uint8Array(arrayBuf));
      } else if ((printArtifact as any).dataUrl) {
        // Fallback se Blob.arrayBuffer não estiver no ambiente
        const base64Data = (printArtifact as any).dataUrl.split(',')[1] || '';
        const binaryStr = typeof atob === 'function' ? atob(base64Data) : '';
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        zipBuilder.addFile(printArtifact.fileName, bytes);
      }
    }

    // Adicionar cut.svg ao ZIP
    if (cutArtifact?.dataString) {
      zipBuilder.addFile(cutArtifact.fileName, cutArtifact.dataString);
    }

    // Adicionar manifest.json ao ZIP
    zipBuilder.addFile(manifestArtifact.fileName, manifestJsonString);

    const zipBytes = zipBuilder.buildUint8Array();
    const zipBlob = zipBuilder.buildBlob();

    zipArtifact = {
      fileName: `${baseName}-pacote-producao.zip`,
      mimeType: 'application/zip',
      format: 'zip',
      description: 'Pacote de produção consolidado contendo arte de impressão, faca de corte e manifesto técnico',
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
      width_mm: doc.dimensions.width_mm,
      height_mm: doc.dimensions.height_mm,
      unit: 'mm',
    },
    artifacts,
    zipArtifact,
    validation,
    createdAt,
  };
}
