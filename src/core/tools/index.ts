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
