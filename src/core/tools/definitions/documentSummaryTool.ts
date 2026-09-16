/**
 * Tool: build_document_object_summary (ETAPA 8.30 - Fase 13)
 *
 * Gera um resumo estruturado e determinístico de todos os objetos, grupos,
 * cores e seleções ativas do documento para permitir raciocínio preciso pelo agente.
 */

import { ToolDefinition, ToolResult } from '../types';
import { PrexyonDocument, VectorPathNode } from '../../pdm/types';

export interface DocumentObjectSummary {
  documentId: string;
  artboard: {
    width_mm: number;
    height_mm: number;
    unit: string;
  };
  counts: {
    totalNodes: number;
    rootNodes: number;
    paths: number;
    compoundPaths: number;
    groups: number;
    rasters: number;
    cutContours: number;
    technicalGuides: number;
  };
  colors: {
    uniqueFills: string[];
    uniqueStrokes: string[];
    fillDistribution: Record<string, number>;
    strokeDistribution: Record<string, number>;
  };
  selection: {
    selectedNodeId: string | null;
  };
  formattedTextSummary: string;
}

/**
 * Constrói a estrutura canônica de resumo do documento.
 */
export function buildDocumentObjectSummary(
  doc: PrexyonDocument,
  selectedNodeId: string | null = null
): DocumentObjectSummary {
  const counts = {
    totalNodes: Object.keys(doc.nodes || {}).length,
    rootNodes: doc.rootNodeIds?.length || 0,
    paths: 0,
    compoundPaths: 0,
    groups: 0,
    rasters: 0,
    cutContours: 0,
    technicalGuides: 0,
  };

  const fillDistribution: Record<string, number> = {};
  const strokeDistribution: Record<string, number> = {};

  for (const node of Object.values(doc.nodes || {})) {
    if (!node) continue;

    if (node.type === 'vector_path') {
      const path = node as VectorPathNode;
      const isCompound = path.metadata?.segmentCount && path.metadata.segmentCount > 10;
      if (isCompound || (path.d.match(/M/g) || []).length > 1) {
        counts.compoundPaths++;
      } else {
        counts.paths++;
      }

      if (path.fill) {
        const f = path.fill.toUpperCase();
        fillDistribution[f] = (fillDistribution[f] || 0) + 1;
      }
      if (path.stroke) {
        const s = path.stroke.toUpperCase();
        strokeDistribution[s] = (strokeDistribution[s] || 0) + 1;
      }
    } else if (node.type === 'group') {
      counts.groups++;
    } else if (node.type === 'raster_image' || (node as any).type === 'raster') {
      counts.rasters++;
    } else if (node.type === 'cut_contour') {
      counts.cutContours++;
    } else if (node.type === 'technical_guide') {
      counts.technicalGuides++;
    }
  }

  const uniqueFills = Object.keys(fillDistribution);
  const uniqueStrokes = Object.keys(strokeDistribution);

  // Monta texto formatado
  const lines: string[] = [];
  lines.push('DOCUMENT');
  lines.push(`Page: 1`);
  lines.push(`Size: ${doc.dimensions.width_mm} × ${doc.dimensions.height_mm} mm`);
  lines.push(`Total Objects: ${counts.totalNodes}`);
  lines.push(`Groups: ${counts.groups}`);
  lines.push('');
  lines.push('COLORS (Fills)');
  for (const [hex, count] of Object.entries(fillDistribution)) {
    lines.push(`${hex} → ${count} objects`);
  }
  lines.push('');
  lines.push(`SELECTED: ${selectedNodeId ? selectedNodeId : 'none'}`);
  lines.push('');
  lines.push('OBJECT TYPES');
  lines.push(`PATH → ${counts.paths}`);
  lines.push(`COMPOUND_PATH → ${counts.compoundPaths}`);
  if (counts.rasters > 0) lines.push(`RASTER → ${counts.rasters}`);
  if (counts.cutContours > 0) lines.push(`CUT_CONTOUR → ${counts.cutContours}`);
  if (counts.technicalGuides > 0) lines.push(`TECHNICAL_GUIDE → ${counts.technicalGuides}`);

  const formattedTextSummary = lines.join('\n');

  return {
    documentId: doc.id,
    artboard: {
      width_mm: doc.dimensions.width_mm,
      height_mm: doc.dimensions.height_mm,
      unit: doc.dimensions.unit,
    },
    counts,
    colors: {
      uniqueFills,
      uniqueStrokes,
      fillDistribution,
      strokeDistribution,
    },
    selection: {
      selectedNodeId,
    },
    formattedTextSummary,
  };
}

export const documentSummaryTool: ToolDefinition<{}, DocumentObjectSummary> = {
  name: 'build_document_object_summary',
  description: 'Gera o resumo estruturado e determinístico de objetos, nós, cores e dimensões do documento.',
  parameters: {
    type: 'object',
    properties: {},
  },
  async execute(_args, context): Promise<ToolResult<DocumentObjectSummary>> {
    const summary = buildDocumentObjectSummary(context.doc, context.selectedNodeId || null);
    return {
      success: true,
      doc: context.doc,
      data: summary,
      message: summary.formattedTextSummary,
    };
  },
};
