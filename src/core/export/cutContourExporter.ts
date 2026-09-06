import { PrexyonDocument, CutContourNode } from '../pdm/types';
import { roundPrecision } from '../pdm/units';
import { ExportOptions, ExportResult } from './types';
import { calculateExportDimensions, generateExportFileName } from './geometry';

/**
 * Exporta exclusivamente os nós de faca de corte (CutContourNode) para um arquivo SVG técnico.
 */
export function exportCutContourToSvg(
  doc: PrexyonDocument,
  options: ExportOptions
): ExportResult {
  const summary = calculateExportDimensions(doc, options.includeBleed, options.rasterDpi || 300);
  const fileName = generateExportFileName(doc, { ...options, format: 'cut-svg' });

  const { width_mm, height_mm, offsetX_mm, offsetY_mm } = summary;

  // Filtra as facas a serem exportadas (todas ou apenas a selecionada)
  const cutNodes: CutContourNode[] = [];

  if (options.cutContourTarget === 'selected' && options.selectedNodeId) {
    const selected = doc.nodes[options.selectedNodeId];
    if (selected && selected.type === 'cut_contour' && selected.visible) {
      cutNodes.push(selected as CutContourNode);
    }
  }

  // Se nenhuma faca selecionada foi encontrada ou modo 'all', coleta todas as facas visíveis
  if (cutNodes.length === 0) {
    for (const nodeId of doc.rootNodeIds) {
      const node = doc.nodes[nodeId];
      if (node && node.type === 'cut_contour' && node.visible) {
        cutNodes.push(node as CutContourNode);
      }
    }
  }

  let pathsContent = '';

  for (const cut of cutNodes) {
    const strokeColor = cut.strokeColor || '#FF00FF';
    const strokeWidth = cut.strokeWidth_mm || 0.30;

    pathsContent += `  <!-- Cut Contour: ${cut.name} (id: ${cut.id}) -->\n`;
    pathsContent += `  <g id="${cut.id}" stroke="${strokeColor}" stroke-width="${strokeWidth}" fill="none">\n`;

    for (const poly of cut.contours) {
      if (!poly.points_mm || poly.points_mm.length < 2) continue;
      const pathData = poly.points_mm
        .map((pt, i) => {
          const x = roundPrecision(pt.x + offsetX_mm, 3);
          const y = roundPrecision(pt.y + offsetY_mm, 3);
          return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
        })
        .join(' ') + ' Z';

      pathsContent += `    <path d="${pathData}" />\n`;
    }

    pathsContent += `  </g>\n`;
  }

  const finalSvg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg"`,
    `     width="${width_mm}mm" height="${height_mm}mm" viewBox="0 0 ${width_mm} ${height_mm}">`,
    pathsContent.trimEnd(),
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
