import { PrexyonDocument } from '../pdm/types';
import { roundPrecision } from '../pdm/units';
import { ExportArea, ExportDimensionSummary, ExportOptions } from './types';

export interface ArtworkBounds {
  x: number;
  y: number;
  width_mm: number;
  height_mm: number;
}

/**
 * Calcula o bounding box dos elementos gráficos reais (não técnicos) presentes no documento.
 */
export function getArtworkBounds(
  doc: PrexyonDocument,
  sourceNodeId?: string | null
): ArtworkBounds | null {
  if (sourceNodeId && doc.nodes[sourceNodeId] && doc.nodes[sourceNodeId].visible) {
    const node = doc.nodes[sourceNodeId];
    if (node.type !== 'cut_contour' && node.type !== 'technical_guide') {
      const physW = (node as any).physicalWidth_mm;
      const physH = (node as any).physicalHeight_mm;
      if (typeof physW === 'number' && physW > 0 && typeof physH === 'number' && physH > 0) {
        return {
          x: node.position_mm?.x ?? 0,
          y: node.position_mm?.y ?? 0,
          width_mm: physW,
          height_mm: physH,
        };
      }
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hasGraphicNodes = false;

  const nodeIds = doc.rootNodeIds && doc.rootNodeIds.length > 0
    ? doc.rootNodeIds
    : Object.keys(doc.nodes || {});

  for (const id of nodeIds) {
    const node = doc.nodes[id];
    if (!node || !node.visible) continue;
    if (node.type === 'cut_contour' || node.type === 'technical_guide') continue;

    const posX = node.position_mm?.x ?? 0;
    const posY = node.position_mm?.y ?? 0;
    const physW = (node as any).physicalWidth_mm ?? 0;
    const physH = (node as any).physicalHeight_mm ?? 0;

    if (physW > 0 && physH > 0) {
      hasGraphicNodes = true;
      minX = Math.min(minX, posX);
      minY = Math.min(minY, posY);
      maxX = Math.max(maxX, posX + physW);
      maxY = Math.max(maxY, posY + physH);
    }
  }

  if (!hasGraphicNodes || minX === Infinity) {
    return null;
  }

  return {
    x: roundPrecision(minX, 3),
    y: roundPrecision(minY, 3),
    width_mm: roundPrecision(maxX - minX, 3),
    height_mm: roundPrecision(maxY - minY, 3),
  };
}

/**
 * Calcula as dimensões físicas, deslocamentos e dimensões em pixels para a exportação.
 */
export function calculateExportDimensions(
  doc: PrexyonDocument,
  includeBleed: boolean,
  dpi: number = 300,
  options?: Partial<ExportOptions>
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

  const artworkBounds = getArtworkBounds(doc, options?.selectedNodeId);
  const effectiveArea: ExportArea = options?.exportArea
    ? options.exportArea
    : (doc.profileId === 'dtf-uv' && artworkBounds)
    ? 'ARTWORK_BOUNDS'
    : 'ARTBOARD_BOUNDS';

  if (effectiveArea === 'ARTWORK_BOUNDS' && artworkBounds) {
    const width_mm = roundPrecision(artworkBounds.width_mm + bleedLeft_mm + bleedRight_mm, 2);
    const height_mm = roundPrecision(artworkBounds.height_mm + bleedTop_mm + bleedBottom_mm, 2);

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
      offsetX_mm: -artworkBounds.x + bleedLeft_mm,
      offsetY_mm: -artworkBounds.y + bleedTop_mm,
      exportArea: 'ARTWORK_BOUNDS',
      sourceBounds_mm: artworkBounds,
    };
  }

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
    exportArea: 'ARTBOARD_BOUNDS',
    sourceBounds_mm: artworkBounds || undefined,
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
  const summary = calculateExportDimensions(doc, options.includeBleed, options.rasterDpi || 300, options);

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
