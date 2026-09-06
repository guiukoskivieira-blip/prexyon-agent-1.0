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

/**
 * Aciona o download local no navegador a partir de um ExportResult e realiza o cleanup de memória.
 */
export function downloadExportResult(result: ExportResult): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }

  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = result.fileName;
  anchor.style.display = 'none';

  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  // Revoga o ObjectURL para evitar vazamento de memória
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}
