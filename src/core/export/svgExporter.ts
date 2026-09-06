import { 
  PrexyonDocument, 
  VectorGroupNode, 
  VectorPathNode, 
  RasterNode, 
  CutContourNode, 
  TechnicalGuideNode 
} from '../pdm/types';
import { roundPrecision } from '../pdm/units';
import { ExportOptions, ExportResult } from './types';
import { calculateExportDimensions, generateExportFileName } from './geometry';

/**
 * Exporta o documento PDM para um arquivo SVG de produção com escala física e unidades em milímetros.
 */
export function exportDocumentToSvg(
  doc: PrexyonDocument,
  options: ExportOptions
): ExportResult {
  const summary = calculateExportDimensions(doc, options.includeBleed, options.rasterDpi || 300);
  const fileName = generateExportFileName(doc, options);

  const { width_mm, height_mm, offsetX_mm, offsetY_mm } = summary;

  let svgContent = '';

  // Background
  if (options.background === 'white') {
    svgContent += `  <rect width="${width_mm}" height="${height_mm}" fill="#FFFFFF" />\n`;
  }

  // Elementos do PDM em ordem Z (rootNodeIds)
  for (const nodeId of doc.rootNodeIds) {
    const node = doc.nodes[nodeId];
    if (!node || !node.visible) continue;

    if (node.type === 'raster_image') {
      if (options.includeRasterInSvg !== false) {
        const raster = node as RasterNode;
        const posX = roundPrecision(raster.position_mm.x + offsetX_mm, 2);
        const posY = roundPrecision(raster.position_mm.y + offsetY_mm, 2);
        const opacity = raster.opacity !== undefined ? raster.opacity : 1;

        svgContent += `  <!-- Raster: ${raster.name} -->\n`;
        svgContent += `  <image x="${posX}" y="${posY}" width="${raster.physicalWidth_mm}" height="${raster.physicalHeight_mm}" href="${raster.src}" opacity="${opacity}" preserveAspectRatio="none" />\n`;
      }
    } else if (node.type === 'group') {
      const group = node as VectorGroupNode;
      const posX = roundPrecision(group.position_mm.x + offsetX_mm, 2);
      const posY = roundPrecision(group.position_mm.y + offsetY_mm, 2);
      const viewBoxW = group.sourceViewBox.width || group.physicalWidth_mm || 1;
      const viewBoxH = group.sourceViewBox.height || group.physicalHeight_mm || 1;
      const scaleX = roundPrecision(group.physicalWidth_mm / viewBoxW, 6);
      const scaleY = roundPrecision(group.physicalHeight_mm / viewBoxH, 6);
      const opacity = group.opacity !== undefined ? group.opacity : 1;

      svgContent += `  <!-- Vector Group: ${group.name} -->\n`;
      svgContent += `  <g transform="translate(${posX}, ${posY}) scale(${scaleX}, ${scaleY})" opacity="${opacity}">\n`;

      for (const childId of group.childrenIds) {
        const child = doc.nodes[childId] as VectorPathNode | undefined;
        if (!child || child.type !== 'vector_path' || !child.visible) continue;

        const fillAttr = child.fill ? `fill="${child.fill}"` : 'fill="none"';
        const strokeAttr = child.stroke ? `stroke="${child.stroke}"` : 'stroke="none"';
        const strokeWidthAttr = child.stroke && child.strokeWidth_mm > 0 ? `stroke-width="${child.strokeWidth_mm}"` : '';

        svgContent += `    <path d="${child.d}" ${fillAttr} ${strokeAttr} ${strokeWidthAttr} />\n`;
      }

      svgContent += `  </g>\n`;
    } else if (node.type === 'cut_contour') {
      if (options.includeCutContour) {
        const cut = node as CutContourNode;
        const strokeColor = cut.strokeColor || '#FF00FF';
        const strokeWidth = cut.strokeWidth_mm || 0.30;

        svgContent += `  <!-- Cut Contour: ${cut.name} -->\n`;
        svgContent += `  <g stroke="${strokeColor}" stroke-width="${strokeWidth}" fill="none">\n`;

        for (const poly of cut.contours) {
          if (!poly.points_mm || poly.points_mm.length < 2) continue;
          const pathData = poly.points_mm
            .map((pt, i) => {
              const x = roundPrecision(pt.x + offsetX_mm, 3);
              const y = roundPrecision(pt.y + offsetY_mm, 3);
              return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
            })
            .join(' ') + ' Z';

          svgContent += `    <path d="${pathData}" />\n`;
        }

        svgContent += `  </g>\n`;
      }
    } else if (node.type === 'technical_guide') {
      if (options.includeTechnicalGuides) {
        const guide = node as TechnicalGuideNode;
        const strokeColor = guide.strokeColor || '#00FFFF';
        const strokeWidth = guide.strokeWidth_mm || 0.25;

        svgContent += `  <!-- Technical Guide: ${guide.name} -->\n`;
        if (guide.orientation === 'vertical') {
          const x = roundPrecision(guide.guidePosition_mm + offsetX_mm, 2);
          svgContent += `  <line x1="${x}" y1="0" x2="${x}" y2="${height_mm}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-dasharray="2,2" />\n`;
        } else {
          const y = roundPrecision(guide.guidePosition_mm + offsetY_mm, 2);
          svgContent += `  <line x1="0" y1="${y}" x2="${width_mm}" y2="${y}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-dasharray="2,2" />\n`;
        }
      }
    }
  }

  const finalSvg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
    `     width="${width_mm}mm" height="${height_mm}mm" viewBox="0 0 ${width_mm} ${height_mm}">`,
    `  <defs>`,
    `    <clipPath id="export-boundary-clip">`,
    `      <rect x="0" y="0" width="${width_mm}" height="${height_mm}" />`,
    `    </clipPath>`,
    `  </defs>`,
    `  <g clip-path="url(#export-boundary-clip)">`,
    svgContent.trimEnd(),
    `  </g>`,
    `</svg>`,
  ].join('\n');

  const blob = new Blob([finalSvg], { type: 'image/svg+xml;charset=utf-8' });

  return {
    fileName,
    mimeType: 'image/svg+xml',
    blob,
    width_mm,
    height_mm,
    dataString: finalSvg,
  };
}
