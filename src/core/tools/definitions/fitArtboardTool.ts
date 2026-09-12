/**
 * Tool: fit_artboard_to_artwork
 *
 * Ajusta as dimensões da prancheta para delimitar com precisão a arte selecionada com margem.
 */

import { ToolDefinition, ToolResult } from '../types';

export interface FitArtboardArgs {
  margin_mm?: number;
}

export interface FitArtboardResultData {
  width_mm: number;
  height_mm: number;
}

export const fitArtboardTool: ToolDefinition<FitArtboardArgs, FitArtboardResultData> = {
  name: 'fit_artboard_to_artwork',
  description: 'Ajusta o tamanho da prancheta física ao redor do conteúdo da arte com margem técnica.',
  parameters: {
    type: 'object',
    properties: {
      margin_mm: {
        type: 'number',
        description: 'Margem em mm ao redor da arte (padrão: 5 mm).',
        default: 5.0,
      },
    },
  },
  async execute(args, context): Promise<ToolResult<FitArtboardResultData>> {
    const { doc, setDoc } = context;
    const margin = typeof args?.margin_mm === 'number' ? Math.max(0, args.margin_mm) : 5.0;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const node of Object.values(doc.nodes)) {
      if (!node || !node.visible || node.type === 'technical_guide') continue;
      const x = node.position_mm?.x ?? 0;
      const y = node.position_mm?.y ?? 0;
      const w = (node as any).physicalWidth_mm || 50;
      const h = (node as any).physicalHeight_mm || 50;

      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + w > maxX) maxX = x + w;
      if (y + h > maxY) maxY = y + h;
    }

    if (!Number.isFinite(minX)) {
      minX = 0; minY = 0; maxX = 100; maxY = 100;
    }

    const contentW = maxX - minX;
    const contentH = maxY - minY;

    const newW = Number((contentW + margin * 2).toFixed(2));
    const newH = Number((contentH + margin * 2).toFixed(2));

    const deltaX = margin - minX;
    const deltaY = margin - minY;

    const updatedNodes = { ...doc.nodes };
    for (const [id, node] of Object.entries(doc.nodes)) {
      if (!node) continue;
      updatedNodes[id] = {
        ...node,
        position_mm: {
          x: Number(((node.position_mm?.x ?? 0) + deltaX).toFixed(2)),
          y: Number(((node.position_mm?.y ?? 0) + deltaY).toFixed(2)),
        },
      };
    }

    const nextDoc = {
      ...doc,
      dimensions: { ...doc.dimensions, width_mm: newW, height_mm: newH },
      nodes: updatedNodes,
    };

    if (setDoc) setDoc(nextDoc);

    return {
      success: true,
      doc: nextDoc,
      message: `Prancheta ajustada para ${newW} × ${newH} mm com margem de ${margin} mm.`,
      reply: `Prancheta ajustada para ${newW} × ${newH} mm com margem de ${margin} mm.`,
      data: { width_mm: newW, height_mm: newH },
    };
  },
};
