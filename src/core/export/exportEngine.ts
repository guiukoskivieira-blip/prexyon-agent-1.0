import { PrexyonDocument } from '../pdm/types';
import { ValidationReport } from '../validation/types';
import { ExportOptions, ExportResult } from './types';
import { exportDocumentToSvg } from './svgExporter';
import { exportCutContourToSvg } from './cutContourExporter';
import { exportDocumentManifest } from './manifestExporter';
import { exportDocumentToPng } from './pngExporter';

/**
 * Ponto de entrada unificado para execução de exportações de produção no Prexyon Agent.
 */
export async function exportDocument(
  doc: PrexyonDocument,
  options: ExportOptions,
  validationReport?: ValidationReport
): Promise<ExportResult> {
  switch (options.format) {
    case 'svg':
      return exportDocumentToSvg(doc, options);

    case 'cut-svg':
      return exportCutContourToSvg(doc, options);

    case 'manifest-json':
      return exportDocumentManifest(doc, options, validationReport);

    case 'png':
    default:
      return exportDocumentToPng(doc, options);
  }
}

export interface DownloadableArtifact {
  fileName: string;
  mimeType?: string;
  blob?: Blob;
  dataUrl?: string;
  dataString?: string;
  _bytes?: Uint8Array;
}

/**
 * Função canônica de download de artefatos de produção no navegador.
 * Suporta Blobs nativos, arrays de bytes, dataURLs base64 e strings estruturadas (SVG/JSON).
 */
export function downloadProductionArtifact(artifact: DownloadableArtifact): boolean {
  if (typeof document === 'undefined') {
    return false;
  }

  let blob = artifact.blob;

  if (!blob || blob.size === 0) {
    if (artifact._bytes && artifact._bytes.length > 0) {
      blob = new Blob([artifact._bytes.buffer as ArrayBuffer], {
        type: artifact.mimeType || 'application/octet-stream',
      });
    } else if (artifact.dataUrl && artifact.dataUrl.startsWith('data:')) {
      const parts = artifact.dataUrl.split(',');
      const base64Data = parts[1] || '';
      const mimeMatch = parts[0]?.match(/:(.*?);/);
      const mime = artifact.mimeType || (mimeMatch ? mimeMatch[1] : 'application/octet-stream');
      const binaryStr =
        typeof atob === 'function'
          ? atob(base64Data)
          : typeof Buffer !== 'undefined'
          ? Buffer.from(base64Data, 'base64').toString('binary')
          : '';
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      blob = new Blob([bytes.buffer as ArrayBuffer], { type: mime });
    } else if (artifact.dataString) {
      const mime =
        artifact.mimeType ||
        (artifact.fileName.endsWith('.json') ? 'application/json' : 'image/svg+xml');
      blob = new Blob([artifact.dataString], { type: mime });
    }
  }

  if (!blob || blob.size === 0) {
    console.error(`[downloadProductionArtifact] Cannot download empty artifact: ${artifact.fileName}`);
    return false;
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.fileName;
  anchor.style.display = 'none';

  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  // Revoga o ObjectURL para evitar vazamento de memória após o browser registrar o download
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);

  return true;
}

/**
 * Aciona o download local no navegador a partir de um ExportResult e realiza o cleanup de memória.
 */
export function downloadExportResult(result: ExportResult): boolean {
  return downloadProductionArtifact({
    fileName: result.fileName,
    mimeType: result.mimeType,
    blob: result.blob,
  });
}

