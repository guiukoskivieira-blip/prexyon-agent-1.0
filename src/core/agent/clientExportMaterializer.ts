import { PrexyonDocument } from '../pdm/types';
import { ExecutedToolRecord } from './types';
import {
  exportDocument,
  downloadExportResult,
  downloadProductionArtifact,
} from '../export/exportEngine';
import { validateProductionDeliverable } from '../validation/productionValidationEngine';
import {
  buildExportOptionsFromAgentArgs,
  ExportProductionArgs,
} from '../tools/definitions/exportProductionTool';
import { buildProductionPackage } from '../production/package/packageBuilder';
import { PackageBuildOptions, ProductionPackage } from '../production/package/types';

export interface MaterializedAgentExport {
  fileName: string;
  mimeType: string;
  package?: ProductionPackage;
}

export interface AgentExportMaterializerDependencies {
  exportDocument: typeof exportDocument;
  downloadExportResult: typeof downloadExportResult;
  downloadProductionArtifact: typeof downloadProductionArtifact;
}

const defaultDependencies: AgentExportMaterializerDependencies = {
  exportDocument,
  downloadExportResult,
  downloadProductionArtifact,
};

/**
 * Materializa no navegador as exportações que o AgentRuntime validou no servidor.
 * A resposta textual de sucesso só deve ser exibida depois que esta função concluir.
 */
export async function materializeAgentExports(
  executedTools: ExecutedToolRecord[],
  doc: PrexyonDocument,
  dependencies: AgentExportMaterializerDependencies = defaultDependencies
): Promise<MaterializedAgentExport[]> {
  const exportCalls = executedTools.filter(
    (record) => record.toolName === 'export_production' && record.result?.success !== false
  );

  const packageCalls = executedTools.filter(
    (record) =>
      (record.toolName === 'create_production_package' ||
        record.toolName === 'generate_dtf_uv_production_package') &&
      record.result?.success !== false
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

  // 2. Pacotes consolidados via create_production_package ou generate_dtf_uv_production_package
  for (const record of packageCalls) {
    const isDtf =
      record.toolName === 'generate_dtf_uv_production_package' || doc.profileId === 'dtf-uv';
    const rawArgs = (record.args || {}) as Record<string, unknown>;
    const buildOptions: PackageBuildOptions = {
      ...rawArgs,
      profileId: isDtf ? 'dtf-uv' : ((rawArgs.profileId as string) || doc.profileId),
    };
    const pkg = await buildProductionPackage(doc, buildOptions);

    const triggerDownload = (artifact: any) => {
      if (typeof dependencies.downloadProductionArtifact === 'function') {
        return dependencies.downloadProductionArtifact(artifact);
      }
      if (typeof dependencies.downloadExportResult === 'function') {
        return dependencies.downloadExportResult({
          fileName: artifact.fileName,
          mimeType: artifact.mimeType,
          blob: artifact.blob,
          width_mm: artifact.width_mm || doc.dimensions.width_mm,
          height_mm: artifact.height_mm || doc.dimensions.height_mm,
        });
      }
      return downloadProductionArtifact(artifact);
    };

    // Se houver arquivo ZIP, prioriza o download do ZIP agrupado
    if (
      pkg.zipArtifact &&
      (pkg.zipArtifact.blob ||
        (pkg.zipArtifact as any)._bytes ||
        (pkg.zipArtifact as any).dataUrl)
    ) {
      const downloadTriggered = triggerDownload(pkg.zipArtifact);
      if (!downloadTriggered) {
        throw new Error(`O download de "${pkg.zipArtifact.fileName}" não pôde ser iniciado no navegador.`);
      }

      artifacts.push({
        fileName: pkg.zipArtifact.fileName,
        mimeType: pkg.zipArtifact.mimeType,
        package: pkg,
      });
    } else {
      // Caso ZIP não esteja ativo, baixa os artefatos individuais
      for (const art of pkg.artifacts) {
        if (
          art.blob ||
          (art as any)._bytes ||
          (art as any).dataUrl ||
          (art as any).dataString
        ) {
          const downloadTriggered = triggerDownload(art);
          if (!downloadTriggered) {
            throw new Error(`O download de "${art.fileName}" não pôde ser iniciado no navegador.`);
          }

          artifacts.push({ fileName: art.fileName, mimeType: art.mimeType, package: pkg });
        }
      }
    }
  }

  return artifacts;
}
