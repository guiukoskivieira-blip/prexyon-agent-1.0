import { PrexyonDocument } from '../pdm/types';
import { roundPrecision } from '../pdm/units';
import { ExportDimensionSummary, ExportOptions } from './types';

/**
 * Calcula as dimensões físicas, deslocamentos e dimensões em pixels para a exportação.
 */
export function calculateExportDimensions(
  doc: PrexyonDocument,
  includeBleed: boolean,
  dpi: number = 300
): ExportDimensionSummary {
  const bleed = doc.productionSettings?.bleed;
  const isBleedActive = Boolean(
    includeBleed &&
      bleed?.enabled &&
      (bleed.top_mm > 0 || bleed.right_mm > 0 || bleed.bottom_mm > 0 || bleed.left_mm > 0)
  );

  const bleedTop_mm = isBleedActive ? bleed!.top_mm : 0;
  const bleedRight_mm = isBleedActive ? bleed!.right_mm : 0;
  const bleedBottom_mm = isBleedActive ? bleed!.bottom_mm : 0;
  const bleedLeft_mm = isBleedActive ? bleed!.left_mm : 0;

  const width_mm = roundPrecision(doc.dimensions.width_mm + bleedLeft_mm + bleedRight_mm, 2);
  const height_mm = roundPrecision(doc.dimensions.height_mm + bleedTop_mm + bleedBottom_mm, 2);

  const width_px = Math.round((width_mm / 25.4) * dpi);
  const height_px = Math.round((height_mm / 25.4) * dpi);

  return {
    width_mm,
    height_mm,
    width_px,
    height_px,
    dpi,
    includeBleed: isBleedActive,
    bleedTop_mm,
    bleedRight_mm,
    bleedBottom_mm,
    bleedLeft_mm,
    offsetX_mm: bleedLeft_mm,
    offsetY_mm: bleedTop_mm,
  };
}

/**
 * Sanitiza uma string para uso seguro como nome de arquivo.
 */
export function sanitizeFileName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'prexyon-documento';
}

/**
 * Gera um nome de arquivo previsível e padronizado para o artefato de exportação.
 */
export function generateExportFileName(doc: PrexyonDocument, options: ExportOptions): string {
  const baseName = sanitizeFileName(doc.name || 'prexyon-documento');
  const summary = calculateExportDimensions(doc, options.includeBleed, options.rasterDpi || 300);

  const dimStr = `${Math.round(summary.width_mm)}x${Math.round(summary.height_mm)}mm`;
  const bleedSuffix = summary.includeBleed ? '-bleed' : '';

  switch (options.format) {
    case 'cut-svg':
      return `${baseName}-cut.svg`;
    case 'manifest-json':
      return `${baseName}-manifest.json`;
    case 'svg':
      return `${baseName}-${dimStr}${bleedSuffix}.svg`;
    case 'png':
    default: {
      const dpi = options.rasterDpi || 300;
      return `${baseName}-${dimStr}${bleedSuffix}-${dpi}dpi.png`;
    }
  }
}
