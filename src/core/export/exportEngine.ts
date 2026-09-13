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
  _bytes?: Uint8Array | ArrayBuffer | number[] | Record<string, number> | any;
}

/**
 * Normalizador canônico e determinístico de bytes de artefatos de produção.
 * Aceita SOMENTE representações conhecidas e seguras:
 * 1. Uint8Array real
 * 2. ArrayBuffer
 * 3. Array de números inteiros (0 <= byte <= 255)
 * 4. Objeto numérico serializado {"0": 80, "1": 75, ...} ordenado e contínuo
 * 5. Buffer JSON {"type": "Buffer", "data": [...]}
 * 6. dataUrl/base64 válido
 */
export function normalizeArtifactBytes(value: unknown): Uint8Array | null {
  if (!value) {
    return null;
  }

  // 1. Uint8Array real
  if (value instanceof Uint8Array) {
    if (value.length === 0) return null;
    return value;
  }

  // 2. ArrayBuffer
  if (value instanceof ArrayBuffer) {
    if (value.byteLength === 0) return null;
    return new Uint8Array(value);
  }

  // 3. Array de números
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    const arr = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i++) {
      const b = value[i];
      if (typeof b !== 'number' || !Number.isInteger(b) || b < 0 || b > 255) {
        return null;
      }
      arr[i] = b;
    }
    return arr;
  }

  // 5. Buffer JSON serializado: {"type": "Buffer", "data": [...]}
  if (
    typeof value === 'object' &&
    value !== null &&
    (value as any).type === 'Buffer' &&
    Array.isArray((value as any).data)
  ) {
    return normalizeArtifactBytes((value as any).data);
  }

  // 4. Objeto numérico serializado: {"0": 80, "1": 75, ...}
  if (typeof value === 'object' && value !== null && !(value instanceof Blob)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return null;

    // Todas as chaves devem ser inteiros não-negativos
    if (!keys.every((k) => /^\d+$/.test(k))) {
      return null;
    }

    const indices = keys.map((k) => parseInt(k, 10)).sort((a, b) => a - b);
    // Verifica continuidade estrita de 0 até length - 1
    for (let i = 0; i < indices.length; i++) {
      if (indices[i] !== i) {
        return null;
      }
    }

    const arr = new Uint8Array(indices.length);
    for (let i = 0; i < indices.length; i++) {
      const b = (value as any)[i];
      if (typeof b !== 'number' || !Number.isInteger(b) || b < 0 || b > 255) {
        return null;
      }
      arr[i] = b;
    }
    return arr;
  }

  // 6. dataUrl / string Base64
  if (typeof value === 'string' && value.length > 0) {
    let base64Data = value;
    if (value.startsWith('data:')) {
      const commaIdx = value.indexOf(',');
      if (commaIdx === -1) return null;
      base64Data = value.substring(commaIdx + 1);
    }

    try {
      let binaryStr = '';
      if (typeof atob === 'function') {
        binaryStr = atob(base64Data);
      } else if (typeof Buffer !== 'undefined') {
        binaryStr = Buffer.from(base64Data, 'base64').toString('binary');
      } else {
        return null;
      }

      if (binaryStr.length === 0) return null;
      const arr = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        arr[i] = binaryStr.charCodeAt(i);
      }
      return arr;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Função canônica de download de artefatos de produção no navegador.
 * Suporta Blobs nativos, arrays de bytes normalizados, dataURLs base64 e strings estruturadas (SVG/JSON).
 */
export function downloadProductionArtifact(artifact: DownloadableArtifact): boolean {
  if (typeof document === 'undefined') {
    return false;
  }

  let blob = artifact.blob;

  if (!blob || blob.size === 0) {
    // 1. Tenta normalizar _bytes se presente
    if (artifact._bytes) {
      const normalized = normalizeArtifactBytes(artifact._bytes);
      if (normalized && normalized.length > 0) {
        blob = new Blob([normalized as BlobPart], {
          type: artifact.mimeType || 'application/octet-stream',
        });
      }
    }

    // 2. Se ainda sem blob, tenta via dataUrl
    if ((!blob || blob.size === 0) && artifact.dataUrl) {
      const normalized = normalizeArtifactBytes(artifact.dataUrl);
      if (normalized && normalized.length > 0) {
        const mimeMatch = artifact.dataUrl.match(/:(.*?);/);
        const mime = artifact.mimeType || (mimeMatch ? mimeMatch[1] : 'application/octet-stream');
        blob = new Blob([normalized as BlobPart], { type: mime });
      }
    }

    // 3. Se ainda sem blob, tenta via dataString (texto plano / manifest JSON / SVG)
    if ((!blob || blob.size === 0) && artifact.dataString && artifact.dataString.length > 0) {
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

