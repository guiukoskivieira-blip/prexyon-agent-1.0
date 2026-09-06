import { PrexyonDocument, RasterNode, VectorGroupNode, CutContourNode, TechnicalGuideNode } from '../pdm/types';
import { ValidationReport } from '../validation/types';
import { ExportOptions, ExportResult } from './types';
import { generateExportFileName } from './geometry';

/**
 * Exporta um manifesto JSON técnico estruturado com o resumo de produção do documento.
 */
export function exportDocumentManifest(
  doc: PrexyonDocument,
  options: ExportOptions,
  validationReport?: ValidationReport
): ExportResult {
  const fileName = generateExportFileName(doc, { ...options, format: 'manifest-json' });

  const nodesSummary = doc.rootNodeIds.map((id) => {
    const node = doc.nodes[id];
    if (!node) return { id, exists: false };

    const base = {
      id: node.id,
      name: node.name,
      type: node.type,
      visible: node.visible,
      locked: node.locked,
      position_mm: node.position_mm,
    };

    if (node.type === 'raster_image') {
      const r = node as RasterNode;
      return {
        ...base,
        physicalWidth_mm: r.physicalWidth_mm,
        physicalHeight_mm: r.physicalHeight_mm,
        naturalWidth: r.naturalWidth,
        naturalHeight: r.naturalHeight,
        mimeType: r.mimeType,
        fileName: r.fileName,
      };
    }

    if (node.type === 'group') {
      const g = node as VectorGroupNode;
      return {
        ...base,
        physicalWidth_mm: g.physicalWidth_mm,
        physicalHeight_mm: g.physicalHeight_mm,
        totalPaths: g.childrenIds.length,
      };
    }

    if (node.type === 'cut_contour') {
      const c = node as CutContourNode;
      return {
        ...base,
        sourceNodeId: c.sourceNodeId,
        offset_mm: c.offset_mm,
        strokeColor: c.strokeColor,
        strokeWidth_mm: c.strokeWidth_mm,
        joinStyle: c.joinStyle,
        contourCount: c.contours.length,
      };
    }

    if (node.type === 'technical_guide') {
      const g = node as TechnicalGuideNode;
      return {
        ...base,
        orientation: g.orientation,
        guidePosition_mm: g.guidePosition_mm,
        guideRole: g.guideRole,
        strokeWidth_mm: g.strokeWidth_mm,
      };
    }

    return base;
  });

  const manifestData = {
    generator: 'Prexyon Agent — Production Engine v1.0',
    exportedAt: new Date().toISOString(),
    document: {
      id: doc.id,
      name: doc.name,
      version: doc.version,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      dimensions: {
        width_mm: doc.dimensions.width_mm,
        height_mm: doc.dimensions.height_mm,
        unit: 'mm',
      },
    },
    productionSettings: {
      bleed: doc.productionSettings?.bleed || null,
      safetyMargin: doc.productionSettings?.safetyMargin || null,
    },
    nodesCount: doc.rootNodeIds.length,
    nodes: nodesSummary,
    validation: validationReport
      ? {
          status: validationReport.status,
          errorCount: validationReport.errorCount,
          warningCount: validationReport.warningCount,
          infoCount: validationReport.infoCount,
          checkedAt: validationReport.checkedAt,
          issues: validationReport.issues.map((issue) => ({
            ruleId: issue.ruleId,
            severity: issue.severity,
            category: issue.category,
            title: issue.title,
            message: issue.message,
            nodeId: issue.nodeId,
          })),
        }
      : null,
  };

  const jsonString = JSON.stringify(manifestData, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });

  return {
    fileName,
    mimeType: 'application/json',
    blob,
    width_mm: doc.dimensions.width_mm,
    height_mm: doc.dimensions.height_mm,
    dataString: jsonString,
  };
}
