/**
 * Prexyon PDF Vector Importer (v0.1)
 *
 * Ponto de entrada unificado para importação de arquivos PDF vetoriais no PDM.
 * Transforma streams gráficos em nós PDM (VectorPathNode e VectorGroupNode)
 * preservando 100% da integridade vetorial, sem rasterização.
 */

import { PrexyonDocument, VectorPathNode, VectorGroupNode } from '../pdm/types';
import { generateUUID, addVectorGroup, addNode } from '../pdm/document';
import { roundPrecision } from '../pdm/units';
import { validatePdfSecurity } from './pdfSecurityValidator';
import { PdfGraphicsDecoder } from './pdfGraphicsDecoder';
import { PdfImportOptions, PdfImportReport } from './types';

export interface PdfImportResult {
  doc: PrexyonDocument;
  rootGroupId?: string;
  importedPathNodeIds: string[];
  report: PdfImportReport;
}

export class PdfVectorImporter {
  public static importFromBuffer(
    doc: PrexyonDocument,
    pdfBuffer: Uint8Array | Buffer,
    options: PdfImportOptions = {}
  ): PdfImportResult {
    // 1. Validação de Segurança
    validatePdfSecurity(pdfBuffer);

    // 2. Decodificação dos Gráficos Vetoriais (Síncrona)
    const decoded = PdfGraphicsDecoder.decode(pdfBuffer);
    return PdfVectorImporter.buildImportResult(doc, decoded, options);
  }

  public static async importFromBufferAsync(
    doc: PrexyonDocument,
    pdfBuffer: Uint8Array | Buffer,
    options: PdfImportOptions = {}
  ): Promise<PdfImportResult> {
    // 1. Validação de Segurança
    validatePdfSecurity(pdfBuffer);

    // 2. Decodificação dos Gráficos Vetoriais (Assíncrona / Browser & Node)
    const decoded = await PdfGraphicsDecoder.decodeAsync(pdfBuffer);
    return PdfVectorImporter.buildImportResult(doc, decoded, options);
  }

  private static buildImportResult(
    doc: PrexyonDocument,
    decoded: {
      width_mm: number;
      height_mm: number;
      objects: import('./types').PdfDecodedPathObject[];
      report: PdfImportReport;
    },
    options: PdfImportOptions = {}
  ): PdfImportResult {
    const { width_mm, height_mm, objects, report } = decoded;

    if (objects.length === 0) {
      throw new Error('O arquivo PDF não contém elementos gráficos vetoriais importáveis.');
    }

    const groupOnImport = options.groupOnImport ?? true;
    const targetPos = options.targetPosition_mm || { x: 0, y: 0 };
    const importName = options.importName || 'PDF Vetorial Importado';

    const pathNodes: VectorPathNode[] = [];
    const childrenIds: string[] = [];

    // 3. Criação dos nós VectorPathNode para cada elemento gráfico
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      const nodeId = generateUUID();
      childrenIds.push(nodeId);

      const pathNode: VectorPathNode = {
        id: nodeId,
        type: 'vector_path',
        name: `Path ${i + 1} (${obj.isCompound ? 'Composto' : 'Simples'})`,
        visible: true,
        locked: false,
        position_mm: {
          x: roundPrecision(obj.bounds_mm.minX + targetPos.x, 2),
          y: roundPrecision(obj.bounds_mm.minY + targetPos.y, 2),
        },
        rotation_deg: 0,
        opacity: obj.opacity,
        d: obj.d,
        fill: obj.fill,
        stroke: obj.stroke,
        strokeWidth_mm: obj.strokeWidth_mm,
        physicalWidth_mm: obj.bounds_mm.width_mm,
        physicalHeight_mm: obj.bounds_mm.height_mm,
        metadata: {
          pathIndex: i,
          rule: obj.fillRule,
          segmentCount: (obj.d.match(/[MLCZ]/gi) || []).length,
        },
      };

      pathNodes.push(pathNode);
    }

    let nextDoc = { ...doc };

    // Se solicitado, ajusta a prancheta do documento
    if (options.fitArtboardToPdf) {
      nextDoc.dimensions = {
        width_mm,
        height_mm,
        unit: 'mm',
      };
    }

    let rootGroupId: string | undefined;

    if (groupOnImport) {
      // Cria VectorGroupNode raiz
      rootGroupId = generateUUID();
      const groupNode: VectorGroupNode = {
        id: rootGroupId,
        type: 'group',
        name: importName,
        visible: true,
        locked: false,
        position_mm: {
          x: roundPrecision(targetPos.x, 2),
          y: roundPrecision(targetPos.y, 2),
        },
        rotation_deg: 0,
        opacity: 1.0,
        physicalWidth_mm: width_mm,
        physicalHeight_mm: height_mm,
        aspectRatio: height_mm > 0 ? roundPrecision(width_mm / height_mm, 4) : 1,
        sourceViewBox: {
          width: width_mm,
          height: height_mm,
        },
        childrenIds,
        metadata: {
          preset: 'pdf_vector_import',
          totalPaths: objects.length,
          vectorizationTimeMs: report.durationMs,
        },
      };

      nextDoc = addVectorGroup(nextDoc, groupNode, pathNodes);
    } else {
      // Insere caminhos diretamente no nível raiz do PDM
      for (const pathNode of pathNodes) {
        nextDoc = addNode(nextDoc, pathNode);
      }
    }

    return {
      doc: nextDoc,
      rootGroupId,
      importedPathNodeIds: childrenIds,
      report,
    };
  }
}
