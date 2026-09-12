import { PrexyonDocument } from '../pdm/types';
import { ExecutedToolRecord } from './types';
import { exportDocument, downloadExportResult } from '../export/exportEngine';
import { validateProductionDeliverable } from '../validation/productionValidationEngine';
import {
  buildExportOptionsFromAgentArgs,
  ExportProductionArgs,
} from '../tools/definitions/exportProductionTool';

export interface MaterializedAgentExport {
  fileName: string;
  mimeType: string;
}

export interface AgentExportMaterializerDependencies {
  exportDocument: typeof exportDocument;
  downloadExportResult: typeof downloadExportResult;
}

const defaultDependencies: AgentExportMaterializerDependencies = {
  exportDocument,
  downloadExportResult,
};

/**
 * Materializa no navegador as exportações que o AgentRuntime validou no servidor.
 * A resposta textual de sucesso só deve ser exibida depois que esta função concluir.
 */
import { buildProductionPackage } from '../production/package/packageBuilder';
import { PackageBuildOptions } from '../production/package/types';

export async function materializeAgentExports(
  executedTools: ExecutedToolRecord[],
  doc: PrexyonDocument,
  dependencies: AgentExportMaterializerDependencies = defaultDependencies
): Promise<MaterializedAgentExport[]> {
  const exportCalls = executedTools.filter(
    (record) => record.toolName === 'export_production' && record.result.success
  );

  const packageCalls = executedTools.filter(
    (record) => record.toolName === 'create_production_package' && record.result.success
  );

  const artifacts: MaterializedAgentExport[] = [];

  // 1. Exportações individuais via export_production
  for (const record of exportCalls) {
    const args = record.args as unknown as ExportProductionArgs;
    const deliverableMap: Record<string, import('../validation').ProductionDeliverableType> = {
      png: 'PRINT_PNG',
      svg: 'ARTWORK_SVG',
      'cut-svg': 'CUT_SVG',
      'manifest-json': 'PRINT_PNG',
    };
    const deliverable = deliverableMap[args.format] || 'PRINT_PNG';
    const validationReport = validateProductionDeliverable(doc, deliverable);
    const result = await dependencies.exportDocument(
      doc,
      buildExportOptionsFromAgentArgs(args),
      validationReport
    );

    const downloadTriggered = dependencies.downloadExportResult(result);
    if (!downloadTriggered) {
      throw new Error(`O download de "${result.fileName}" não pôde ser iniciado no navegador.`);
    }

    artifacts.push({ fileName: result.fileName, mimeType: result.mimeType });
  }

  // 2. Pacotes consolidados via create_production_package
  for (const record of packageCalls) {
    const args = (record.args || {}) as unknown as PackageBuildOptions;
    const pkg = await buildProductionPackage(doc, args);

    // Se houver arquivo ZIP, prioriza o download do ZIP agrupado
    if (pkg.zipArtifact && pkg.zipArtifact.blob) {
      const downloadTriggered = dependencies.downloadExportResult({
        fileName: pkg.zipArtifact.fileName,
        mimeType: pkg.zipArtifact.mimeType,
        blob: pkg.zipArtifact.blob,
        width_mm: doc.dimensions.width_mm,
        height_mm: doc.dimensions.height_mm,
      });

      if (!downloadTriggered) {
        throw new Error(`O download de "${pkg.zipArtifact.fileName}" não pôde ser iniciado no navegador.`);
      }

      artifacts.push({ fileName: pkg.zipArtifact.fileName, mimeType: pkg.zipArtifact.mimeType });
    } else {
      // Caso ZIP não esteja ativo, baixa os artefatos individuais
      for (const art of pkg.artifacts) {
        if (art.blob) {
          const downloadTriggered = dependencies.downloadExportResult({
            fileName: art.fileName,
            mimeType: art.mimeType,
            blob: art.blob,
            width_mm: art.width_mm || doc.dimensions.width_mm,
            height_mm: art.height_mm || doc.dimensions.height_mm,
          });

          if (!downloadTriggered) {
            throw new Error(`O download de "${art.fileName}" não pôde ser iniciado no navegador.`);
          }

          artifacts.push({ fileName: art.fileName, mimeType: art.mimeType });
        }
      }
    }
  }

  return artifacts;
}
