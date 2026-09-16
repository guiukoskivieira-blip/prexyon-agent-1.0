/**
 * Tool: import_vector_pdf (ETAPA 8.30)
 *
 * Importa arquivos PDF vetoriais diretamente para o Prexyon Document Model (PDM),
 * convertendo cada traçado em objetos vetoriais reais e editáveis, sem rasterização.
 */

import fs from 'fs';
import { ToolDefinition, ToolResult } from '../types';
import { PdfVectorImporter } from '../../pdf/pdfVectorImporter';
import { ImportVectorPdfCommand } from '../../commands/types';
import { PdfImportReport } from '../../pdf/types';
import { VectorPathNode, VectorGroupNode } from '../../pdm/types';

export interface ImportVectorPdfArgs {
  /** Caminho absoluto ou relativo do arquivo PDF no servidor/ambiente local */
  filePath?: string;
  /** Buffer binário ou base64 do PDF */
  pdfBase64?: string;
  /** Buffer binário direto */
  pdfBuffer?: Buffer | Uint8Array;
  /** Se true, agrupa os nós importados em um VectorGroupNode (default: true) */
  groupOnImport?: boolean;
  /** Nome personalizado para o grupo/camada importada */
  importName?: string;
  /** Ajustar dimensões da prancheta às dimensões físicas do PDF (default: false) */
  fitArtboardToPdf?: boolean;
}

export interface ImportVectorPdfResultData {
  rootGroupId?: string;
  totalObjectsImported: number;
  importedPathNodeIds: string[];
  report: PdfImportReport;
}

export const importVectorPdfTool: ToolDefinition<ImportVectorPdfArgs, ImportVectorPdfResultData> = {
  name: 'import_vector_pdf',
  description:
    'Importa um arquivo PDF vetorial convertendo seus operadores gráficos em objetos vetoriais individuais no PDM com escala física e cores preservadas, sem rasterização.',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Caminho local para o arquivo PDF (ex: ./vectorizer-real-test.pdf).',
      },
      pdfBase64: {
        type: 'string',
        description: 'Conteúdo binário do PDF codificado em Base64.',
      },
      groupOnImport: {
        type: 'boolean',
        description: 'Se true (padrão), agrupa os caminhos importados sob um nó de grupo.',
      },
      importName: {
        type: 'string',
        description: 'Nome da camada ou grupo importado.',
      },
      fitArtboardToPdf: {
        type: 'boolean',
        description: 'Se true, ajusta a prancheta do documento às dimensões do PDF.',
      },
    },
  },
  async execute(args, context): Promise<ToolResult<ImportVectorPdfResultData>> {
    let buffer: Buffer | Uint8Array;

    if (args.pdfBuffer) {
      buffer = args.pdfBuffer;
    } else if (args.pdfBase64) {
      buffer = Buffer.from(args.pdfBase64, 'base64');
    } else if (args.filePath) {
      let resolvedPath = args.filePath;
      if (!fs.existsSync(resolvedPath)) {
        if (fs.existsSync(resolvedPath + '.pdf')) {
          resolvedPath = resolvedPath + '.pdf';
        } else {
          return {
            success: false,
            error: {
              code: 'INVALID_ARGUMENTS',
              message: `Arquivo PDF não encontrado no caminho: ${args.filePath}`,
            },
          };
        }
      }
      buffer = fs.readFileSync(resolvedPath);
    } else {
      return {
        success: false,
        error: {
          code: 'INVALID_ARGUMENTS',
          message: 'É necessário fornecer filePath ou pdfBase64.',
        },
      };
    }

    try {
      const prevDimensions = { ...context.doc.dimensions };
      const { doc: intermediateDoc, rootGroupId, importedPathNodeIds, report } =
        PdfVectorImporter.importFromBuffer(context.doc, buffer, {
          groupOnImport: args.groupOnImport ?? true,
          importName: args.importName,
          fitArtboardToPdf: args.fitArtboardToPdf ?? false,
        });

      let command: ImportVectorPdfCommand;
      if (rootGroupId) {
        const groupNode = intermediateDoc.nodes[rootGroupId] as VectorGroupNode;
        const pathNodes = importedPathNodeIds.map((id) => intermediateDoc.nodes[id] as VectorPathNode);
        command = new ImportVectorPdfCommand(groupNode, pathNodes, args.fitArtboardToPdf ? prevDimensions : undefined);
      } else {
        const pathNodes = importedPathNodeIds.map((id) => intermediateDoc.nodes[id] as VectorPathNode);
        command = new ImportVectorPdfCommand(undefined, pathNodes, args.fitArtboardToPdf ? prevDimensions : undefined);
      }

      let finalDoc = intermediateDoc;
      if (context.historyManager) {
        const res = context.historyManager.executeCommand(command, context.doc);
        finalDoc = res.doc;
      }
      if (context.setDoc) {
        context.setDoc(finalDoc);
      }

      return {
        success: true,
        doc: finalDoc,
        data: {
          rootGroupId,
          totalObjectsImported: report.totalObjects,
          importedPathNodeIds,
          report,
        },
        message: `PDF vetorial importado com sucesso: ${report.totalObjects} objetos (${report.paths} paths, ${report.compoundPaths} compostos, ${report.colors.length} cores).`,
      };
    } catch (err: any) {
      return {
        success: false,
        error: {
          code: 'EXECUTION_FAILED',
          message: `Erro ao importar PDF vetorial: ${err.message}`,
        },
      };
    }
  },
};
