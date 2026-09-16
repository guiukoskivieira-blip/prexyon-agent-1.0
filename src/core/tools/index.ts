/**
 * Prexyon Agent — Tool Registry Module (v1.0)
 *
 * Ponto de entrada da infraestrutura de ferramentas determinísticas para agentes de IA.
 */

import { ToolRegistry } from './registry';
import { resizeNodeTool } from './definitions/resizeNodeTool';
import { moveNodeTool } from './definitions/moveNodeTool';
import { vectorizeRasterTool } from './definitions/vectorizeRasterTool';
import { createCutContourTool } from './definitions/createCutContourTool';
import { updateCutContourTool } from './definitions/updateCutContourTool';
import { centerCutContourTool } from './definitions/centerCutContourTool';
import { validateProductionTool } from './definitions/validateProductionTool';
import { exportProductionTool } from './definitions/exportProductionTool';
import { createProductionPackageTool } from './definitions/createProductionPackageTool';
import { autoFixPrepressIssuesTool } from './definitions/autoFixPrepressIssuesTool';
import { applyProposedFixTool } from './definitions/applyProposedFixTool';
import { removeInvisibleVectorObjectsTool } from './definitions/removeInvisibleVectorObjectsTool';
import { setMinimumStrokeWidthTool } from './definitions/setMinimumStrokeWidthTool';
import { closeCutContourTool } from './definitions/closeCutContourTool';
import { removeRedundantVectorPointsTool } from './definitions/removeRedundantVectorPointsTool';
import { simplifyVectorPathTool } from './definitions/simplifyVectorPathTool';
import { generateWhiteUnderbaseTool } from './definitions/generateWhiteUnderbaseTool';
import { generateClearSeparationTool } from './definitions/generateClearSeparationTool';
import { generateDtfUvProductionPackageTool } from './definitions/generateDtfUvProductionPackageTool';
import { removeBackgroundTool } from './definitions/removeBackgroundTool';
import { centerNodeTool } from './definitions/centerNodeTool';
import { fitArtboardTool } from './definitions/fitArtboardTool';
import { flipNodeTool } from './definitions/flipNodeTool';
import { importVectorPdfTool } from './definitions/importVectorPdfTool';
import {
  selectByFillColorTool,
  replaceFillColorTool,
  ungroupSelectedNodeTool,
  groupSelectedNodesTool,
  deleteSelectedNodesTool,
} from './definitions/vectorPropertyTools';
import { documentSummaryTool } from './definitions/documentSummaryTool';
import { ToolExecutionContext, ToolResult } from './types';

export * from './types';
export * from './registry';
export * from './definitions/resizeNodeTool';
export * from './definitions/moveNodeTool';
export * from './definitions/vectorizeRasterTool';
export * from './definitions/createCutContourTool';
export * from './definitions/updateCutContourTool';
export * from './definitions/centerCutContourTool';
export * from './definitions/validateProductionTool';
export * from './definitions/exportProductionTool';
export * from './definitions/createProductionPackageTool';
export * from './definitions/generateDtfUvProductionPackageTool';
export * from './definitions/autoFixPrepressIssuesTool';
export * from './definitions/applyProposedFixTool';
export * from './definitions/removeInvisibleVectorObjectsTool';
export * from './definitions/setMinimumStrokeWidthTool';
export * from './definitions/closeCutContourTool';
export * from './definitions/removeRedundantVectorPointsTool';
export * from './definitions/simplifyVectorPathTool';
export * from './definitions/generateWhiteUnderbaseTool';
export * from './definitions/generateClearSeparationTool';
export * from './definitions/removeBackgroundTool';
export * from './definitions/centerNodeTool';
export * from './definitions/fitArtboardTool';
export * from './definitions/flipNodeTool';
export * from './definitions/importVectorPdfTool';
export * from './definitions/vectorPropertyTools';
export * from './definitions/documentSummaryTool';

/**
 * Instância padrão pré-configurada com todas as ferramentas essenciais do Prexyon Agent.
 */
export const defaultToolRegistry = new ToolRegistry([
  resizeNodeTool,
  moveNodeTool,
  vectorizeRasterTool,
  createCutContourTool,
  updateCutContourTool,
  centerCutContourTool,
  validateProductionTool,
  exportProductionTool,
  createProductionPackageTool,
  generateDtfUvProductionPackageTool,
  autoFixPrepressIssuesTool,
  applyProposedFixTool,
  removeInvisibleVectorObjectsTool,
  setMinimumStrokeWidthTool,
  closeCutContourTool,
  removeRedundantVectorPointsTool,
  simplifyVectorPathTool,
  generateWhiteUnderbaseTool,
  generateClearSeparationTool,
  removeBackgroundTool,
  centerNodeTool,
  fitArtboardTool,
  flipNodeTool,
  importVectorPdfTool,
  selectByFillColorTool,
  replaceFillColorTool,
  ungroupSelectedNodeTool,
  groupSelectedNodesTool,
  deleteSelectedNodesTool,
  documentSummaryTool,
]);

/**
 * Função utilitária para execução rápida de ferramentas via registro padrão.
 */
export async function executeTool<TArgs = any, TResult = any>(
  name: string,
  args: TArgs,
  context: ToolExecutionContext
): Promise<ToolResult<TResult>> {
  return defaultToolRegistry.executeTool<TArgs, TResult>(name, args, context);
}
