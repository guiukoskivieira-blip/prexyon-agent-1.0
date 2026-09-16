import { PrexyonDocument } from '../pdm/types';
import { roundPrecision } from '../pdm/units';
import { parseSvgPath } from '../geometry/vectorPathCleaner';
import { ExportArea, ExportDimensionSummary, ExportOptions } from './types';

export interface ArtworkBounds {
  x: number;
  y: number;
  width_mm: number;
  height_mm: number;
}

export interface PathBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width_mm: number;
  height_mm: number;
}

/**
 * Calcula com precisão matemática os limites de coordenadas (bounding box) dos dados 'd' de um caminho SVG.
 */
export function getPathDataBounds(d: string): PathBounds {
  const commands = parseSvgPath(d);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0;

  for (const cmd of commands) {
    const isRel = cmd.type === cmd.type.toLowerCase();
    const type = cmd.type.toUpperCase();
    const args = cmd.args;

    switch (type) {
      case 'M':
      case 'L':
      case 'T': {
        for (let i = 0; i < args.length; i += 2) {
          const x = isRel ? curX + args[i] : args[i];
          const y = isRel ? curY + args[i + 1] : args[i + 1];
          curX = x;
          curY = y;
          if (type === 'M' && i === 0) {
            startX = x;
            startY = y;
          }
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
        break;
      }
      case 'H': {
        for (let i = 0; i < args.length; i++) {
          const x = isRel ? curX + args[i] : args[i];
          curX = x;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
        }
        break;
      }
      case 'V': {
        for (let i = 0; i < args.length; i++) {
          const y = isRel ? curY + args[i] : args[i];
          curY = y;
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
        break;
      }
      case 'C': {
        for (let i = 0; i < args.length; i += 6) {
          const x1 = isRel ? curX + args[i] : args[i];
          const y1 = isRel ? curY + args[i + 1] : args[i + 1];
          const x2 = isRel ? curX + args[i + 2] : args[i + 2];
          const y2 = isRel ? curY + args[i + 3] : args[i + 3];
          const x = isRel ? curX + args[i + 4] : args[i + 4];
          const y = isRel ? curY + args[i + 5] : args[i + 5];
          curX = x;
          curY = y;
          minX = Math.min(minX, x, x1, x2);
          maxX = Math.max(maxX, x, x1, x2);
          minY = Math.min(minY, y, y1, y2);
          maxY = Math.max(maxY, y, y1, y2);
        }
        break;
      }
      case 'S':
      case 'Q': {
        for (let i = 0; i < args.length; i += 4) {
          const x1 = isRel ? curX + args[i] : args[i];
          const y1 = isRel ? curY + args[i + 1] : args[i + 1];
          const x = isRel ? curX + args[i + 2] : args[i + 2];
          const y = isRel ? curY + args[i + 3] : args[i + 3];
          curX = x;
          curY = y;
          minX = Math.min(minX, x, x1);
          maxX = Math.max(maxX, x, x1);
          minY = Math.min(minY, y, y1);
          maxY = Math.max(maxY, y, y1);
        }
        break;
      }
      case 'A': {
        for (let i = 0; i < args.length; i += 7) {
          const x = isRel ? curX + args[i + 5] : args[i + 5];
          const y = isRel ? curY + args[i + 6] : args[i + 6];
          curX = x;
          curY = y;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
        break;
      }
      case 'Z': {
        curX = startX;
        curY = startY;
        break;
      }
    }
  }

  if (minX === Infinity) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width_mm: 0, height_mm: 0 };
  }
  return {
    minX: roundPrecision(minX, 3),
    minY: roundPrecision(minY, 3),
    maxX: roundPrecision(maxX, 3),
    maxY: roundPrecision(maxY, 3),
    width_mm: roundPrecision(maxX - minX, 3),
    height_mm: roundPrecision(maxY - minY, 3),
  };
}

/**
 * Translada diretamente as coordenadas de uma string de caminho SVG 'd' por (dx, dy).
 * Normaliza a geometria diretamente nas coordenadas finais, eliminando atributos transform="translate()".
 */
export function translatePathData(d: string, dx: number, dy: number): string {
  if (dx === 0 && dy === 0) return d;

  const commands = parseSvgPath(d);
  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0;
  const resultChunks: string[] = [];

  for (const cmd of commands) {
    const isRel = cmd.type === cmd.type.toLowerCase();
    const type = cmd.type.toUpperCase();
    const args = cmd.args;

    if (isRel) {
      if (cmd.type === 'm') {
        const translatedArgs: number[] = [];
        for (let i = 0; i < args.length; i += 2) {
          if (i === 0) {
            const x = roundPrecision(args[i] + dx, 3);
            const y = roundPrecision(args[i + 1] + dy, 3);
            translatedArgs.push(x, y);
            curX = x;
            curY = y;
            startX = x;
            startY = y;
          } else {
            translatedArgs.push(args[i], args[i + 1]);
            curX += args[i];
            curY += args[i + 1];
          }
        }
        resultChunks.push(`m ${translatedArgs.join(' ')}`);
      } else {
        resultChunks.push(`${cmd.type} ${args.join(' ')}`);
      }
      continue;
    }

    switch (type) {
      case 'M':
      case 'L':
      case 'T': {
        const translatedArgs: number[] = [];
        for (let i = 0; i < args.length; i += 2) {
          const x = roundPrecision(args[i] + dx, 3);
          const y = roundPrecision(args[i + 1] + dy, 3);
          translatedArgs.push(x, y);
          curX = x;
          curY = y;
          if (type === 'M' && i === 0) {
            startX = x;
            startY = y;
          }
        }
        resultChunks.push(`${type} ${translatedArgs.join(' ')}`);
        break;
      }
      case 'H': {
        const translatedArgs = args.map((x) => roundPrecision(x + dx, 3));
        curX = translatedArgs[translatedArgs.length - 1];
        resultChunks.push(`H ${translatedArgs.join(' ')}`);
        break;
      }
      case 'V': {
        const translatedArgs = args.map((y) => roundPrecision(y + dy, 3));
        curY = translatedArgs[translatedArgs.length - 1];
        resultChunks.push(`V ${translatedArgs.join(' ')}`);
        break;
      }
      case 'C': {
        const translatedArgs: number[] = [];
        for (let i = 0; i < args.length; i += 6) {
          const x1 = roundPrecision(args[i] + dx, 3);
          const y1 = roundPrecision(args[i + 1] + dy, 3);
          const x2 = roundPrecision(args[i + 2] + dx, 3);
          const y2 = roundPrecision(args[i + 3] + dy, 3);
          const x = roundPrecision(args[i + 4] + dx, 3);
          const y = roundPrecision(args[i + 5] + dy, 3);
          translatedArgs.push(x1, y1, x2, y2, x, y);
          curX = x;
          curY = y;
        }
        resultChunks.push(`C ${translatedArgs.join(' ')}`);
        break;
      }
      case 'S':
      case 'Q': {
        const translatedArgs: number[] = [];
        for (let i = 0; i < args.length; i += 4) {
          const x1 = roundPrecision(args[i] + dx, 3);
          const y1 = roundPrecision(args[i + 1] + dy, 3);
          const x = roundPrecision(args[i + 2] + dx, 3);
          const y = roundPrecision(args[i + 3] + dy, 3);
          translatedArgs.push(x1, y1, x, y);
          curX = x;
          curY = y;
        }
        resultChunks.push(`${type} ${translatedArgs.join(' ')}`);
        break;
      }
      case 'A': {
        const translatedArgs: number[] = [];
        for (let i = 0; i < args.length; i += 7) {
          const rx = args[i];
          const ry = args[i + 1];
          const xRot = args[i + 2];
          const largeArc = args[i + 3];
          const sweep = args[i + 4];
          const x = roundPrecision(args[i + 5] + dx, 3);
          const y = roundPrecision(args[i + 6] + dy, 3);
          translatedArgs.push(rx, ry, xRot, largeArc, sweep, x, y);
          curX = x;
          curY = y;
        }
        resultChunks.push(`A ${translatedArgs.join(' ')}`);
        break;
      }
      case 'Z': {
        curX = startX;
        curY = startY;
        resultChunks.push('Z');
        break;
      }
    }
  }

  return resultChunks.join(' ');
}

/**
 * Calcula o bounding box dos elementos gráficos reais (não técnicos) presentes no documento.
 */
export function getArtworkBounds(
  doc: PrexyonDocument
): ArtworkBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hasGraphicNodes = false;

  const allNodes = Object.values(doc.nodes || {});
  for (const node of allNodes) {
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

  const artworkBounds = getArtworkBounds(doc);
  const effectiveArea: ExportArea = options?.exportArea
    ? options.exportArea
    : doc.profileId === 'dtf-uv'
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
