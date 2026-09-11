import { PrexyonDocument } from '../pdm/types';
import { ExecutedToolRecord } from './types';
import { exportDocument, downloadExportResult } from '../export/exportEngine';
import { validateProductionDocument } from '../validation/productionValidationEngine';
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
export async function materializeAgentExports(
  executedTools: ExecutedToolRecord[],
  doc: PrexyonDocument,
  dependencies: AgentExportMaterializerDependencies = defaultDependencies
): Promise<MaterializedAgentExport[]> {
  const exportCalls = executedTools.filter(
    (record) => record.toolName === 'export_production' && record.result.success
  );

  const artifacts: MaterializedAgentExport[] = [];
  for (const record of exportCalls) {
    const args = record.args as unknown as ExportProductionArgs;
    const validationReport = validateProductionDocument(doc);
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

  return artifacts;
}
